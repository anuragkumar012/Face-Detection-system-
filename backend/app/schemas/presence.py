from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

class PresenceLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    name: str
    start_time: datetime
    last_seen: datetime
    duration: float
    image_url: Optional[str] = None

    model_config = {
        "from_attributes": True
    }

class PresenceSummaryResponse(BaseModel):
    total_known_persons: int
    total_unknown_persons: int
    known_time_present: float
    unknown_time_present: float
    history: List[PresenceLogResponse]
