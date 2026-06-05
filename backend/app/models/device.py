from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from datetime import datetime
from app.db.base import Base

class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(100), unique=True, index=True, nullable=False)
    hostname = Column(String(100), nullable=False)
    username = Column(String(100), nullable=False)
    os = Column(String(100), nullable=False)
    agent_version = Column(String(50), nullable=False)
    device_token = Column(String(500), nullable=True)
    status = Column(String(20), default="offline", nullable=False)  # "online", "offline"
    last_seen = Column(DateTime, default=datetime.utcnow, nullable=False)
    current_frame = Column(Text().with_variant(LONGTEXT, "mysql"), nullable=True)  # Base64 data URL
    recognized_person = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
