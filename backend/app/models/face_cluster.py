from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from datetime import datetime
from app.db.base import Base


class FaceCluster(Base):
    __tablename__ = "face_clusters"

    id = Column(Integer, primary_key=True, index=True)
    cluster_id = Column(String(255), unique=True, index=True, nullable=False)
    label = Column(String(255), nullable=False)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    face_count = Column(Integer, default=0, nullable=False)
    thumbnail_scan_id = Column(
        Integer,
        ForeignKey("photo_scans.id", ondelete="SET NULL"),
        nullable=True,
    )
    thumbnail_bbox = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
