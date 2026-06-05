from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    # photo_scan_id links this embedding back to the scan that sourced it,
    # providing full referential traceability.  SET NULL on scan deletion so
    # the embedding is kept even if the original scan record is removed.
    photo_scan_id = Column(
        Integer,
        ForeignKey("photo_scans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    embedding = Column(LargeBinary, nullable=False)
    image_path = Column(String(512), nullable=True)
    angle = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="embeddings")
