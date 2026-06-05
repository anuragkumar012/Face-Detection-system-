from sqlalchemy import Column, Integer, String, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class PresenceSession(Base):
    __tablename__ = "presence_sessions"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    person_type = Column(String(20), nullable=False)  # 'known' or 'unknown'
    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, default=0.0, nullable=False)
    status = Column(String(20), default="active", nullable=False)  # 'active' or 'ended'
    
    # Helpers for easy serialization / display
    name = Column(String(255), nullable=False)  # User's name or 'Unknown'
    image_path = Column(String(512), nullable=True)  # Profile image path or cropped unknown face path

    # New fields
    entry_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    exit_time = Column(DateTime, nullable=True)
    best_frame_path = Column(String(512), nullable=True)
    average_confidence = Column(Float, default=0.0, nullable=False)
    max_confidence = Column(Float, default=0.0, nullable=False)
    detection_type = Column(String(20), default="UNKNOWN", nullable=False)  # 'KNOWN', 'UNKNOWN', 'UNVERIFIED'
    session_status = Column(String(20), default="ACTIVE", nullable=False)  # 'ACTIVE', 'COMPLETED'
    timeline_data = Column(Text, nullable=True)  # JSON string of timeline events
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User")
