import os
import uuid
import cv2
import time
import logging
import json
import numpy as np
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.presence_session import PresenceSession
from app.models.presence_log import PresenceLog
from app.models.unknown_detection import UnknownDetection
from app.models.user import User
from app.core.config import settings

logger = logging.getLogger(__name__)


def format_duration(seconds: float) -> str:
    """Format duration in HH:MM:SS format."""
    s = int(round(seconds))
    hours, remainder = divmod(s, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    """Calculate the cosine similarity between two 1D arrays."""
    if v1 is None or v2 is None:
        return 0.0
    v1_flat = v1.flatten()
    v2_flat = v2.flatten()
    dot = float(np.dot(v1_flat, v2_flat))
    norm_v1 = float(np.linalg.norm(v1_flat))
    norm_v2 = float(np.linalg.norm(v2_flat))
    if norm_v1 == 0.0 or norm_v2 == 0.0:
        return 0.0
    return dot / (norm_v1 * norm_v2)


def _has_relative_positions(landmarks: dict[str, dict[str, int]]) -> bool:
    """Validate relative keypoint alignment to determine if face is frontal/visible."""
    left_eye = landmarks.get("left_eye")
    right_eye = landmarks.get("right_eye")
    nose = landmarks.get("nose")
    left_mouth = landmarks.get("left_mouth")
    right_mouth = landmarks.get("right_mouth")

    if not all([left_eye, right_eye, nose, left_mouth, right_mouth]):
        return False

    eye_y = (left_eye["y"] + right_eye["y"]) / 2
    mouth_y = (left_mouth["y"] + right_mouth["y"]) / 2
    eye_min_x = min(left_eye["x"], right_eye["x"])
    eye_max_x = max(left_eye["x"], right_eye["x"])
    mouth_min_x = min(left_mouth["x"], right_mouth["x"])
    mouth_max_x = max(left_mouth["x"], right_mouth["x"])

    return (
        eye_y < nose["y"] < mouth_y
        and eye_min_x <= nose["x"] <= eye_max_x
        and mouth_min_x < mouth_max_x
    )


class PresenceTracker:
    """Tracks presence of detected people in real-time.

    Avoids creating duplicate logs by tracking session state per person ID.
    Performs database writes in a throttled heartbeat and finishes sessions upon timeout.
    """

    def __init__(self) -> None:
        # person_id -> dict containing tracking info:
        # { session_id, entry_time, last_seen, name, user_id, detection_type, confidences,
        #   best_score, best_frame_path, best_embedding, timeline, last_db_write_time,
        #   last_timeline_log_time, associated_track_ids }
        self.active_sessions: dict[str, dict] = {}
        
        # track_id -> person_id
        self.track_to_person: dict[int, str] = {}

        # list of recently ended session dicts:
        # [ { ..., ended_at: datetime } ]
        self.recent_sessions: list[dict] = []
        
        # track_id -> cached recognition dict:
        # { name, user_id, confidence, embedding, det_score, landmarks, last_recognition_time }
        self.recognition_cache: dict[int, dict] = {}

    @property
    def gateway(self):
        """Lazy load WebSocketGateway to avoid circular imports."""
        from app.api.websocket_gateway import gateway
        return gateway

    def get_cached_recognition(self, track_id: int) -> dict | None:
        """Retrieve the cached face recognition results for a track ID."""
        return self.recognition_cache.get(track_id)

    def cache_recognition(
        self, track_id: int, name: str, user_id: int | None, confidence: float,
        embedding = None, det_score: float = 0.0, landmarks = None
    ) -> None:
        """Cache face recognition results including the embedding for a track ID."""
        self.recognition_cache[track_id] = {
            "name": name,
            "user_id": user_id,
            "confidence": confidence,
            "embedding": embedding,
            "det_score": det_score,
            "landmarks": landmarks,
            "last_recognition_time": time.time()
        }

    def clear_track_cache(self, track_id: int) -> None:
        """Clear the cached recognition for a track ID."""
        self.recognition_cache.pop(track_id, None)

    def process_frame(self, db: Session, tracks_data: list[dict], frame_img, broadcast_callback=None) -> None:
        """Process tracking data from the current frame to manage presence log/session lifecycles."""
        now = datetime.utcnow()
        current_timestamp = time.time()

        # Purge recent sessions older than 15 seconds
        self.recent_sessions = [
            s for s in self.recent_sessions
            if (now - s["ended_at"]).total_seconds() <= 15.0
        ]

        active_person_ids = set()

        for track in tracks_data:
            track_id = track["track_id"]
            user_id = track.get("user_id")
            name = track.get("name", "Unknown")
            confidence = track.get("confidence", 0.0)
            bbox = track["bbox"]
            detection_type = track.get("detection_type", "UNKNOWN")
            embedding = track.get("embedding")
            det_score = track.get("det_score", 0.0)
            landmarks = track.get("landmarks")

            # Real-time WebSocket updates: Broadcast face detected and category
            self.gateway.broadcast_face_detected(name, user_id, confidence)
            if detection_type == "KNOWN" and user_id is not None:
                self.gateway.broadcast_known_user(name, user_id, confidence)
            else:
                self.gateway.broadcast_unknown_user(confidence)

            # Determine person_id for the track
            person_id = None
            if track_id in self.track_to_person:
                pid = self.track_to_person[track_id]
                if pid in self.active_sessions:
                    person_id = pid
                else:
                    self.track_to_person.pop(track_id, None)

            if person_id is None:
                if detection_type == "KNOWN":
                    temp_pid = f"user-{user_id}"
                    # Check if already active
                    if temp_pid in self.active_sessions:
                        person_id = temp_pid
                        self.track_to_person[track_id] = person_id
                        self.active_sessions[person_id]["associated_track_ids"].add(track_id)
                    else:
                        # Check if recently ended
                        recent_match = next((s for s in self.recent_sessions if s["person_id"] == temp_pid), None)
                        if recent_match:
                            person_id = temp_pid
                            # Resume session (intelligent merge)
                            self.recent_sessions.remove(recent_match)
                            self.active_sessions[person_id] = recent_match
                            recent_match["associated_track_ids"] = {track_id}
                            recent_match["timeline"].append({"timestamp": now.strftime("%H:%M:%S"), "event": "Active (Returned)"})
                            self.track_to_person[track_id] = person_id
                            
                            # Update DB record to ACTIVE
                            db_session = db.query(PresenceSession).filter(PresenceSession.id == recent_match["session_id"]).first()
                            if db_session:
                                db_session.session_status = "ACTIVE"
                                db_session.status = "active"
                                db_session.last_seen = now
                                db_session.timeline_data = json.dumps(recent_match["timeline"])
                                db.commit()
                            logger.info(f"Merged/resumed session for known user {name} ({person_id})")
                
                elif detection_type == "UNKNOWN" and embedding is not None:
                    # Match against active unknown sessions
                    best_match_id = None
                    best_sim = 0.0
                    for pid, s in self.active_sessions.items():
                        if s["detection_type"] == "UNKNOWN" and s.get("best_embedding") is not None:
                            sim = cosine_similarity(embedding, s["best_embedding"])
                            if sim >= settings.SIMILARITY_THRESHOLD and sim > best_sim:
                                best_sim = sim
                                best_match_id = pid
                    
                    # Match against recent unknown sessions
                    recent_match = None
                    for s in self.recent_sessions:
                        if s["detection_type"] == "UNKNOWN" and s.get("best_embedding") is not None:
                            sim = cosine_similarity(embedding, s["best_embedding"])
                            if sim >= settings.SIMILARITY_THRESHOLD and sim > best_sim:
                                best_sim = sim
                                best_match_id = s["person_id"]
                                recent_match = s

                    if best_match_id:
                        person_id = best_match_id
                        if recent_match:
                            # Resume session (intelligent merge)
                            self.recent_sessions.remove(recent_match)
                            self.active_sessions[person_id] = recent_match
                            recent_match["associated_track_ids"] = {track_id}
                            recent_match["timeline"].append({"timestamp": now.strftime("%H:%M:%S"), "event": "Active (Returned)"})
                            self.track_to_person[track_id] = person_id
                            
                            # Update DB record to ACTIVE
                            db_session = db.query(PresenceSession).filter(PresenceSession.id == recent_match["session_id"]).first()
                            if db_session:
                                db_session.session_status = "ACTIVE"
                                db_session.status = "active"
                                db_session.last_seen = now
                                db_session.timeline_data = json.dumps(recent_match["timeline"])
                                db.commit()
                            logger.info(f"Merged/resumed session for unknown face {person_id} with similarity {best_sim:.2f}")
                        else:
                            self.track_to_person[track_id] = person_id
                            self.active_sessions[person_id]["associated_track_ids"].add(track_id)

            # Create new session if still not assigned
            if not person_id:
                if detection_type == "KNOWN":
                    person_id = f"user-{user_id}"
                elif detection_type == "UNKNOWN":
                    person_id = f"unknown-{uuid.uuid4().hex[:8]}"
                else:
                    person_id = f"unverified-{track_id}"
                
                # Setup active tracking
                self.track_to_person[track_id] = person_id
                
                # Crop face to store initial frame
                h_img, w_img = frame_img.shape[:2]
                x1, y1, x2, y2 = bbox
                x1, y1 = max(0, int(x1)), max(0, int(y1))
                x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
                face_crop = frame_img[y1:y2, x1:x2] if (x2 > x1 and y2 > y1) else None

                cropped_img_path = None
                if face_crop is not None and face_crop.size > 0:
                    filename = f"crop_{person_id}_{uuid.uuid4().hex[:8]}.jpg"
                    filepath = os.path.join(settings.UPLOAD_DIR, filename)
                    cv2.imwrite(filepath, face_crop)
                    cropped_img_path = filepath

                    # For UNKNOWN (and not UNVERIFIED), save to unknown_detections table for enrollment flow compat
                    if detection_type == "UNKNOWN":
                        unknown_det = UnknownDetection(
                            image_path=filepath,
                            embedding=embedding.tobytes() if embedding is not None else None,
                            timestamp=now,
                            camera_id=str(settings.CAMERA_SOURCE),
                            confidence=confidence
                        )
                        db.add(unknown_det)
                        db.commit()

                timeline = [{"timestamp": now.strftime("%H:%M:%S"), "event": "Entry"}]

                # Create the new PresenceSession record
                session = PresenceSession(
                    track_id=track_id,
                    user_id=user_id,
                    person_type="known" if detection_type == "KNOWN" else "unknown",
                    start_time=now,
                    last_seen=now,
                    entry_time=now,
                    duration_seconds=0.0,
                    status="active",
                    session_status="ACTIVE",
                    detection_type=detection_type,
                    name=name,
                    image_path=cropped_img_path,
                    best_frame_path=cropped_img_path,
                    average_confidence=confidence,
                    max_confidence=confidence,
                    timeline_data=json.dumps(timeline)
                )
                db.add(session)
                db.commit()
                db.refresh(session)

                # Initialize frame scoring
                var = cv2.Laplacian(cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() if face_crop is not None else 0.0
                is_frontal = _has_relative_positions(landmarks) if landmarks else False
                best_score = (x2-x1) * (y2-y1) * confidence * var * (1.5 if is_frontal else 1.0)

                self.active_sessions[person_id] = {
                    "person_id": person_id,
                    "session_id": session.id,
                    "entry_time": now,
                    "last_seen": now,
                    "name": name,
                    "user_id": user_id,
                    "detection_type": detection_type,
                    "confidences": [confidence],
                    "best_score": best_score,
                    "best_frame_path": cropped_img_path,
                    "best_embedding": embedding,
                    "timeline": timeline,
                    "last_db_write_time": current_timestamp,
                    "last_timeline_log_time": current_timestamp,
                    "associated_track_ids": {track_id}
                }

                logger.info(f"Created new {detection_type} session for {name} ({person_id})")

                # Broadcast attendance start
                self.gateway.broadcast_attendance_started(name, user_id, confidence)

                if broadcast_callback:
                    imageUrl = None
                    if cropped_img_path:
                        imageUrl = f"/uploads/{os.path.basename(cropped_img_path)}"
                    broadcast_callback("presence_log_update", {
                        "sessionId": f"S{session.id}",
                        "user": name,
                        "status": "ACTIVE",
                        "startTime": now.strftime("%H:%M:%S"),
                        "imageUrl": imageUrl
                    })
            else:
                # Update existing session
                session_info = self.active_sessions[person_id]
                session_info["last_seen"] = now
                session_info["confidences"].append(confidence)

                # Frame quality scoring for best frame selection
                h_img, w_img = frame_img.shape[:2]
                x1, y1, x2, y2 = bbox
                x1, y1 = max(0, int(x1)), max(0, int(y1))
                x2, y2 = min(w_img, int(x2)), min(h_img, int(y2))
                face_crop = frame_img[y1:y2, x1:x2] if (x2 > x1 and y2 > y1) else None

                if face_crop is not None and face_crop.size > 0:
                    var = cv2.Laplacian(cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
                    is_frontal = _has_relative_positions(landmarks) if landmarks else False
                    score = (x2-x1) * (y2-y1) * confidence * var * (1.5 if is_frontal else 1.0)

                    if score > session_info.get("best_score", 0.0):
                        filename = f"crop_{person_id}_{uuid.uuid4().hex[:8]}.jpg"
                        filepath = os.path.join(settings.UPLOAD_DIR, filename)
                        cv2.imwrite(filepath, face_crop)

                        # Delete old best frame
                        old_best = session_info.get("best_frame_path")
                        if old_best and os.path.exists(old_best):
                            try:
                                os.remove(old_best)
                            except Exception:
                                pass
                        
                        session_info["best_frame_path"] = filepath
                        session_info["best_score"] = score
                        session_info["best_embedding"] = embedding

                # Log Active timeline event (at most once per 15 seconds)
                if current_timestamp - session_info.get("last_timeline_log_time", 0) >= 15.0:
                    session_info["timeline"].append({"timestamp": now.strftime("%H:%M:%S"), "event": "Active"})
                    session_info["last_timeline_log_time"] = current_timestamp

                # Throttled DB write: write only every 3 seconds for active sessions
                if current_timestamp - session_info["last_db_write_time"] >= 3.0:
                    session_id = session_info["session_id"]
                    avg_conf = sum(session_info["confidences"]) / len(session_info["confidences"])
                    max_conf = max(session_info["confidences"])

                    db_session = db.query(PresenceSession).filter(PresenceSession.id == session_id).first()
                    duration_sec = (now - session_info["entry_time"]).total_seconds()

                    if db_session:
                        db_session.last_seen = now
                        db_session.duration_seconds = duration_sec
                        db_session.average_confidence = avg_conf
                        db_session.max_confidence = max_conf
                        db_session.best_frame_path = session_info["best_frame_path"]
                        db_session.image_path = session_info["best_frame_path"]
                        db_session.timeline_data = json.dumps(session_info["timeline"])
                        db.commit()

                    if broadcast_callback and db_session:
                        imageUrl = None
                        if db_session.best_frame_path:
                            imageUrl = f"/uploads/{os.path.basename(db_session.best_frame_path)}"
                        broadcast_callback("presence_log_update", {
                            "sessionId": f"S{db_session.id}",
                            "user": db_session.name,
                            "status": "ACTIVE",
                            "startTime": db_session.entry_time.strftime("%H:%M:%S"),
                            "imageUrl": imageUrl
                        })
                    session_info["last_db_write_time"] = current_timestamp

            active_person_ids.add(person_id)

    def check_expired_sessions(self, db: Session, broadcast_callback=None) -> None:
        """Check for active sessions that have disappeared for longer than threshold (15 seconds)."""
        now = datetime.utcnow()
        absence_threshold_seconds = 15.0
        expired_person_ids = []

        for person_id, session_info in self.active_sessions.items():
            time_since_seen = (now - session_info["last_seen"]).total_seconds()
            if time_since_seen > absence_threshold_seconds:
                expired_person_ids.append(person_id)

        for person_id in expired_person_ids:
            session_info = self.active_sessions[person_id]
            session_id = session_info["session_id"]

            db_session = db.query(PresenceSession).filter(PresenceSession.id == session_id).first()

            last_seen_time = session_info["last_seen"]
            duration = (last_seen_time - session_info["entry_time"]).total_seconds()
            avg_conf = sum(session_info["confidences"]) / len(session_info["confidences"])
            max_conf = max(session_info["confidences"])

            # Append Exit event to timeline
            session_info["timeline"].append({"timestamp": last_seen_time.strftime("%H:%M:%S"), "event": "Exit"})

            if db_session:
                db_session.last_seen = last_seen_time
                db_session.exit_time = last_seen_time
                db_session.end_time = last_seen_time
                db_session.duration_seconds = duration
                db_session.average_confidence = avg_conf
                db_session.max_confidence = max_conf
                db_session.status = "ended"
                db_session.session_status = "COMPLETED"
                db_session.timeline_data = json.dumps(session_info["timeline"])
                db.commit()

                # Store details in dashboard_session_histories table
                try:
                    from app.models.dashboard_session_history import DashboardSessionHistory
                    from app.models.device import Device
                    import socket

                    local_hostname = socket.gethostname()
                    dev = db.query(Device).filter(Device.hostname == local_hostname).first()
                    if not dev:
                        dev = db.query(Device).first()
                    real_device_id = dev.device_id if dev else "local-webcam"

                    imageUrl = None
                    if db_session.best_frame_path:
                        imageUrl = f"/uploads/{os.path.basename(db_session.best_frame_path)}"
                    elif db_session.image_path:
                        imageUrl = f"/uploads/{os.path.basename(db_session.image_path)}"

                    log_entry = {
                        "id": db_session.id,
                        "name": db_session.name,
                        "entry_time": db_session.entry_time.isoformat(),
                        "exit_time": last_seen_time.isoformat(),
                        "duration": duration,
                        "imageUrl": imageUrl,
                        "session_status": "COMPLETED",
                        "detection_type": db_session.detection_type
                    }

                    history_entry = DashboardSessionHistory(
                        device_id=real_device_id,
                        session_start=db_session.entry_time,
                        session_end=last_seen_time,
                        total_known_persons=1 if db_session.detection_type == "KNOWN" else 0,
                        total_unknown_persons=1 if db_session.detection_type == "UNKNOWN" else 0,
                        known_time_present=duration if db_session.detection_type == "KNOWN" else 0.0,
                        unknown_time_present=duration if db_session.detection_type == "UNKNOWN" else 0.0,
                        presence_logs_json=json.dumps([log_entry])
                    )
                    db.add(history_entry)
                    db.commit()
                except Exception as ex:
                    logger.error(f"Failed to save DashboardSessionHistory in check_expired_sessions: {ex}")


            # Broadcast attendance ended
            self.gateway.broadcast_attendance_ended(session_info["name"], session_info["user_id"], duration)

            if broadcast_callback and db_session:
                broadcast_callback("session_ended", {
                    "sessionId": f"S{db_session.id}",
                    "duration": format_duration(duration)
                })

            # Clean track mapping for tracks associated with this session
            for tid in list(self.track_to_person.keys()):
                if self.track_to_person[tid] == person_id:
                    self.track_to_person.pop(tid, None)
                    self.recognition_cache.pop(tid, None)

            # Move session to recent list
            session_info["ended_at"] = now
            self.recent_sessions.append(session_info)
            self.active_sessions.pop(person_id, None)

    def end_all_active_sessions(self, db: Session, broadcast_callback=None, save_history: bool = True) -> list[dict]:
        """End all active presence sessions immediately (e.g. when the agent goes offline)."""
        now = datetime.utcnow()
        ended_sessions_data = []
        active_ids = list(self.active_sessions.keys())
        
        for person_id in active_ids:
            session_info = self.active_sessions[person_id]
            session_id = session_info["session_id"]

            db_session = db.query(PresenceSession).filter(PresenceSession.id == session_id).first()

            last_seen_time = session_info["last_seen"]
            duration = (last_seen_time - session_info["entry_time"]).total_seconds()
            
            # Avoid division by zero
            conf_list = session_info.get("confidences", [])
            avg_conf = sum(conf_list) / len(conf_list) if conf_list else 0.0
            max_conf = max(conf_list) if conf_list else 0.0

            # Append Exit event to timeline
            session_info["timeline"].append({"timestamp": last_seen_time.strftime("%H:%M:%S"), "event": "Exit (Agent Offline)"})

            if db_session:
                db_session.last_seen = last_seen_time
                db_session.exit_time = last_seen_time
                db_session.end_time = last_seen_time
                db_session.duration_seconds = duration
                db_session.average_confidence = avg_conf
                db_session.max_confidence = max_conf
                db_session.status = "ended"
                db_session.session_status = "COMPLETED"
                db_session.timeline_data = json.dumps(session_info["timeline"])
                db.commit()

                # Build a serialized log dict for our dashboard history
                imageUrl = None
                if db_session.best_frame_path:
                    imageUrl = f"/uploads/{os.path.basename(db_session.best_frame_path)}"
                elif db_session.image_path:
                    imageUrl = f"/uploads/{os.path.basename(db_session.image_path)}"
                
                log_dict = {
                    "id": db_session.id,
                    "name": db_session.name,
                    "entry_time": db_session.entry_time.isoformat(),
                    "exit_time": last_seen_time.isoformat(),
                    "duration": duration,
                    "imageUrl": imageUrl,
                    "session_status": "COMPLETED",
                    "detection_type": db_session.detection_type
                }
                ended_sessions_data.append(log_dict)

                if save_history:
                    try:
                        from app.models.dashboard_session_history import DashboardSessionHistory
                        from app.models.device import Device
                        import socket

                        local_hostname = socket.gethostname()
                        dev = db.query(Device).filter(Device.hostname == local_hostname).first()
                        if not dev:
                            dev = db.query(Device).first()
                        real_device_id = dev.device_id if dev else "local-webcam"

                        history_entry = DashboardSessionHistory(
                            device_id=real_device_id,
                            session_start=db_session.entry_time,
                            session_end=last_seen_time,
                            total_known_persons=1 if db_session.detection_type == "KNOWN" else 0,
                            total_unknown_persons=1 if db_session.detection_type == "UNKNOWN" else 0,
                            known_time_present=duration if db_session.detection_type == "KNOWN" else 0.0,
                            unknown_time_present=duration if db_session.detection_type == "UNKNOWN" else 0.0,
                            presence_logs_json=json.dumps([log_dict])
                        )
                        db.add(history_entry)
                        db.commit()
                    except Exception as ex:
                        logger.error(f"Failed to save DashboardSessionHistory in end_all_active_sessions: {ex}")


            # Broadcast attendance ended
            self.gateway.broadcast_attendance_ended(session_info["name"], session_info["user_id"], duration)

            if broadcast_callback and db_session:
                broadcast_callback("session_ended", {
                    "sessionId": f"S{db_session.id}",
                    "duration": format_duration(duration)
                })

            # Clean track mapping for tracks associated with this session
            for tid in list(self.track_to_person.keys()):
                if self.track_to_person[tid] == person_id:
                    self.track_to_person.pop(tid, None)
                    self.recognition_cache.pop(tid, None)

            # Move session to recent list
            session_info["ended_at"] = now
            self.recent_sessions.append(session_info)
            self.active_sessions.pop(person_id, None)

        return ended_sessions_data


presence_tracker = PresenceTracker()
