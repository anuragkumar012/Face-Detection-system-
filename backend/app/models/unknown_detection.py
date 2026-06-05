from sqlalchemy import Column, Integer, String, DateTime, LargeBinary, Float
from datetime import datetime
from app.db.base import Base

class UnknownDetection(Base):
    __tablename__ = "unknown_detections"

    id = Column(Integer, primary_key=True, index=True)
    image_path = Column(String(512), nullable=False)
    embedding = Column(LargeBinary, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    camera_id = Column(String(100), nullable=True)
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
