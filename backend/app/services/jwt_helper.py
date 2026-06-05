import jwt
from datetime import datetime, timedelta, timezone
from app.core.config import settings

def create_device_token(device_id: str) -> str:
    payload = {
        "sub": device_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=365 * 10),  # Long-lived device token (10 years)
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, settings.AUTH_SECRET_KEY, algorithm="HS256")

def verify_device_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, settings.AUTH_SECRET_KEY, algorithms=["HS256"])
        return payload.get("sub")
    except Exception:
        return None
