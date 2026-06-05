import app.db.base
import json
from datetime import datetime, timedelta
from app.db.session import SessionLocal
from app.models.presence_session import PresenceSession

def seed():
    db = SessionLocal()
    try:
        # Clear existing sessions to make manual verification clean
        db.query(PresenceSession).delete()
        db.commit()

        now = datetime.utcnow()
        yesterday = now - timedelta(days=1)

        # 1. Active Session - Known User (Anurag Kumar, ID 12)
        sess1 = PresenceSession(
            track_id=101,
            user_id=12,
            person_type="known",
            start_time=now - timedelta(minutes=15),
            last_seen=now,
            entry_time=now - timedelta(minutes=15),
            duration_seconds=900.0,
            status="active",
            session_status="ACTIVE",
            name="Anurag Kumar",
            average_confidence=0.89,
            max_confidence=0.95,
            detection_type="KNOWN",
            timeline_data=json.dumps([
                {"timestamp": (now - timedelta(minutes=15)).strftime("%H:%M:%S"), "event": "Entry"},
                {"timestamp": (now - timedelta(minutes=10)).strftime("%H:%M:%S"), "event": "Active (Returned)"},
                {"timestamp": (now - timedelta(minutes=5)).strftime("%H:%M:%S"), "event": "Active (Still Present)"}
            ])
        )

        # 2. Completed Session - Known User (Anurag Kumar, ID 12) - Yesterday
        sess2 = PresenceSession(
            track_id=102,
            user_id=12,
            person_type="known",
            start_time=yesterday - timedelta(hours=2),
            last_seen=yesterday - timedelta(hours=2, minutes=-30),
            end_time=yesterday - timedelta(hours=2, minutes=-30),
            entry_time=yesterday - timedelta(hours=2),
            exit_time=yesterday - timedelta(hours=2, minutes=-30),
            duration_seconds=1800.0,
            status="ended",
            session_status="COMPLETED",
            name="Anurag Kumar",
            average_confidence=0.91,
            max_confidence=0.96,
            detection_type="KNOWN",
            timeline_data=json.dumps([
                {"timestamp": (yesterday - timedelta(hours=2)).strftime("%H:%M:%S"), "event": "Entry"},
                {"timestamp": (yesterday - timedelta(hours=1, minutes=45)).strftime("%H:%M:%S"), "event": "Active (Returned)"},
                {"timestamp": (yesterday - timedelta(hours=1, minutes=30)).strftime("%H:%M:%S"), "event": "Exit (Timeout)"}
            ])
        )

        # 3. Completed Session - Unknown Face - Today
        sess3 = PresenceSession(
            track_id=103,
            user_id=None,
            person_type="unknown",
            start_time=now - timedelta(hours=3),
            last_seen=now - timedelta(hours=2, minutes=30),
            end_time=now - timedelta(hours=2, minutes=30),
            entry_time=now - timedelta(hours=3),
            exit_time=now - timedelta(hours=2, minutes=30),
            duration_seconds=1800.0,
            status="ended",
            session_status="COMPLETED",
            name="Unknown",
            average_confidence=0.75,
            max_confidence=0.82,
            detection_type="UNKNOWN",
            timeline_data=json.dumps([
                {"timestamp": (now - timedelta(hours=3)).strftime("%H:%M:%S"), "event": "Entry"},
                {"timestamp": (now - timedelta(hours=2, minutes=30)).strftime("%H:%M:%S"), "event": "Exit (Timeout)"}
            ])
        )

        # 4. Completed Session - Unverified Detection - Today
        sess4 = PresenceSession(
            track_id=104,
            user_id=None,
            person_type="unknown",
            start_time=now - timedelta(hours=1),
            last_seen=now - timedelta(minutes=50),
            end_time=now - timedelta(minutes=50),
            entry_time=now - timedelta(hours=1),
            exit_time=now - timedelta(minutes=50),
            duration_seconds=600.0,
            status="ended",
            session_status="COMPLETED",
            name="Unverified",
            average_confidence=0.55,
            max_confidence=0.62,
            detection_type="UNVERIFIED",
            timeline_data=json.dumps([
                {"timestamp": (now - timedelta(hours=1)).strftime("%H:%M:%S"), "event": "Entry"},
                {"timestamp": (now - timedelta(minutes=50)).strftime("%H:%M:%S"), "event": "Exit (Timeout)"}
            ])
        )

        db.add_all([sess1, sess2, sess3, sess4])
        db.commit()
        print("Successfully seeded 4 dummy presence sessions.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
