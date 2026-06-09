import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import app.db.base
from app.db.session import SessionLocal
from app.models.user import User


db = SessionLocal()
try:
    users = db.query(User).all()
    print(f"Found {len(users)} users:")
    for u in users:
        print(f"ID: {u.id}, Name: {u.name}, Created At: {u.created_at}")
finally:
    db.close()
