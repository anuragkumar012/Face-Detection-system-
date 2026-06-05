from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.core.config import settings
from app.db.session import engine, SessionLocal
from app.db.base import Base
from app.api.routes import router
from app.api.device_routes import router as device_router
from app.models.account import Account
from app.models.face_embedding import FaceEmbedding
from app.models.face_cluster import FaceCluster
from app.models.user import User
from app.models.unknown_detection import UnknownDetection
from app.models.presence_log import PresenceLog
from app.models.presence_session import PresenceSession
from app.models.photo_scan import PhotoScan
from app.models.dashboard_session_history import DashboardSessionHistory
from app.services.presence_tracker import presence_tracker
from app.api.websocket_gateway import gateway
from app.services.auth import seed_default_accounts


def _apply_db_migrations(eng) -> None:
    """Safely add new columns to existing tables without Alembic.

    Uses SQLAlchemy's inspect() to check whether each column already exists
    before issuing ALTER TABLE, making this idempotent and safe on every
    startup for both SQLite and MySQL.
    """
    from sqlalchemy import inspect as sa_inspect, text

    inspector = sa_inspect(eng)
    existing_tables = inspector.get_table_names()
    is_sqlite = str(eng.url).startswith("sqlite")

    # --- face_embeddings.photo_scan_id (Gap 1) ---
    if "face_embeddings" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("face_embeddings")}
        if "photo_scan_id" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE face_embeddings "
                    "ADD COLUMN photo_scan_id INTEGER "
                    "REFERENCES photo_scans(id) ON DELETE SET NULL"
                ))
                conn.commit()
            print("[Migration] Added face_embeddings.photo_scan_id")
        
        if "angle" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE face_embeddings ADD COLUMN angle VARCHAR(50)"
                ))
                conn.commit()
            print("[Migration] Added face_embeddings.angle")

    # --- presence_logs ---
    if "presence_logs" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("presence_logs")}
        if "entry_time" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE presence_logs ADD COLUMN entry_time DATETIME"
                ))
                conn.commit()
            print("[Migration] Added presence_logs.entry_time")
        if "exit_time" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE presence_logs ADD COLUMN exit_time DATETIME"
                ))
                conn.commit()
            print("[Migration] Added presence_logs.exit_time")
        if "confidence" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE presence_logs ADD COLUMN confidence FLOAT DEFAULT 0.0"
                ))
                conn.commit()
            print("[Migration] Added presence_logs.confidence")

    # --- presence_sessions ---
    if "presence_sessions" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("presence_sessions")}
        if "entry_time" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN entry_time DATETIME"))
                conn.commit()
            print("[Migration] Added presence_sessions.entry_time")
        if "exit_time" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN exit_time DATETIME"))
                conn.commit()
            print("[Migration] Added presence_sessions.exit_time")
        if "best_frame_path" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN best_frame_path VARCHAR(512)"))
                conn.commit()
            print("[Migration] Added presence_sessions.best_frame_path")
        if "average_confidence" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN average_confidence FLOAT DEFAULT 0.0"))
                conn.commit()
            print("[Migration] Added presence_sessions.average_confidence")
        if "max_confidence" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN max_confidence FLOAT DEFAULT 0.0"))
                conn.commit()
            print("[Migration] Added presence_sessions.max_confidence")
        if "detection_type" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN detection_type VARCHAR(20)"))
                conn.commit()
            print("[Migration] Added presence_sessions.detection_type")
        if "session_status" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN session_status VARCHAR(20) DEFAULT 'ACTIVE'"))
                conn.commit()
            print("[Migration] Added presence_sessions.session_status")
        if "timeline_data" not in cols:
            with eng.connect() as conn:
                conn.execute(text("ALTER TABLE presence_sessions ADD COLUMN timeline_data TEXT"))
                conn.commit()
            print("[Migration] Added presence_sessions.timeline_data")

    # --- unknown_detections ---
    if "unknown_detections" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("unknown_detections")}
        if "embedding" not in cols:
            blob_type = "BLOB" if is_sqlite else "LONGBLOB"
            with eng.connect() as conn:
                conn.execute(text(
                    f"ALTER TABLE unknown_detections ADD COLUMN embedding {blob_type}"
                ))
                conn.commit()
            print("[Migration] Added unknown_detections.embedding")
        if "timestamp" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE unknown_detections ADD COLUMN timestamp DATETIME"
                ))
                conn.commit()
            print("[Migration] Added unknown_detections.timestamp")
        if "camera_id" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE unknown_detections ADD COLUMN camera_id VARCHAR(100)"
                ))
                conn.commit()
            print("[Migration] Added unknown_detections.camera_id")
        if "confidence" not in cols:
            with eng.connect() as conn:
                conn.execute(text(
                    "ALTER TABLE unknown_detections ADD COLUMN confidence FLOAT"
                ))
                conn.commit()
            print("[Migration] Added unknown_detections.confidence")


