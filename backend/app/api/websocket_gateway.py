import json
import asyncio
from datetime import datetime, timedelta
from fastapi import WebSocket, WebSocketDisconnect
from app.db.session import SessionLocal
from app.services.metrics_aggregator import metrics_aggregator

class WebSocketGateway:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.device_live_cache: dict = {}
        self.device_recognition_running: dict = {}
        self.device_connections: dict[str, WebSocket] = {}
        self.device_session_starts: dict[str, datetime] = {}
        self.main_loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, websocket: WebSocket, device_id: str = None, token: str = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        self.main_loop = asyncio.get_running_loop()
        print(f"[WebSocket] Client connected. Total connections: {len(self.active_connections)}")

        if device_id:
            from app.services.jwt_helper import verify_device_token
            from app.models.device import Device
            
            verified_id = verify_device_token(token) if token else None
            if not verified_id or verified_id != device_id:
                print(f"[WebSocket] Device {device_id} token verification failed.")
                if websocket in self.active_connections:
                    self.active_connections.remove(websocket)
                await websocket.close(code=4001, reason="Invalid token")
                return

            print(f"[WebSocket] Authenticated device {device_id} connected.")
            self.device_connections[device_id] = websocket
            self.device_session_starts[device_id] = datetime.utcnow()

            db = SessionLocal()
            try:
                device = db.query(Device).filter(Device.device_id == device_id).first()
                if device:
                    device.status = "online"
                    device.last_seen = datetime.utcnow()
                    db.commit()

                    self.device_live_cache[device_id] = {
                        "device_id": device_id,
                        "status": "online",
                        "hostname": device.hostname,
                        "username": device.username,
                        "os": device.os,
                        "agent_version": device.agent_version,
                        "current_frame": self.device_live_cache.get(device_id, {}).get("current_frame", device.current_frame),
                        "recognized_person": self.device_live_cache.get(device_id, {}).get("recognized_person", device.recognized_person),
                        "last_seen": device.last_seen
                    }
            finally:
                db.close()

            # Broadcast status change to connected websocket clients
            await self.broadcast("device_update", {
                "device_id": device_id,
                "status": "online"
            })

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WebSocket] Client disconnected. Total connections: {len(self.active_connections)}")

            # Find if this was a device connection
            device_id = None
            for dev_id, conn in list(self.device_connections.items()):
                if conn == websocket:
                    device_id = dev_id
                    self.device_connections.pop(dev_id, None)
                    break

            if device_id:
                self.handle_device_disconnect_sync(device_id)

    def handle_device_disconnect_sync(self, device_id: str):
        from app.models.device import Device
        from app.models.presence_session import PresenceSession
        from app.models.dashboard_session_history import DashboardSessionHistory
        from app.services.presence_tracker import presence_tracker
        import os

        print(f"[WebSocket] Handling disconnect for device: {device_id}")
        db = SessionLocal()
        try:
            device = db.query(Device).filter(Device.device_id == device_id).first()
            if device:
                device.status = "offline"
                device.last_seen = datetime.utcnow()
                db.commit()

                # Update cache
                if device_id in self.device_live_cache:
                    self.device_live_cache[device_id]["status"] = "offline"
                    self.device_live_cache[device_id]["last_seen"] = device.last_seen

            # 1. End all active sessions
            presence_tracker.end_all_active_sessions(db, broadcast_callback=self.broadcast_sync)

            # 2. Gather metrics for this session period
            session_start = self.device_session_starts.get(device_id)
            if not session_start:
                session_start = datetime.utcnow() - timedelta(hours=1)
            
            sessions_in_period = db.query(PresenceSession).filter(
                PresenceSession.entry_time >= session_start
            ).order_by(PresenceSession.entry_time.asc()).all()

            presence_logs_list = []
            for s in sessions_in_period:
                imageUrl = None
                if s.best_frame_path:
                    imageUrl = f"/uploads/{os.path.basename(s.best_frame_path)}"
                elif s.image_path:
                    imageUrl = f"/uploads/{os.path.basename(s.image_path)}"
                
                presence_logs_list.append({
                    "id": s.id,
                    "name": s.name,
                    "entry_time": s.entry_time.isoformat(),
                    "exit_time": s.exit_time.isoformat() if s.exit_time else s.last_seen.isoformat(),
                    "duration": s.duration_seconds,
                    "imageUrl": imageUrl,
                    "session_status": s.session_status,
                    "detection_type": s.detection_type
                })

            known_users_set = {s.user_id for s in sessions_in_period if s.detection_type == "KNOWN" and s.user_id is not None}
            total_known = len(known_users_set)
            total_unknown = sum(1 for s in sessions_in_period if s.detection_type == "UNKNOWN")
            known_time = sum(s.duration_seconds for s in sessions_in_period if s.detection_type == "KNOWN")
            unknown_time = sum(s.duration_seconds for s in sessions_in_period if s.detection_type == "UNKNOWN")

            # 3. Store in DashboardSessionHistory
            history_entry = DashboardSessionHistory(
                device_id=device_id,
                session_start=session_start,
                session_end=datetime.utcnow(),
                total_known_persons=total_known,
                total_unknown_persons=total_unknown,
                known_time_present=known_time,
                unknown_time_present=unknown_time,
                presence_logs_json=json.dumps(presence_logs_list)
            )
            db.add(history_entry)
            db.commit()

            print(f"[WebSocket] Saved DashboardSessionHistory for {device_id}. Known: {total_known}, Unknown: {total_unknown}")

            # 4. Broadcast device offline and dashboard stopped metrics snapshot
            self.broadcast_sync("device_update", {
                "device_id": device_id,
                "status": "offline"
            })

            self.broadcast_sync("dashboard_stopped", {
                "device_id": device_id,
                "history_entry": {
                    "id": history_entry.id,
                    "device_id": device_id,
                    "session_start": session_start.isoformat(),
                    "session_end": history_entry.session_end.isoformat(),
                    "total_known_persons": total_known,
                    "total_unknown_persons": total_unknown,
                    "known_time_present": known_time,
                    "unknown_time_present": unknown_time,
                    "presence_logs": presence_logs_list
                }
            })
        except Exception as e:
            db.rollback()
            print(f"[WebSocket] Error handling device disconnect for {device_id}: {e}")
        finally:
            db.close()


    async def broadcast(self, event_type: str, data: dict):
        if not self.active_connections:
            return

        payload = {"type": event_type, **data}
        payload_str = json.dumps(payload)
        
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload_str)
            except Exception as e:
                print(f"[WebSocket] Error sending to client: {e}")
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)

    def broadcast_sync(self, event_type: str, data: dict):
        if not self.active_connections:
            return
        
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = getattr(self, "main_loop", None)

            if not loop:
                print(f"[WebSocket] Cannot broadcast_sync: no active event loop found.")
                return

            if loop.is_running():
                asyncio.run_coroutine_threadsafe(self.broadcast(event_type, data), loop)
            else:
                loop.run_until_complete(self.broadcast(event_type, data))
        except Exception as e:
            print(f"[WebSocket] Failed to schedule broadcast_sync (event={event_type}, data={data}): {e}")

    async def broadcast_loop(self):
        self.main_loop = asyncio.get_running_loop()
        while True:
            try:
                if self.active_connections:
                    db = SessionLocal()
                    try:
                        metrics = metrics_aggregator.aggregate_metrics(db)
                        await self.broadcast("dashboard_update", metrics)
                    finally:
                        db.close()
            except Exception as e:
                print(f"[WebSocket] Error in broadcast loop: {e}")
            await asyncio.sleep(1.0)

    def broadcast_face_detected(self, name: str, user_id: int | None, confidence: float):
        from datetime import datetime
        payload = {
            "user_id": user_id if user_id is not None else -1,
            "name": name,
            "confidence": confidence,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.broadcast_sync("face_detected", payload)

    def broadcast_known_user(self, name: str, user_id: int, confidence: float):
        from datetime import datetime
        payload = {
            "user_id": user_id,
            "name": name,
            "confidence": confidence,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.broadcast_sync("known_user", payload)

    def broadcast_unknown_user(self, confidence: float):
        from datetime import datetime
        payload = {
            "user_id": -1,
            "name": "Unknown",
            "confidence": confidence,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.broadcast_sync("unknown_user", payload)

    def broadcast_attendance_started(self, name: str, user_id: int | None, confidence: float):
        from datetime import datetime
        payload = {
            "user_id": user_id if user_id is not None else -1,
            "name": name,
            "confidence": confidence,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.broadcast_sync("attendance_started", payload)

    def broadcast_attendance_ended(self, name: str, user_id: int | None, duration: float):
        from datetime import datetime
        payload = {
            "user_id": user_id if user_id is not None else -1,
            "name": name,
            "duration": duration,
            "timestamp": datetime.utcnow().isoformat()
        }
        self.broadcast_sync("attendance_ended", payload)

gateway = WebSocketGateway()
