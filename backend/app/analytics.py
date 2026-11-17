from __future__ import annotations
import re
from datetime import datetime, timezone
import pandas as pd
from sklearn.ensemble import IsolationForest

REQUIRED = {"timestamp", "level", "service", "message"}
NUMERIC = ["response_ms", "status_code", "failed_login"]
LEVELS = {"TRACE", "DEBUG", "INFO", "NOTICE", "WARNING", "WARN", "ERROR", "CRITICAL", "FATAL"}

def parse_log_file(filename: str, content: bytes) -> tuple[pd.DataFrame, list[str]]:
    errors: list[str] = []
    name = filename.lower()
    try:
        text = content.decode("utf-8-sig", errors="replace")
    except Exception:
        text = content.decode("latin-1", errors="replace")

    if name.endswith(".csv"):
        from io import StringIO
        try:
            df = pd.read_csv(StringIO(text), on_bad_lines="skip")
        except Exception as exc:
            raise ValueError(f"CSV could not be parsed: {exc}") from exc
        missing = REQUIRED - set(df.columns.str.strip().str.lower())
        # Normalize headers before required-column check.
        df.columns = [str(c).strip().lower() for c in df.columns]
        missing = REQUIRED - set(df.columns)
        if missing:
            raise ValueError("Missing required columns: " + ", ".join(sorted(missing)))
    elif name.endswith(".log") or name.endswith(".txt"):
        rows = []
        # Supports ISO timestamp LEVEL service message, with spaces in timestamp.
        patterns = [
            re.compile(r"^(?P<timestamp>\S+)\s+(?P<level>TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\s+(?P<service>[\w.-]+)\s+(?P<message>.*)$", re.I),
            re.compile(r"^(?P<timestamp>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(?P<level>TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|CRITICAL|FATAL)\s+(?P<service>[\w.-]+)\s+(?P<message>.*)$", re.I)
        ]
        for line_no, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            match = next((p.match(line.strip()) for p in patterns if p.match(line.strip())), None)
            if not match:
                errors.append(f"Line {line_no}: unrecognized format")
                continue
            rows.append(match.groupdict())
        df = pd.DataFrame(rows, columns=["timestamp", "level", "service", "message"])
        if df.empty:
            raise ValueError("No valid log lines found. Expected: ISO_TIMESTAMP LEVEL service message")
    else:
        raise ValueError("Supported formats are .csv, .log, and .txt")

    df.columns = [str(c).strip().lower() for c in df.columns]
    for col in ["level", "service", "message"]:
        df[col] = df[col].fillna("").astype(str).str.strip()
    df["level"] = df["level"].str.upper().replace({"WARN": "WARNING", "FATAL": "CRITICAL"})
    bad_level = ~df["level"].isin(LEVELS)
    if bad_level.any():
        errors.append(f"{int(bad_level.sum())} rows had unknown severity labels; retained as OTHER")
        df.loc[bad_level, "level"] = "OTHER"
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    invalid_ts = df["timestamp"].isna()
    if invalid_ts.any():
        errors.append(f"{int(invalid_ts.sum())} rows skipped due to invalid timestamps")
        df = df.loc[~invalid_ts].copy()
    empty = (df["service"] == "") | (df["message"] == "")
    if empty.any():
        errors.append(f"{int(empty.sum())} rows skipped due to empty service/message")
        df = df.loc[~empty].copy()
    for col in NUMERIC:
        if col not in df:
            df[col] = None
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["service"] = df["service"].str.slice(0, 100)
    df["message"] = df["message"].str.slice(0, 4000)
    df = df.sort_values("timestamp").reset_index(drop=True)
    if df.empty:
        raise ValueError("No valid log rows remained after validation")
    df["window_dt"] = df["timestamp"].dt.floor("5min")
    df["window"] = df["window_dt"].map(lambda x: x.isoformat())
    return df, errors