def _seed_clusters_from_scans(db) -> None:
    """One-time back-fill of face_clusters from photo_scan.scan_details.

    Only runs when the table is empty so it is safe to call on every startup.
    """
    from datetime import datetime

    if db.query(FaceCluster).count() > 0:
        return  # Already seeded

    cluster_map: dict[str, dict] = {}  # cluster_id -> aggregated info

    scans = db.query(PhotoScan).order_by(PhotoScan.created_at).all()
    for scan in scans:
        if not scan.scan_details:
            continue
        for face in scan.scan_details.get("faces", []):
            cluster = face.get("cluster") or {}
            cid = cluster.get("cluster_id")
            if not cid:
                continue
            if cid not in cluster_map:
                cluster_map[cid] = {
                    "label": cluster.get("label") or f"Cluster {cid}",
                    "user_id": cluster.get("matched_user_id"),
                    "face_count": 0,
                    "thumbnail_scan_id": scan.id,
                    "thumbnail_bbox": face.get("bbox"),
                }
            cluster_map[cid]["face_count"] += 1

    now = datetime.utcnow()
    for cid, info in cluster_map.items():
        db.add(FaceCluster(
            cluster_id=cid,
            label=info["label"],
            user_id=info["user_id"],
            face_count=info["face_count"],
            thumbnail_scan_id=info["thumbnail_scan_id"],
            thumbnail_bbox=info["thumbnail_bbox"],
            created_at=now,
            updated_at=now,
        ))
    if cluster_map:
        db.commit()
        print(f"[Clusters] Seeded {len(cluster_map)} clusters from scan history.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Apply DB column migrations (idempotent, runs every startup)
    _apply_db_migrations(engine)
    # Create any brand-new tables (face_clusters etc.)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_default_accounts(db)
        # Back-fill face_clusters table from scan history (one-time, no-op if populated)
        _seed_clusters_from_scans(db)
        # Populate the FAISS vector index from all persisted face embeddings.
        from app.services.vector_index import face_index
        face_index.rebuild_from_db(db)
    finally:
        db.close()
    
    # Start ngrok tunnel if authtoken is present
    if settings.NGROK_AUTHTOKEN:
        try:
            from pyngrok import ngrok
            ngrok.set_auth_token(settings.NGROK_AUTHTOKEN)
            
            # Check if tunnel is already open to avoid duplicates on reload
            tunnels = ngrok.get_tunnels()
            already_exists = False
            public_url = None
            for t in tunnels:
                if settings.NGROK_DOMAIN and settings.NGROK_DOMAIN in t.public_url:
                    already_exists = True
                    public_url = t.public_url
                    break
                elif not settings.NGROK_DOMAIN and f"localhost:{settings.APP_PORT}" in t.config.get("addr", ""):
                    already_exists = True
                    public_url = t.public_url
                    break
            
            if not already_exists:
                connect_kwargs = {}
                if settings.NGROK_DOMAIN:
                    connect_kwargs["domain"] = settings.NGROK_DOMAIN
                public_url = ngrok.connect(settings.APP_PORT, **connect_kwargs)
            print(f"  [ngrok] Public URL: {public_url}")
        except Exception as e:
            print(f"\n  [ngrok] Failed to start tunnel: {e}\n")
            
    # Start real-time presence background tasks
    import asyncio
    
    async def periodic_session_cleanup():
        while True:
            try:
                db_session = SessionLocal()
                try:
                    presence_tracker.check_expired_sessions(db_session, broadcast_callback=gateway.broadcast_sync)
                    
                    # Check for device status timeout (45 seconds offline check)
                    from app.models.device import Device
                    from datetime import datetime
                    
                    now = datetime.utcnow()
                    # Check cache first
                    for device_id, live in list(gateway.device_live_cache.items()):
                        if live.get("status") == "online" and (now - live["last_seen"]).total_seconds() > 45:
                            live["status"] = "offline"
                            
                            device = db_session.query(Device).filter(Device.device_id == device_id).first()
                            if device:
                                device.status = "offline"
                                db_session.commit()
                                
                            gateway.broadcast_sync("device_update", {
                                "device_id": device_id,
                                "status": "offline"
                            })
                            
                    # Check database for any online devices not in cache or missed
                    devices = db_session.query(Device).filter(Device.status == "online").all()
                    for device in devices:
                        if device.device_id not in gateway.device_live_cache:
                            if (now - device.last_seen).total_seconds() > 45:
                                device.status = "offline"
                                db_session.commit()
                                gateway.broadcast_sync("device_update", {
                                    "device_id": device.device_id,
                                    "status": "offline"
                                })
                finally:
                    db_session.close()
            except Exception as exc:
                print(f"[Lifespan] Error in presence session cleanup task: {exc}")
            await asyncio.sleep(1.0)

    cleanup_task = asyncio.create_task(periodic_session_cleanup())
    broadcast_task = asyncio.create_task(gateway.broadcast_loop())
    
    yield
    
    # Shutdown logic: cancel tasks
    print("[Lifespan] Cancelling presence tracking background tasks...")
    cleanup_task.cancel()
    broadcast_task.cancel()
    try:
        await asyncio.gather(cleanup_task, broadcast_task, return_exceptions=True)
    except Exception as exc:
        print(f"[Lifespan] Error shutting down presence tracking tasks: {exc}")


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan
)

local_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    f"http://{settings.APP_HOST}:3000",
]

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=local_origins,
    allow_origin_regex=r"https?://((localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?|[a-z0-9-]+\.ngrok(?:-free)?\.(app|dev|io))$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(router, prefix=settings.API_V1_STR)
app.include_router(device_router, prefix=settings.API_V1_STR)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    device_id = websocket.query_params.get("device_id")
    token = websocket.query_params.get("token")
    await gateway.connect(websocket, device_id=device_id, token=token)
    try:
        while True:
            # Maintain connection, listen for any text (can be empty / heartbeats)
            await websocket.receive_text()
    except WebSocketDisconnect:
        gateway.disconnect(websocket)
    except Exception as e:
        print(f"[WebSocket] Disconnect exception: {e}")
        gateway.disconnect(websocket)

@app.get("/")
def read_root():
    return {"message": "Welcome to Face Recognition API"}
