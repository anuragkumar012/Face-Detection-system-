from pydantic import BaseModel
from datetime import datetime

class DeviceRegister(BaseModel):
    device_id: str
    hostname: str
    username: str
    os: str
    agent_version: str

class DeviceHeartbeat(BaseModel):
    device_id: str
    status: str
    agent_version: str

class DeviceResponse(BaseModel):
    device_id: str
    hostname: str
    username: str
    os: str
    agent_version: str
    status: str
    last_seen: datetime
    current_frame: str | None = None
    recognized_person: str | None = None

    class Config:
        from_attributes = True