def analyze_logs(df: pd.DataFrame) -> dict:
    work = df.copy()
    work["is_error"] = work["level"].isin(["ERROR", "CRITICAL"]).astype(int)
    work["is_warning"] = (work["level"] == "WARNING").astype(int)
    work["is_failed_login"] = pd.to_numeric(work["failed_login"], errors="coerce").fillna(0)
    work["response_ms_num"] = pd.to_numeric(work["response_ms"], errors="coerce").fillna(0)
    windows = work.groupby("window_dt").agg(
        total_logs=("message", "size"),
        errors=("is_error", "sum"),
        warnings=("is_warning", "sum"),
        failed_logins=("is_failed_login", "sum"),
        avg_response_ms=("response_ms_num", "mean"),
        service_count=("service", "nunique"),
    ).reset_index()
    features = ["total_logs", "errors", "warnings", "failed_logins", "avg_response_ms", "service_count"]
    anomaly_indices: set[int] = set()
    model_status = "insufficient_data"
    if len(windows) >= 10 and any(windows[c].nunique() > 1 for c in features):
        model = IsolationForest(n_estimators=150, contamination="auto", random_state=42)
        windows["prediction"] = model.fit_predict(windows[features].fillna(0))
        windows["anomaly_score"] = model.decision_function(windows[features].fillna(0))
        anomaly_indices = set(windows.index[windows["prediction"] == -1].tolist())
        model_status = "trained"
    else:
        windows["prediction"] = 1
        windows["anomaly_score"] = None

    insights = []
    total_errors = int(work["is_error"].sum())
    total_warnings = int(work["is_warning"].sum())
    if total_errors:
        counts = work[work["is_error"] == 1]["service"].value_counts()
        top_service = str(counts.index[0])
        insights.append({
            "kind": "error_pattern", "severity": "high" if total_errors >= max(5, len(work)*0.05) else "medium",
            "title": "Error activity detected",
            "details": f"{total_errors} ERROR/CRITICAL events were found. The most affected service is {top_service} ({int(counts.iloc[0])} events).",
            "recommendation": f"Inspect recent {top_service} error messages, dependency health, and configuration changes."
        })
    if total_warnings:
        insights.append({
            "kind": "warning_pattern", "severity": "medium",
            "title": "Warnings need review",
            "details": f"{total_warnings} warning events were found across {int(work['service'].nunique())} services.",
            "recommendation": "Review warning trends and determine whether they precede errors or latency spikes."
        })
    if model_status == "trained":
        for idx in sorted(anomaly_indices, key=lambda i: windows.loc[i, "window_dt"])[-12:]:
            row = windows.loc[idx]
            insights.append({
                "kind": "ml_anomaly", "severity": "high" if row["errors"] > 0 or row["failed_logins"] > 0 else "medium",
                "title": "Unusual activity window",
                "details": f"{row['window_dt'].isoformat()} — {int(row['total_logs'])} logs, {int(row['errors'])} errors, {int(row['warnings'])} warnings, {int(row['failed_logins'])} failed-login signals.",
                "recommendation": "Compare this window with adjacent periods and inspect matching raw log entries. Anomaly detection flags unusual patterns, not confirmed incidents."
            })
    else:
        insights.append({
            "kind": "model_status", "severity": "low",
            "title": "Collect more varied time windows",
            "details": "Isolation Forest needs at least 10 five-minute windows and variation in the feature data.",
            "recommendation": "Upload a longer time series or use Generate demo logs to create a simulated incident."
        })
    timeline = []
    for idx, row in windows.iterrows():
        timeline.append({
            "timestamp": row["window_dt"].isoformat(),
            "total": int(row["total_logs"]), "errors": int(row["errors"]),
            "warnings": int(row["warnings"]), "failed_logins": int(row["failed_logins"]),
            "avg_response_ms": round(float(row["avg_response_ms"]), 2),
            "anomaly": idx in anomaly_indices,
            "anomaly_score": None if pd.isna(row.get("anomaly_score")) else round(float(row["anomaly_score"]), 5)
        })
    severity_counts = {str(k): int(v) for k, v in work["level"].value_counts().items()}
    service_counts = {str(k): int(v) for k, v in work["service"].value_counts().head(12).items()}
    return {
        "total_logs": len(work), "errors": total_errors, "warnings": total_warnings,
        "critical": int((work["level"] == "CRITICAL").sum()),
        "services": int(work["service"].nunique()),
        "anomaly_windows": len(anomaly_indices), "model_status": model_status,
        "severity_counts": severity_counts, "service_counts": service_counts,
        "timeline": timeline, "insights": insights,
    }
