import pandas as pd
from app.analytics import parse_log_file, analyze_logs

def test_parse_csv():
    content = b"timestamp,level,service,message\n2026-10-27T08:00:00Z,INFO,api,hello\n"
    df, warnings = parse_log_file("x.csv", content)
    assert len(df) == 1
    assert df.iloc[0]["level"] == "INFO"

def test_parse_log_lines():
    content = b"2026-10-27T08:00:00Z ERROR db connection failed\nbad line\n"
    df, warnings = parse_log_file("x.log", content)
    assert len(df) == 1
    assert warnings

def test_analyzer_returns_insights():
    rows=[]
    start=pd.Timestamp("2026-10-27T08:00:00Z")
    for i in range(120):
        rows.append({"timestamp": start+pd.Timedelta(minutes=i), "level":"ERROR" if 70 <= i <= 90 else "INFO",
                     "service":"db" if 70 <= i <= 90 else "api", "message":"event",
                     "response_ms":5000 if 70 <= i <= 90 else 100, "status_code":503 if 70 <= i <= 90 else 200,
                     "failed_login":0, "window_dt":(start+pd.Timedelta(minutes=i)).floor("5min"),
                     "window":(start+pd.Timedelta(minutes=i)).floor("5min").isoformat()})
    df=pd.DataFrame(rows)
    result=analyze_logs(df)
    assert result["total_logs"] == 120
    assert result["errors"] > 0
    assert result["model_status"] == "trained"
