from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, UniqueConstraint

from app.db.base import Base


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("username", "role", name="uq_accounts_username_role"),)

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), index=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    role = Column(String(20), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
