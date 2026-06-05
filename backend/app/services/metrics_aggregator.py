from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.presence_session import PresenceSession
from app.services.presence_tracker import presence_tracker, format_duration

class MetricsAggregator:
    def aggregate_metrics(self, db: Session) -> dict:
        """
        Aggregate real-time metrics for the dashboard.
        Calculates:
        - Total unique known users seen (unique user_id)
        - Total unique unknown sessions (unique sessions where person_type='unknown')
        - Known time present (sum of ended known session durations + elapsed time of active known sessions)
        - Unknown time present (sum of ended unknown session durations + elapsed time of active unknown sessions)
        """
        now = datetime.utcnow()

        # 1. Total unique known users detected
        total_known = (
            db.query(PresenceSession.user_id)
            .filter(PresenceSession.detection_type == "KNOWN")
            .filter(PresenceSession.user_id != None)
            .distinct()
            .count()
        )

        # 2. Total unique unknown face tracking sessions
        total_unknown = (
            db.query(PresenceSession.id)
            .filter(PresenceSession.detection_type == "UNKNOWN")
            .count()
        )

        # 3. Sum of durations for ended known sessions
        ended_known_duration = (
            db.query(func.sum(PresenceSession.duration_seconds))
            .filter(PresenceSession.detection_type == "KNOWN")
            .filter(PresenceSession.session_status == "COMPLETED")
            .scalar()
        ) or 0.0

        # 4. Sum of durations for ended unknown sessions
        ended_unknown_duration = (
            db.query(func.sum(PresenceSession.duration_seconds))
            .filter(PresenceSession.detection_type == "UNKNOWN")
            .filter(PresenceSession.session_status == "COMPLETED")
            .scalar()
        ) or 0.0

        # 5. Calculate elapsed duration of currently active sessions dynamically
        active_known_duration = 0.0
        active_unknown_duration = 0.0

        for person_id, session_info in presence_tracker.active_sessions.items():
            elapsed = (now - session_info["entry_time"]).total_seconds()
            if session_info["detection_type"] == "KNOWN":
                active_known_duration += elapsed
            elif session_info["detection_type"] == "UNKNOWN":
                active_unknown_duration += elapsed

        total_known_duration = ended_known_duration + active_known_duration
        total_unknown_duration = ended_unknown_duration + active_unknown_duration

        return {
            "knownPersons": total_known,
            "unknownPersons": total_unknown,
            "knownTimePresent": format_duration(total_known_duration),
            "unknownTimePresent": format_duration(total_unknown_duration),
            "rawKnownTime": total_known_duration,
            "rawUnknownTime": total_unknown_duration
        }

metrics_aggregator = MetricsAggregator()
