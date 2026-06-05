from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from datetime import datetime
from app.db.base import Base


class FaceCluster(Base):
    """Dedicated table for face cluster metadata.

    Each row represents one identity group (registered or unregistered).
    ``cluster_id`` matches the string key used throughout ``photo_scans.scan_details``
    so the two stores are always in sync.

    This table allows:
      - Fast O(1) label / user lookup without scanning JSON blobs.
      - Proper indexing and foreign-key joins.
      - Accurate face_count without iterating all scans at query time.
    """

    __tablename__ = "face_clusters"

    id = Column(Integer, primary_key=True, index=True)
    # Matches scan_details["cluster"]["cluster_id"]; e.g. "user-3" or "upload-abc-face-1"
    cluster_id = Column(String(255), unique=True, index=True, nullable=False)
    label = Column(String(255), nullable=False)
    # Null for unregistered clusters; set when the cluster is enrolled as a user.
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    face_count = Column(Integer, default=0, nullable=False)
    # Thumbnail: the scan and bounding box used as the cover image.
    thumbnail_scan_id = Column(
        Integer,
        ForeignKey("photo_scans.id", ondelete="SET NULL"),
        nullable=True,
    )
    thumbnail_bbox = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
