from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

def _build_engine_url():
    if settings.DATABASE_URL.strip():
        return settings.DATABASE_URL

    return URL.create(
        "mysql+pymysql",
        username=settings.USER,
        password=settings.PASSWORD,
        host=settings.HOST,
        port=int(settings.PORT),
        database=settings.DB_NAME,
    )


engine_url = _build_engine_url()
engine_kwargs = {"pool_pre_ping": True}
if str(engine_url).startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(engine_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
