from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str
    role: Literal["admin", "user"]


class LoginResponse(BaseModel):
    id: int
    username: str
    role: Literal["admin", "user"]
    created_at: datetime

    class Config:
        from_attributes = True
