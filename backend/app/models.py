
from sqlalchemy import (
    String,
    Text,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone

from app.db import Base


def utcnow():
    return datetime.now(timezone.utc)


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )
    rows_processed: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    anomaly_windows: Mapped[int] = mapped_column(Integer, default=0)
    storage_uri: Mapped[str | None] = mapped_column(
        String(1024),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="completed")

    logs: Mapped[list["LogRecord"]] = relationship(
        "LogRecord",
        back_populates="upload",
        cascade="all, delete-orphan",
    )

    insights: Mapped[list["Insight"]] = relationship(
        "Insight",
        back_populates="upload",
        cascade="all, delete-orphan",
    )


class LogRecord(Base):
    __tablename__ = "logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    upload_id: Mapped[int] = mapped_column(
        ForeignKey("uploads.id", ondelete="CASCADE"),
        index=True,
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        index=True,
    )
    level: Mapped[str] = mapped_column(String(20), index=True)
    service: Mapped[str] = mapped_column(String(100), index=True)
    message: Mapped[str] = mapped_column(Text)
    response_ms: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )
    status_code: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    failed_login: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    window: Mapped[str] = mapped_column(String(32), index=True)

    # FIX: Connect each log record to its parent upload.
    upload: Mapped["Upload"] = relationship(
        "Upload",
        back_populates="logs",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "level": self.level,
            "service": self.service,
            "message": self.message,
            "response_ms": self.response_ms,
            "status_code": self.status_code,
            "failed_login": self.failed_login,
        }


class Insight(Base):
    __tablename__ = "insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    upload_id: Mapped[int] = mapped_column(
        ForeignKey("uploads.id", ondelete="CASCADE"),
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(255))
    details: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )

    upload: Mapped["Upload"] = relationship(
        "Upload",
        back_populates="insights",
    )


Index("ix_logs_upload_timestamp", LogRecord.upload_id, LogRecord.timestamp)
