import os, io, json, logging, secrets, uuid
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, desc, func
from sqlalchemy.orm import Session
from app.db import SessionLocal, init_db
from app.models import Upload as UploadModel, LogRecord, Insight
from app.analytics import parse_log_file, analyze_logs

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("log_analytics")
app = FastAPI(title="Log Analytics AI", version="2.0.0",
              description="Cloud log ingestion, analytics and Isolation Forest anomaly detection")

origins = [x.strip() for x in os.getenv("FRONTEND_ORIGINS", "http://localhost:8080,http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["*"])

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "20"))

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "healthy", "service": "log-analytics-api"}

@app.get("/ready")
def ready():
    try:
        with SessionLocal() as db:
            db.execute(select(1))
        return {"status": "ready", "database": "connected"}
    except Exception as exc:
        logger.exception("readiness_check_failed")
        raise HTTPException(503, "Database not ready") from exc

def save_original_to_cloud(filename: str, content: bytes) -> str | None:
    bucket_name = os.getenv("GCS_BUCKET", "").strip()
    if not bucket_name:
        return None
    from google.cloud import storage
    object_name = f"uploads/{datetime.now(timezone.utc).strftime('%Y/%m/%d')}/{uuid.uuid4().hex}_{filename.replace('/', '_').replace(chr(92), '_')}"
    blob = storage.Client().bucket(bucket_name).blob(object_name)
    blob.upload_from_string(content, content_type="text/plain" if filename.lower().endswith((".log", ".txt")) else "text/csv")
    return f"gs://{bucket_name}/{object_name}"

def persist_analysis(db: Session, filename: str, storage_uri: str | None, df, result: dict, parse_errors: list[str]):
    upload = UploadModel(filename=filename[:255], storage_uri=storage_uri,
                         rows_processed=len(df), error_count=result["errors"],
                         warning_count=result["warnings"], anomaly_windows=result["anomaly_windows"],
                         status="completed")
    db.add(upload)
    db.flush()
    records = []
    for _, row in df.iterrows():
        records.append(LogRecord(
            upload_id=upload.id, timestamp=row["timestamp"].to_pydatetime(),
            level=str(row["level"]), service=str(row["service"]), message=str(row["message"]),
            response_ms=float(row["response_ms"]) if row["response_ms"] is not None and str(row["response_ms"]) != "nan" else None,
            status_code=int(row["status_code"]) if row["status_code"] is not None and str(row["status_code"]) != "nan" else None,
            failed_login=int(row["failed_login"]) if row["failed_login"] is not None and str(row["failed_login"]) != "nan" else None,
            window=str(row["window"])
        ))
    db.add_all(records)
    for item in result["insights"]:
        db.add(Insight(upload_id=upload.id, kind=item["kind"], severity=item["severity"],
                       title=item["title"], details=item["details"], recommendation=item["recommendation"]))
    db.commit()
    result["upload_id"] = upload.id
    result["filename"] = upload.filename
    result["uploaded_at"] = upload.created_at.isoformat()
    result["storage_uri"] = storage_uri
    result["parse_warnings"] = parse_errors[:50]
    result["parse_warning_count"] = len(parse_errors)
    logger.info("upload_analyzed", extra={"upload_id": upload.id, "rows": len(df), "anomaly_windows": result["anomaly_windows"]})
    return result

@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    filename = (file.filename or "uploaded.csv").replace("\\", "/").split("/")[-1]
    if not filename.lower().endswith((".csv", ".log", ".txt")):
        raise HTTPException(415, "Supported formats: .csv, .log, .txt")
    content = await file.read((MAX_UPLOAD_MB * 1024 * 1024) + 1)
    if not content:
        raise HTTPException(400, "The uploaded file is empty")
    if len(content) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Maximum upload size is {MAX_UPLOAD_MB} MB")
    try:
        df, parse_warnings = parse_log_file(filename, content)
        result = analyze_logs(df)
        storage_uri = save_original_to_cloud(filename, content)
        with SessionLocal() as db:
            return persist_analysis(db, filename, storage_uri, df, result, parse_warnings)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("analysis_failed")
        raise HTTPException(500, "Analysis failed. Check backend logs for details.") from exc

@app.post("/api/demo")
def generate_demo():
    import pandas as pd
    import random
    from datetime import timedelta
    rng = random.Random(42)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    rows = []
    services = ["api-gateway", "auth-service", "database", "payments", "worker"]
    for i in range(240):
        ts = now - timedelta(minutes=(240-i))
        service = rng.choice(services)
        level, message = "INFO", "Request completed successfully"
        response_ms = max(20, rng.gauss(180, 50))
        failed_login = 0
        status_code = 200
        if 165 <= i <= 190:
            service = "database"
            level, message, response_ms, status_code = "ERROR", "Database connection pool exhausted", rng.uniform(1800, 5000), 503
        elif 190 < i <= 205:
            service = "auth-service"
            level, message, failed_login, status_code = "WARNING", "Repeated failed login attempt", 1, 401
        elif rng.random() < 0.07:
            level, message = "WARNING", "Response latency above expected threshold"
            response_ms = rng.uniform(600, 1200)
        elif rng.random() < 0.035:
            level, message, status_code = "ERROR", "Upstream request failed", 502
        rows.append({"timestamp": ts.isoformat(), "level": level, "service": service, "message": message,
                     "response_ms": round(response_ms, 2), "status_code": status_code, "failed_login": failed_login})
    df, parse_warnings = parse_log_file("demo.csv", pd.DataFrame(rows).to_csv(index=False).encode())
    result = analyze_logs(df)
    with SessionLocal() as db:
        return persist_analysis(db, "generated-demo.csv", None, df, result, parse_warnings)

