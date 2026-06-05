from datetime import datetime
from pydantic import BaseModel
from typing import List, Literal

class FaceMatch(BaseModel):
    user_id: int
    name: str
    confidence: float
    image_url: str | None = None

class RecognitionResponse(BaseModel):
    matches: List[FaceMatch]
    
class BoundingBox(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int

class DetectedFace(BaseModel):
    bbox: BoundingBox
    match: FaceMatch | None = None

class FaceFeatureStatus(BaseModel):
    eyes: bool
    nose: bool
    mouth: bool
    face_shape: bool
    relative_positions: bool

class EmbeddingSpaceInfo(BaseModel):
    model_name: str
    vector_dimensions: int
    vector_norm: float
    signature_preview: List[float]
    similarity_metric: str
    same_person_rule: str
    different_person_rule: str

class FaceClusterInfo(BaseModel):
    cluster_id: str
    label: str
    is_new_cluster: bool
    best_similarity: float
    threshold: float
    comparison_count: int
    matched_user_id: int | None = None
    matched_user_name: str | None = None

class FaceVariationInfo(BaseModel):
    lighting: str
    pose: str
    camera_quality: str
    occlusion_risk: str
    supported_changes: List[str]
    note: str

class PhotoScanFace(BaseModel):
    bbox: BoundingBox
    confidence: float
    landmarks: dict[str, dict[str, int]] | None = None
    features: FaceFeatureStatus
    embedding_space: EmbeddingSpaceInfo
    cluster: FaceClusterInfo
    variation_handling: FaceVariationInfo

class PhotoScanResponse(BaseModel):
    id: int
    image_url: str
    original_filename: str | None = None
    source: str
    device_id: str | None = None
    face_count: int
    faces: List[PhotoScanFace]
    created_at: datetime

class PhotoScanListResponse(BaseModel):
    scans: List[PhotoScanResponse]

LivePreviewSource = Literal["admin", "user", "device"]

class LivePreviewFrame(BaseModel):
    source: LivePreviewSource
    frame_data_url: str | None = None
    updated_at: datetime | None = None
    is_live: bool
    detections: List[DetectedFace] | None = None
