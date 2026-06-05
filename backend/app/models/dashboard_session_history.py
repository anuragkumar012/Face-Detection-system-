from sqlalchemy import Column, Integer, String, DateTime, Float, Text
from datetime import datetime
from app.db.base import Base

class DashboardSessionHistory(Base):
    __tablename__ = "dashboard_session_histories"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(String(100), nullable=False, index=True)
    session_start = Column(DateTime, nullable=False)
    session_end = Column(DateTime, nullable=False)
    total_known_persons = Column(Integer, default=0, nullable=False)
    total_unknown_persons = Column(Integer, default=0, nullable=False)
    known_time_present = Column(Float, default=0.0, nullable=False)  # in seconds
    unknown_time_present = Column(Float, default=0.0, nullable=False)  # in seconds
    presence_logs_json = Column(Text, nullable=True)  # JSON-serialized list of presence logs during the session
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
