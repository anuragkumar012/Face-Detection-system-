from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, JSON, String

from app.db.base import Base


class PhotoScan(Base):
    __tablename__ = "photo_scans"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(30), nullable=False, default="frontend")
    device_id = Column(String(100), nullable=True, index=True)
    original_filename = Column(String(255), nullable=True)
    image_path = Column(String(512), nullable=False)
    face_count = Column(Integer, nullable=False, default=0)
    scan_details = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
