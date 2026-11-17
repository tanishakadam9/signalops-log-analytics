import os
import time
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

logger = logging.getLogger(__name__)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./loganalytics.db"
)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

def init_db():
    # Compose uses a health check; retry also helps with managed cloud databases.
    from app.models import Upload, LogRecord, Insight  # noqa: F401
    for attempt in range(15):
        try:
            Base.metadata.create_all(bind=engine)
            logger.info("database_ready")
            return
        except Exception:
            if attempt == 14:
                raise
            logger.warning("database_not_ready_retrying", extra={"attempt": attempt + 1})
            time.sleep(2)