@app.get("/api/uploads")
def list_uploads(limit: int = Query(20, ge=1, le=100)):
    with SessionLocal() as db:
        rows = db.scalars(select(UploadModel).order_by(desc(UploadModel.created_at)).limit(limit)).all()
        return {"uploads": [{"id": u.id, "filename": u.filename, "created_at": u.created_at.isoformat(),
                            "rows_processed": u.rows_processed, "errors": u.error_count,
                            "warnings": u.warning_count, "anomaly_windows": u.anomaly_windows,
                            "status": u.status} for u in rows]}

@app.get("/api/summary")
def summary(upload_id: int | None = None):
    with SessionLocal() as db:
        if upload_id is None:
            latest = db.scalar(select(UploadModel).order_by(desc(UploadModel.created_at)).limit(1))
            if latest is None:
                return {"empty": True}
            upload_id = latest.id
        upload = db.get(UploadModel, upload_id)
        if upload is None:
            raise HTTPException(404, "Upload not found")
        records = db.scalars(select(LogRecord).where(LogRecord.upload_id == upload_id).order_by(LogRecord.timestamp)).all()
        levels, services, timeline_map = {}, {}, {}
        for row in records:
            levels[row.level] = levels.get(row.level, 0) + 1
            services[row.service] = services.get(row.service, 0) + 1
            key = row.window
            slot = timeline_map.setdefault(key, {"timestamp": key, "total": 0, "errors": 0, "warnings": 0, "failed_logins": 0})
            slot["total"] += 1
            if row.level in ("ERROR", "CRITICAL"): slot["errors"] += 1
            if row.level == "WARNING": slot["warnings"] += 1
            slot["failed_logins"] += row.failed_login or 0
        insights = db.scalars(select(Insight).where(Insight.upload_id == upload_id).order_by(Insight.id)).all()
        timeline = list(timeline_map.values())
        return {
            "empty": False, "upload_id": upload.id, "filename": upload.filename,
            "uploaded_at": upload.created_at.isoformat(), "total_logs": upload.rows_processed,
            "errors": upload.error_count, "warnings": upload.warning_count,
            "critical": levels.get("CRITICAL", 0), "services": len(services),
            "anomaly_windows": upload.anomaly_windows, "model_status": "trained" if upload.anomaly_windows else "see_insights",
            "severity_counts": levels, "service_counts": dict(sorted(services.items(), key=lambda x: x[1], reverse=True)[:12]),
            "timeline": timeline,
            "insights": [{"kind": x.kind, "severity": x.severity, "title": x.title, "details": x.details, "recommendation": x.recommendation} for x in insights],
        }

@app.get("/api/logs")
def get_logs(upload_id: int | None = None, level: str | None = None,
             service: str | None = None, search: str | None = None,
             limit: int = Query(250, ge=1, le=1000), offset: int = Query(0, ge=0)):
    with SessionLocal() as db:
        query = select(LogRecord)
        if upload_id is None:
            latest = db.scalar(select(UploadModel).order_by(desc(UploadModel.created_at)).limit(1))
            if latest is None:
                return {"logs": [], "total": 0}
            upload_id = latest.id
        query = query.where(LogRecord.upload_id == upload_id)
        if level: query = query.where(LogRecord.level == level.upper())
        if service: query = query.where(LogRecord.service.ilike(f"%{service[:100]}%"))
        if search: query = query.where(LogRecord.message.ilike(f"%{search[:200]}%"))
        total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = db.scalars(query.order_by(desc(LogRecord.timestamp)).offset(offset).limit(limit)).all()
        return {"logs": [r.to_dict() for r in rows], "total": total, "limit": limit, "offset": offset}

@app.get("/api/insights")
def get_insights(upload_id: int | None = None):
    with SessionLocal() as db:
        if upload_id is None:
            latest = db.scalar(select(UploadModel).order_by(desc(UploadModel.created_at)).limit(1))
            if latest is None: return {"insights": []}
            upload_id = latest.id
        rows = db.scalars(select(Insight).where(Insight.upload_id == upload_id).order_by(Insight.id)).all()
        return {"insights": [{"kind": x.kind, "severity": x.severity, "title": x.title,
                              "details": x.details, "recommendation": x.recommendation} for x in rows]}
