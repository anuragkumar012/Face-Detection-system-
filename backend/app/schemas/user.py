from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class FaceEmbeddingSchema(BaseModel):
    id: int
    image_path: Optional[str] = None
    image_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class UserBase(BaseModel):
    name: str

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: int
    created_at: datetime
    image_url: Optional[str] = None
    embeddings: List[FaceEmbeddingSchema] = Field(default_factory=list)

    class Config:
        from_attributes = True
