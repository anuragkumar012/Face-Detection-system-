from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

class PersonFaceInstance(BaseModel):
    photo_scan_id: int
    photo_scan_filename: Optional[str] = None
    photo_scan_created_at: datetime
    image_url: str
    bbox: dict
    confidence: float
    is_confirmed: Optional[bool] = False
    variation_handling: Optional[dict] = None
    features: Optional[dict] = None

class PersonClusterResponse(BaseModel):
    cluster_id: str
    label: str
    is_registered: bool
    user_id: Optional[int] = None
    cover_image_url: Optional[str] = None
    cover_bbox: Optional[dict] = None
    faces: List[PersonFaceInstance]

class EnrollClusterRequest(BaseModel):
    name: str

class ConfirmFaceRequest(BaseModel):
    photo_scan_id: int
    x1: int
    y1: int
    x2: int
    y2: int

class MergePeopleRequest(BaseModel):
    primary_cluster_id: str
    secondary_cluster_id: str

class RemoveMatchRequest(BaseModel):
    photo_scan_id: int
    x1: int
    y1: int
    x2: int
    y2: int
