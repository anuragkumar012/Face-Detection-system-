import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        env_ignore_empty=True,
    )

    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Face Recognition API"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    HOST: str = "127.0.0.1"
    PORT: str = "3306"
    USER: str = "root"
    PASSWORD: str = ""
    DB_NAME: str = "face Agent"
    DATABASE_URL: str = ""
    SIMILARITY_THRESHOLD: float = 0.5
    SIMILARITY_METRIC: str = "cosine"
    EUCLIDEAN_THRESHOLD: float = 0.9
    UPLOAD_DIR: str = "./uploads"
    CAMERA_SOURCE: str = "0"
    AUTH_SECRET_KEY: str = "face-recognition-demo-secret"
    NGROK_AUTHTOKEN: str | None = None
    NGROK_DOMAIN: str | None = None
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin123"


settings = Settings()

# Ensure upload directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
