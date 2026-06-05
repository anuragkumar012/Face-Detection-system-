import cv2
import numpy as np
import os
import uuid
import base64
import time
import json
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from typing import List, Literal
from app.db.session import get_db
from app.schemas.face import DetectedFace, LivePreviewFrame, PhotoScanListResponse, RecognitionResponse
from app.schemas.user import UserResponse
from app.schemas.auth import LoginRequest, LoginResponse
from app.schemas.presence import PresenceSummaryResponse, PresenceLogResponse
from app.models.user import User
from app.models.unknown_detection import UnknownDetection
from app.models.photo_scan import PhotoScan
from app.models.presence_log import PresenceLog
from app.models.presence_session import PresenceSession
from app.services.auth import get_account_by_credentials, verify_password
from app.services.enrollment import enroll_user
from app.services.recognition import recognize_faces_in_image
from app.services.photo_scanner import scan_faces_in_photo
from app.services.face_embedder import embedder
from app.services.matcher import matcher
from app.services.face_tracker import tracker as face_tracker
from app.services.presence_tracker import presence_tracker
from app.services.metrics_aggregator import metrics_aggregator
from app.api.websocket_gateway import gateway
from app.core.config import settings
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.attributes import flag_modified
from app.models.face_embedding import FaceEmbedding
from app.models.face_cluster import FaceCluster
from app.schemas.people import PersonClusterResponse, EnrollClusterRequest, PersonFaceInstance, ConfirmFaceRequest, MergePeopleRequest, RemoveMatchRequest
from app.services.vector_index import face_index


def _upsert_cluster(
    db,
    cluster_id: str,
    label: str,
    user_id: int | None = None,
    face_count_delta: int = 0,
    thumbnail_scan_id: int | None = None,
    thumbnail_bbox: dict | None = None,
) -> FaceCluster:
    """Insert or update a FaceCluster row atomically.

    ``face_count_delta`` is added to the existing count (use +1 for new faces,
    -N when merging clusters away).  Pass ``thumbnail_scan_id`` only when
    setting or overriding the cover image.
    """
    from datetime import datetime
    now = datetime.utcnow()
    record = db.query(FaceCluster).filter_by(cluster_id=cluster_id).first()
    if record is None:
        record = FaceCluster(
            cluster_id=cluster_id,
            label=label,
            user_id=user_id,
            face_count=max(face_count_delta, 0),
            thumbnail_scan_id=thumbnail_scan_id,
            thumbnail_bbox=thumbnail_bbox,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
    else:
        record.label = label
        if user_id is not None:
            record.user_id = user_id
        record.face_count = max(0, record.face_count + face_count_delta)
        if thumbnail_scan_id is not None:
            record.thumbnail_scan_id = thumbnail_scan_id
            record.thumbnail_bbox = thumbnail_bbox
        record.updated_at = now
    return record

router = APIRouter()
LATEST_DETECTIONS: list[dict] = []
LIVE_PREVIEWS: dict[str, dict] = {}
LIVE_PREVIEW_TTL_SECONDS = 20


@router.post("/auth/login", response_model=LoginResponse)

def login(payload: LoginRequest, db: Session = Depends(get_db)):
    account = get_account_by_credentials(db, username=payload.username, role=payload.role)
    if account is None or not verify_password(payload.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username, password, or role.")

    return account

def _image_url_from_path(request: Request, image_path: str | None) -> str | None:
    if not image_path:
        return None
    filename = os.path.basename(image_path)
    return f"{str(request.base_url).rstrip('/')}/uploads/{filename}"

def _serialize_photo_scan(scan: PhotoScan, request: Request) -> dict:
    faces = []
    if scan.scan_details:
        for face in scan.scan_details.get("faces", []):
            sanitized_face = deepcopy(face)
            sanitized_face.pop("embedding_vector", None)
            sanitized_face.setdefault("cluster", {
                "cluster_id": f"photo-scan-{scan.id}-unclustered",
                "label": "Unclustered legacy scan",
                "is_new_cluster": False,
                "best_similarity": 0.0,
                "threshold": settings.SIMILARITY_THRESHOLD,
                "comparison_count": 0,
                "matched_user_id": None,
                "matched_user_name": None,
            })
            sanitized_face.setdefault("variation_handling", {
                "lighting": "unknown",
                "pose": "unknown",
                "camera_quality": "unknown",
                "occlusion_risk": "unknown",
                "supported_changes": [
                    "different lighting",
                    "glasses or sunglasses",
                    "beard or clean-shaven",
                    "aging",
                    "selfie angles",
                    "side profiles",
                    "different camera quality",
                ],
                "note": "Legacy scan created before variation handling metadata was added.",
            })
            faces.append(sanitized_face)

    return {
        "id": scan.id,
        "image_url": _image_url_from_path(request, scan.image_path),
        "original_filename": scan.original_filename,
        "source": scan.source,
        "device_id": scan.device_id,
        "face_count": scan.face_count,
        "faces": faces,
        "created_at": scan.created_at,
    }

def _serialize_user(user: User, request: Request) -> dict:
    embeddings = [
        {
            "id": embedding.id,
            "image_path": embedding.image_path,
            "image_url": _image_url_from_path(request, embedding.image_path),
            "created_at": embedding.created_at,
        }
        for embedding in user.embeddings
    ]
    primary_image_url = embeddings[0]["image_url"] if embeddings else None
    return {
        "id": user.id,
        "name": user.name,
        "created_at": user.created_at,
        "image_url": primary_image_url,
        "embeddings": embeddings,
    }

def _build_user_lookup(users: list[User], request: Request) -> dict[int, dict]:
    user_lookup: dict[int, dict] = {}
    for user in users:
        serialized_user = _serialize_user(user, request)
        user_lookup[user.id] = {
            "name": serialized_user["name"],
            "image_url": serialized_user["image_url"],
        }
    return user_lookup

def _enrich_detections(detections: list[dict], user_lookup: dict[int, dict]) -> list[dict]:
    enriched_detections = []
    for detection in detections:
        enriched_detection = deepcopy(detection)
        match = enriched_detection.get("match")
        if match is not None:
            user_data = user_lookup.get(match.get("user_id"))
            match["image_url"] = user_data["image_url"] if user_data else None
            if user_data and match.get("name") in (None, "", "Unknown"):
                match["name"] = user_data["name"]
        enriched_detections.append(enriched_detection)
    return enriched_detections

def _load_user_lookup(db: Session, request: Request) -> dict[int, dict]:
    users = (
        db.query(User)
        .options(selectinload(User.embeddings))
        .all()
    )
    return _build_user_lookup(users, request)

def _has_relative_positions(landmarks: dict[str, dict[str, int]]) -> bool:
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

def _recognize_and_enrich(
    img: np.ndarray,
    request: Request,
    db: Session,
    realtime: bool = False,
) -> list[dict]:
    global LATEST_DETECTIONS

    # 1. Detect faces
    if realtime:
        detected_faces = embedder.detect_faces(img)
        rects = [bbox.tolist() for bbox in detected_faces]
    else:
        faces = embedder.get_embeddings(img, realtime=False)
        rects = [face.bbox.astype(int).tolist() for face in faces]

    # 2. Update FaceTracker to get track_id for each bbox
    tracked_faces = face_tracker.update(rects)

    tracks_data = []
    current_time = time.time()

    for track_id, bbox in tracked_faces:
        # Check cache
        cached = presence_tracker.get_cached_recognition(track_id)
        
        # Determine if we should perform recognition
        should_recognize = False
        if not cached:
            should_recognize = True
        elif cached["name"] == "Unknown":
            # If previously matched as Unknown, retry at most once per second
            if current_time - cached["last_recognition_time"] >= 1.0:
                should_recognize = True
                
        name = "Unknown"
        user_id = None
        conf = 0.0
        det_score = 0.0
        landmarks = None
        embedding = None

        if should_recognize:
            x1, y1, x2, y2 = bbox
            h, w = img.shape[:2]
            x1, y1 = max(0, int(x1)), max(0, int(y1))
            x2, y2 = min(w, int(x2)), min(h, int(y2))
            
            if x2 > x1 and y2 > y1:
                pad_x = max(int((x2 - x1) * 0.50), 10)
                pad_y = max(int((y2 - y1) * 0.50), 10)
                face_crop = img[
                    max(y1 - pad_y, 0) : min(y2 + pad_y, h),
                    max(x1 - pad_x, 0) : min(x2 + pad_x, w),
                ]
                if face_crop.size > 0:
                    embedding, face_obj = embedder._extract_embedding_and_quality_from_crop(face_crop)
                    if embedding is not None and face_obj is not None:
                        name, user_id, conf = matcher.match(embedding)
                        det_score = float(getattr(face_obj, "det_score", 0.0))
                        
                        # Extract landmarks
                        if getattr(face_obj, "kps", None) is not None and len(face_obj.kps) >= 5:
                            kps = face_obj.kps
                            landmarks = {
                                "left_eye": {"x": int(kps[0][0]), "y": int(kps[0][1])},
                                "right_eye": {"x": int(kps[1][0]), "y": int(kps[1][1])},
                                "nose": {"x": int(kps[2][0]), "y": int(kps[2][1])},
                                "left_mouth": {"x": int(kps[3][0]), "y": int(kps[3][1])},
                                "right_mouth": {"x": int(kps[4][0]), "y": int(kps[4][1])},
                            }
                        
                        presence_tracker.cache_recognition(
                            track_id, name, user_id, conf, embedding, det_score, landmarks
                        )
                    else:
                        presence_tracker.cache_recognition(track_id, name, user_id, conf)
                else:
                    presence_tracker.cache_recognition(track_id, name, user_id, conf)
            else:
                presence_tracker.cache_recognition(track_id, name, user_id, conf)
        else:
            name = cached["name"]
            user_id = cached["user_id"]
            conf = cached["confidence"]
            det_score = cached.get("det_score", 0.0)
            landmarks = cached.get("landmarks")
            embedding = cached.get("embedding")

        # Categorize detection type: KNOWN, UNKNOWN, UNVERIFIED
        if name != "Unknown":
            detection_type = "KNOWN"
        else:
            # Run quality checks
            width = bbox[2] - bbox[0]
            height = bbox[3] - bbox[1]
            size_ok = width >= 80 and height >= 80
            conf_ok = det_score >= 0.80

            # Laplacian variance for blur
            blur_ok = False
            h_img, w_img = img.shape[:2]
            x1, y1 = max(0, int(bbox[0])), max(0, int(bbox[1]))
            x2, y2 = min(w_img, int(bbox[2])), min(h_img, int(bbox[3]))
            face_crop = img[y1:y2, x1:x2]
            if face_crop.size > 0:
                gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
                variance = cv2.Laplacian(gray, cv2.CV_64F).var()
                blur_ok = variance >= 40.0

            # Visibility check (relative landmarks)
            visibility_ok = False
            if landmarks:
                visibility_ok = _has_relative_positions(landmarks)

            if size_ok and conf_ok and blur_ok and visibility_ok:
                detection_type = "UNKNOWN"
            else:
                detection_type = "UNVERIFIED"

        tracks_data.append({
            "track_id": track_id,
            "bbox": bbox,
            "user_id": user_id,
            "name": name,
            "confidence": conf,
            "person_type": "known" if name != "Unknown" else "unknown",
            "detection_type": detection_type,
            "embedding": embedding,
            "det_score": det_score,
            "landmarks": landmarks
        })

    # 3. Process the tracked faces to manage presence session lifecycles
    presence_tracker.process_frame(db, tracks_data, img, broadcast_callback=gateway.broadcast_sync)

    # 4. Format enriched results matching standard DetectedFace schema for the UI
    enriched_results = []
    for track in tracks_data:
        track_id = track["track_id"]
        bbox = track["bbox"]
        name = track["name"]
        user_id = track["user_id"]
        conf = track["confidence"]
        
        image_url = None
        image_path = None
        
        # Check active session to retrieve the cropped or registered image path
        active_sess = presence_tracker.active_sessions.get(track_id)
        if active_sess:
            session_id = active_sess["session_id"]
            sess_record = db.query(PresenceSession).filter(PresenceSession.id == session_id).first()
            if sess_record and sess_record.image_path:
                image_path = sess_record.image_path
                image_url = _image_url_from_path(request, image_path)
        
        enriched_results.append({
            "track_id": track_id,
            "bbox": {"x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
            "match": {
                "user_id": user_id if user_id is not None else -1,
                "name": name,
                "confidence": conf,
                "image_url": image_url
            },
            "image_path": image_path
        })

    LATEST_DETECTIONS = deepcopy(enriched_results)
    return enriched_results

def _read_upload_image(file: UploadFile) -> tuple[bytes, np.ndarray]:
    file.file.seek(0)
    contents = file.file.read()

    # 1. First, check EXIF Orientation and transpose using PIL
    try:
        from PIL import Image, ImageOps
        import io
        pil_img = Image.open(io.BytesIO(contents))
        exif = pil_img.getexif()
        orientation = exif.get(274) if exif else None
        if orientation and orientation in (2, 3, 4, 5, 6, 7, 8):
            transposed_img = ImageOps.exif_transpose(pil_img)
            img_rgb = np.array(transposed_img)
            img = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
            ok, encoded = cv2.imencode(".jpg", img)
            if ok:
                contents = encoded.tobytes()
        else:
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        print(f"[EXIF Transpose Error] {e}")
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    # 2. Check if a face is present and rotated (using fast_app for speed)
    try:
        faces = embedder.fast_app.get(img)
        if faces:
            # Get largest face
            face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            if getattr(face, "kps", None) is not None:
                kps = face.kps
                dx = kps[1][0] - kps[0][0]
                dy = kps[1][1] - kps[0][1]
                angle_deg = np.degrees(np.arctan2(dy, dx))
                
                rotated = False
                if 45 < angle_deg <= 135:
                    img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
                    rotated = True
                elif -135 <= angle_deg < -45:
                    img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
                    rotated = True
                elif angle_deg > 135 or angle_deg < -135:
                    img = cv2.rotate(img, cv2.ROTATE_180)
                    rotated = True
                
                if rotated:
                    ok, encoded = cv2.imencode(".jpg", img)
                    if ok:
                        contents = encoded.tobytes()
                    print(f"[Auto-Rotate] Rotated face with angle {angle_deg:.2f} to upright.")
    except Exception as e:
        print(f"[Face Auto-Rotate Error] {e}")

    return contents, img

def _store_uploaded_image(contents: bytes, original_filename: str | None) -> str:
    file_extension = os.path.splitext(original_filename or "")[1] or ".jpg"
    filename = f"{uuid.uuid4()}{file_extension.lower()}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    with open(filepath, "wb") as uploaded_file:
        uploaded_file.write(contents)

    return filepath

def _build_live_preview_payload(source: Literal["admin", "user"]) -> dict:
    preview = LIVE_PREVIEWS.get(source)
    if not preview:
        return {
            "source": source,
            "frame_data_url": None,
            "updated_at": None,
            "is_live": False,
            "detections": None,
        }

    updated_at = preview["updated_at"]
    age_seconds = (datetime.now(timezone.utc) - updated_at).total_seconds()
    is_live = age_seconds <= LIVE_PREVIEW_TTL_SECONDS

    if not is_live:
        return {
            "source": source,
            "frame_data_url": None,
            "updated_at": updated_at,
            "is_live": False,
            "detections": None,
        }

    return {
        "source": source,
        "frame_data_url": preview["frame_data_url"],
        "updated_at": updated_at,
        "is_live": True,
        "detections": preview.get("detections"),
    }

@router.post("/enroll", response_model=UserResponse)
def enroll(
    request: Request,
    name: str = Form(...),
    file: UploadFile = File(...),
    angle: str | None = Form(None),
    db: Session = Depends(get_db),
):
    contents, img = _read_upload_image(file)
        
    file_extension = os.path.splitext(file.filename or "")[1] or ".jpg"
    filename = f"{uuid.uuid4()}{file_extension.lower()}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    try:
        with open(filepath, "wb") as uploaded_file:
            uploaded_file.write(contents)

        user = enroll_user(db, name, img, filepath, angle=angle)
        db.refresh(user)

        return _serialize_user(user, request)
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/users", response_model=List[UserResponse])

def get_users(request: Request, db: Session = Depends(get_db)):
    users = (
        db.query(User)
        .options(selectinload(User.embeddings))
        .all()
    )
    return [_serialize_user(user, request) for user in users]

@router.delete("/users/{user_id}")

def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    uploaded_paths = [embedding.image_path for embedding in user.embeddings if embedding.image_path]
    db.delete(user)
    db.commit()

    # Sync FAISS index: remove all entries belonging to this user.
    face_index.remove_by_user_id(user_id)

    for uploaded_path in uploaded_paths:
        if os.path.exists(uploaded_path):
            os.remove(uploaded_path)

    return {"status": "success", "message": "User deleted"}

@router.post("/recognize-image", response_model=RecognitionResponse)

def recognize_image(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _, img = _read_upload_image(file)
    enriched_results = _recognize_and_enrich(img, request, db)
    return {"matches": [r["match"] for r in enriched_results]}

@router.post("/photo-scans", response_model=PhotoScanListResponse)

def scan_uploaded_photos(
    request: Request,
    files: List[UploadFile] = File(...),
    source: str = Form("frontend"),
    device_id: str | None = Form(None),
    db: Session = Depends(get_db),
):
    scans = []

    for file in files:
        contents, img = _read_upload_image(file)
        filepath = _store_uploaded_image(contents, file.filename)

        try:
            faces = scan_faces_in_photo(
                img,
                db=db,
                cluster_prefix=f"upload-{uuid.uuid4().hex[:8]}",
            )
            scan = PhotoScan(
                source=source,
                device_id=device_id,
                original_filename=file.filename,
                image_path=filepath,
                face_count=len(faces),
                scan_details={"faces": faces},
            )
            db.add(scan)
            db.commit()
            db.refresh(scan)

            # Sync FAISS index + face_clusters table for every new cluster.
            for face_data in faces:
                ev = face_data.get("embedding_vector")
                cluster = face_data.get("cluster") or {}
                cid = cluster["cluster_id"]
                if ev:
                    if cluster.get("is_new_cluster"):
                        vec = np.array(ev, dtype=np.float32)
                        face_index.add(vec, {
                            "cluster_id": cid,
                            "label": cluster.get("label", ""),
                            "user_id": cluster.get("matched_user_id"),
                            "user_name": cluster.get("matched_user_name"),
                        })
                    _upsert_cluster(
                        db, cid,
                        label=cluster.get("label", f"Cluster {cid}"),
                        user_id=cluster.get("matched_user_id"),
                        face_count_delta=1,
                        thumbnail_scan_id=scan.id,
                        thumbnail_bbox=face_data.get("bbox"),
                    )
            db.commit()

            scans.append(_serialize_photo_scan(scan, request))
        except Exception:
            db.rollback()
            if os.path.exists(filepath):
                os.remove(filepath)
            raise

    return {"scans": scans}

@router.get("/photo-scans", response_model=PhotoScanListResponse)

def get_photo_scans(
    request: Request,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    bounded_limit = min(max(limit, 1), 100)
    scans = (
        db.query(PhotoScan)
        .order_by(PhotoScan.created_at.desc())
        .limit(bounded_limit)
        .all()
    )
    return {"scans": [_serialize_photo_scan(scan, request) for scan in scans]}

@router.post("/recognize-live", response_model=List[DetectedFace])

def recognize_live(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _, img = _read_upload_image(file)
    return _recognize_and_enrich(img, request, db, realtime=True)

def run_background_recognition(device_id: str, file_bytes: bytes, request: Request):
    if gateway.device_recognition_running.get(device_id, False):
        return
    gateway.device_recognition_running[device_id] = True
    try:
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:

            from app.db.session import SessionLocal
            db = SessionLocal()
            try:
                enriched_results = _recognize_and_enrich(img, request, db, realtime=False)
                
                recognized_names = []
                for r in enriched_results:
                    match = r.get("match")
                    if match and match.get("name"):
                        recognized_names.append(match["name"])
                
                recognized_person = ", ".join(list(set(recognized_names))) if recognized_names else None
                
                # Update cache
                if device_id in gateway.device_live_cache:
                    gateway.device_live_cache[device_id]["recognized_person"] = recognized_person

                # Draw face bounding boxes and labels on img
                for res in enriched_results:
                    bbox = res["bbox"]
                    match = res.get("match")
                    x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
                    name = match["name"] if match else "Unknown"
                    conf = match["confidence"] if match else 0.0
                    color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                    label = f"{name} ({conf:.2f})" if name != "Unknown" else name
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                    text_y = max(y1 - 10, th + 4)
                    cv2.rectangle(img, (x1, text_y - th - 4), (x1 + tw + 8, text_y + 2), color, -1)
                    cv2.putText(img, label, (x1 + 4, text_y - 2),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

                # Base64 encode the annotated image
                ok, encoded = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                frame_base64 = f"data:image/jpeg;base64,{base64.b64encode(encoded.tobytes()).decode('ascii')}" if ok else None

                if frame_base64 and device_id in gateway.device_live_cache:
                    gateway.device_live_cache[device_id]["current_frame"] = frame_base64

                # Update DB
                from app.models.device import Device
                device = db.query(Device).filter(Device.device_id == device_id).first()
                if device:
                    device.recognized_person = recognized_person
                    if frame_base64:
                        device.current_frame = frame_base64
                    db.commit()
                
                # Broadcast the update (specifically the recognized person name and the annotated frame)
                broadcast_data = {
                    "device_id": device_id,
                    "status": "online",
                    "recognized_person": recognized_person
                }
                if frame_base64:
                    broadcast_data["current_frame"] = frame_base64

                gateway.broadcast_sync("device_update", broadcast_data)
            finally:
                db.close()
    except Exception as exc:
        print(f"[Background Recognition] Error: {exc}")
    finally:
        gateway.device_recognition_running[device_id] = False


@router.post("/live-preview")
def update_live_preview(
    request: Request,
    source: Literal["admin", "user", "device"] = Form(...),
    file: UploadFile = File(...),
    device_id: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
):
    from app.services.jwt_helper import verify_device_token
    from app.models.device import Device

    # If source is device, perform JWT authentication and handle immediately
    if source == "device":
        if not device_id:
            raise HTTPException(status_code=400, detail="device_id is required for device source")
        
        # Verify JWT Token from Authorization Header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
        
        token = auth_header.split(" ")[1]
        token_device_id = verify_device_token(token)
        if not token_device_id or token_device_id != device_id:
            raise HTTPException(status_code=401, detail="Invalid device token")
        
        device = db.query(Device).filter(Device.device_id == device_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not registered")

        # Read file bytes directly for base64
        file.file.seek(0)
        contents = file.file.read()
        
        frame_base64 = f"data:image/jpeg;base64,{base64.b64encode(contents).decode('ascii')}"
        updated_at = datetime.utcnow()
        
        # Update memory cache
        gateway.device_live_cache[device_id] = {
            "device_id": device_id,
            "status": "online",
            "hostname": device.hostname,
            "username": device.username,
            "os": device.os,
            "agent_version": device.agent_version,
            "current_frame": frame_base64,
            "recognized_person": gateway.device_live_cache.get(device_id, {}).get("recognized_person", device.recognized_person),
            "last_seen": updated_at
        }

        device.status = "online"
        device.current_frame = frame_base64
        device.last_seen = updated_at
        device.recognized_person = gateway.device_live_cache[device_id]["recognized_person"]
        db.commit()
        
        # Broadcast status and frame updates via WebSocket immediately
        gateway.broadcast_sync("device_update", {
            "device_id": device.device_id,
            "status": "online",
            "hostname": device.hostname,
            "recognized_person": gateway.device_live_cache[device_id]["recognized_person"],
            "current_frame": frame_base64,
            "last_seen": updated_at.isoformat()
        })
        
        # Run face recognition in background task
        if background_tasks:
            background_tasks.add_task(run_background_recognition, device_id, contents, request)
            
        return {"faces": []}

    # Otherwise, source is "user" or "admin"
    _, img = _read_upload_image(file)

    h, w = img.shape[:2]
    print(f"[LIVE-PREVIEW] source={source} frame={w}x{h}")

    detections_payload = None

    if source == "user":
        print(f"[LIVE-PREVIEW] Running InsightFace on {source} frame...")
        try:
            enriched_results = _recognize_and_enrich(img, request, db, realtime=False)
            detections_payload = enriched_results
            print(f"[LIVE-PREVIEW] Detected {len(enriched_results)} face(s): "
                  f"{[r['match']['name'] if r.get('match') else 'Unknown' for r in enriched_results]}")
            for res in enriched_results:
                bbox  = res["bbox"]
                match = res["match"]
                x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
                name  = match["name"] if match else "Unknown"
                conf  = match["confidence"] if match else 0.0
                color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
                cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
                label = f"{name} ({conf:.2f})" if name != "Unknown" else name
                (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                text_y = max(y1 - 10, th + 4)
                cv2.rectangle(img, (x1, text_y - th - 4), (x1 + tw + 8, text_y + 2), color, -1)
                cv2.putText(img, label, (x1 + 4, text_y - 2),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        except Exception as exc:
            print(f"[LIVE-PREVIEW] ERROR during recognition: {exc}")

    height, width = img.shape[:2]
    max_width = 960
    if width > max_width:
        resized_height = max(1, int(height * (max_width / width)))
        img = cv2.resize(img, (max_width, resized_height), interpolation=cv2.INTER_AREA)

    ok, encoded = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode live preview frame.")

    frame_base64 = f"data:image/jpeg;base64,{base64.b64encode(encoded.tobytes()).decode('ascii')}"
    updated_at = datetime.now(timezone.utc)

    LIVE_PREVIEWS[source] = {
        "frame_data_url": frame_base64,
        "updated_at": updated_at,
        "detections": detections_payload,
    }
    return _build_live_preview_payload(source)


@router.get("/live-preview/{source}", response_model=LivePreviewFrame)
def get_live_preview(source: Literal["admin", "user"]):
    return _build_live_preview_payload(source)

@router.delete("/live-preview/{source}", response_model=LivePreviewFrame)
def clear_live_preview(source: Literal["admin", "user"]):
    LIVE_PREVIEWS.pop(source, None)
    return _build_live_preview_payload(source)

@router.get("/detections/latest", response_model=List[DetectedFace])
def get_latest_detections(request: Request, db: Session = Depends(get_db)):
    user_lookup = _load_user_lookup(db, request)
    return _enrich_detections(LATEST_DETECTIONS, user_lookup)

def _serialize_presence_session(sess, request: Request) -> dict:
    best_path = sess.best_frame_path or sess.image_path
    image_url = _image_url_from_path(request, best_path)
    
    timeline = []
    if sess.timeline_data:
        try:
            timeline = json.loads(sess.timeline_data)
        except Exception:
            pass
            
    return {
        "id": sess.id,
        "user_id": sess.user_id,
        "name": sess.name,
        "start_time": sess.start_time,
        "last_seen": sess.last_seen,
        "entry_time": sess.entry_time,
        "exit_time": sess.exit_time,
        "duration": sess.duration_seconds,
        "image_url": image_url,
        "average_confidence": sess.average_confidence,
        "max_confidence": sess.max_confidence,
        "detection_type": sess.detection_type,
        "session_status": sess.session_status,
        "timeline": timeline
    }

@router.get("/detections/presence", response_model=PresenceSummaryResponse)
def get_presence_summary(request: Request, db: Session = Depends(get_db)):
    metrics = metrics_aggregator.aggregate_metrics(db)
    
    # Query all presence sessions to build history
    sessions = db.query(PresenceSession).order_by(PresenceSession.entry_time.desc()).all()
    serialized_history = [_serialize_presence_session(sess, request) for sess in sessions]
    
    return {
        "total_known_persons": metrics["knownPersons"],
        "total_unknown_persons": metrics["unknownPersons"],
        "known_time_present": metrics["rawKnownTime"],
        "unknown_time_present": metrics["rawUnknownTime"],
        "history": serialized_history
    }

@router.get("/detections/dashboard-history")
def get_dashboard_history(db: Session = Depends(get_db)):
    from app.models.dashboard_session_history import DashboardSessionHistory
    import json

    entries = db.query(DashboardSessionHistory).order_by(DashboardSessionHistory.session_end.desc()).all()
    
    serialized = []
    for entry in entries:
        presence_logs = []
        if entry.presence_logs_json:
            try:
                presence_logs = json.loads(entry.presence_logs_json)
            except Exception:
                pass
                
        serialized.append({
            "id": entry.id,
            "device_id": entry.device_id,
            "session_start": entry.session_start.isoformat(),
            "session_end": entry.session_end.isoformat(),
            "total_known_persons": entry.total_known_persons,
            "total_unknown_persons": entry.total_unknown_persons,
            "known_time_present": entry.known_time_present,
            "unknown_time_present": entry.unknown_time_present,
            "presence_logs": presence_logs
        })
    return serialized

@router.get("/detections/history")
def get_detection_history(
    request: Request,
    start_date: str | None = None,
    end_date: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    detection_type: str | None = None,
    person_name: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(PresenceSession)
    
    # Filter by Date Range (entry_time)
    if start_date:
        try:
            dt_start = datetime.fromisoformat(start_date.replace("Z", ""))
            query = query.filter(PresenceSession.entry_time >= dt_start)
        except ValueError:
            pass
    if end_date:
        try:
            dt_end = datetime.fromisoformat(end_date.replace("Z", ""))
            query = query.filter(PresenceSession.entry_time <= dt_end)
        except ValueError:
            pass

    # Filter by Detection Type
    if detection_type and detection_type != "ALL":
        query = query.filter(PresenceSession.detection_type == detection_type)

    # Filter by Person Name
    if person_name and person_name.strip():
        query = query.filter(PresenceSession.name.ilike(f"%{person_name.strip()}%"))

    sessions = query.order_by(PresenceSession.entry_time.desc()).all()
    
    # Filter by Time-of-day in Python for DB-neutral compatibility
    filtered_sessions = []
    for sess in sessions:
        if start_time or end_time:
            sess_time_str = sess.entry_time.strftime("%H:%M:%S")
            if start_time and sess_time_str < start_time:
                continue
            if end_time and sess_time_str > end_time:
                continue
        filtered_sessions.append(_serialize_presence_session(sess, request))
        
    return {"history": filtered_sessions}

@router.get("/detections/sessions/{session_id}")
def get_session_details(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    sess = db.query(PresenceSession).filter(PresenceSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return _serialize_presence_session(sess, request)

def _open_camera(cam_src):
    """Try to open camera using multiple backends (Windows-compatible)."""
    # On Windows, try MSMF first (best), then DSHOW, then auto
    backends = [
        (cv2.CAP_MSMF,  "MSMF (Microsoft Media Foundation)"),
        (cv2.CAP_DSHOW, "DirectShow"),
        (cv2.CAP_ANY,   "Auto"),
    ]
    for backend, name in backends:
        cap = cv2.VideoCapture(cam_src, backend)
        if cap.isOpened():
            ret, _ = cap.read()
            if ret:
                print(f"[Camera] Opened with backend: {name}")
                return cap
            cap.release()
        print(f"[Camera] Backend {name} failed")
    return None

def generate_frames():
    """Video streaming generator function."""
    global LATEST_DETECTIONS
    cam_src = settings.CAMERA_SOURCE
    if isinstance(cam_src, str) and cam_src.isdigit():
        cam_src = int(cam_src)

    camera = _open_camera(cam_src)

    if camera is None:
        # Yield a visible error frame
        error_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(error_frame, "Camera not found!", (80, 220),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 255), 3)
        cv2.putText(error_frame, "Check camera connection", (80, 270),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        _, buffer = cv2.imencode('.jpg', error_frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        return

    frame_count = 0
    process_every_n_frames = 2
    last_results = []

    try:
        while True:
            success, frame = camera.read()
            if not success:
                break

            frame_count += 1

            if frame_count % process_every_n_frames == 0:
                last_results = recognize_faces_in_image(frame, realtime=True)
                LATEST_DETECTIONS = deepcopy(last_results)

            for res in last_results:
                bbox  = res["bbox"]
                match = res["match"]
                x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
                name  = match["name"]
                conf  = match["confidence"]
                color = (0, 255, 0) if name != "Unknown" else (0, 0, 255)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                label = f"{name} ({conf:.2f})" if name != "Unknown" else name
                cv2.putText(frame, label, (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)

            _, buffer = cv2.imencode('.jpg', frame)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
    finally:
        camera.release()

@router.get("/camera-test")
def camera_test():
    """Diagnostic endpoint: checks if camera can be opened."""
    cam_src = settings.CAMERA_SOURCE
    if isinstance(cam_src, str) and cam_src.isdigit():
        cam_src = int(cam_src)
    results = {}
    for backend_id, backend_name in [
        (cv2.CAP_MSMF,  "MSMF"),
        (cv2.CAP_DSHOW, "DSHOW"),
        (cv2.CAP_ANY,   "AUTO"),
    ]:
        cap = cv2.VideoCapture(cam_src, backend_id)
        opened = cap.isOpened()
        frame_ok = False
        if opened:
            ret, _ = cap.read()
            frame_ok = ret
            cap.release()
        results[backend_name] = {"opened": opened, "frame_read": frame_ok}
    return {"camera_source": cam_src, "backends": results}

@router.get("/stream")
def video_feed():
    """Video streaming route. Put this in the src attribute of an img tag."""
    return StreamingResponse(
        generate_frames(),
        media_type='multipart/x-mixed-replace; boundary=frame'
    )


# ----------------------------------------------------
# People category & Album endpoints
# ----------------------------------------------------

@router.get("/people", response_model=List[PersonClusterResponse])
def get_people(request: Request, db: Session = Depends(get_db)):
    users = db.query(User).options(selectinload(User.embeddings)).all()
    user_lookup = {u.id: u for u in users}

    clusters = {}

    # Initialize with all registered users
    for u in users:
        cluster_id = f"user-{u.id}"
        profile_image_url = None
        if u.embeddings:
            profile_image_url = _image_url_from_path(request, u.embeddings[0].image_path)

        clusters[cluster_id] = {
            "cluster_id": cluster_id,
            "label": u.name,
            "is_registered": True,
            "user_id": u.id,
            "cover_image_url": profile_image_url,
            "cover_bbox": None,
            "faces": [],
        }

    # Query all scans ordered by creation date descending to group scanned faces
    scans = db.query(PhotoScan).order_by(PhotoScan.created_at.desc()).all()
    for scan in scans:
        if not scan.scan_details:
            continue
        faces_list = scan.scan_details.get("faces", [])
        for face_index, face in enumerate(faces_list, start=1):
            cluster = face.get("cluster") or {}
            cluster_id = cluster.get("cluster_id")
            if not cluster_id:
                continue

            if cluster_id not in clusters:
                label = cluster.get("label") or f"Cluster {cluster_id}"
                matched_user_id = cluster.get("matched_user_id")
                is_registered = False
                user_id = None

                if matched_user_id and matched_user_id in user_lookup:
                    is_registered = True
                    user_id = matched_user_id
                    label = user_lookup[matched_user_id].name

                clusters[cluster_id] = {
                    "cluster_id": cluster_id,
                    "label": label,
                    "is_registered": is_registered,
                    "user_id": user_id,
                    "cover_image_url": None,
                    "cover_bbox": None,
                    "faces": [],
                }

            face_instance = {
                "photo_scan_id": scan.id,
                "photo_scan_filename": scan.original_filename,
                "photo_scan_created_at": scan.created_at,
                "image_url": _image_url_from_path(request, scan.image_path),
                "bbox": face.get("bbox"),
                "confidence": face.get("confidence"),
                "is_confirmed": face.get("cluster", {}).get("is_confirmed", False),
                "variation_handling": face.get("variation_handling"),
                "features": face.get("features"),
            }
            clusters[cluster_id]["faces"].append(face_instance)

    # Set cover image for unregistered clusters and ensure cover_bbox
    for cluster_id, data in clusters.items():
        if not data["cover_image_url"] and data["faces"]:
            data["cover_image_url"] = data["faces"][0]["image_url"]
            data["cover_bbox"] = data["faces"][0]["bbox"]

    # Filter out clusters with no faces and no registered user
    result_list = []
    for data in clusters.values():
        if data["faces"] or data["is_registered"]:
            result_list.append(PersonClusterResponse(**data))
    return result_list


@router.get("/people/crop")
def crop_people_face(
    photo_scan_id: int,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    db: Session = Depends(get_db)
):
    scan = db.query(PhotoScan).filter(PhotoScan.id == photo_scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Photo scan record not found")

    if not os.path.exists(scan.image_path):
        raise HTTPException(status_code=404, detail="Source image file not found on disk")

    img = cv2.imread(scan.image_path)
    if img is None:
        raise HTTPException(status_code=500, detail="Could not read source image file")

    h, w = img.shape[:2]
    # Ensure coordinates are within boundary
    rx1, ry1 = max(0, x1), max(0, y1)
    rx2, ry2 = min(w, x2), min(h, y2)

    if rx2 <= rx1 or ry2 <= ry1:
        raise HTTPException(status_code=400, detail="Invalid crop coordinates")

    crop = img[ry1:ry2, rx1:rx2]
    ok, encoded = cv2.imencode(".jpg", crop)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode cropped face")

    from io import BytesIO
    return StreamingResponse(BytesIO(encoded.tobytes()), media_type="image/jpeg")


@router.post("/people/{cluster_id}/enroll", response_model=UserResponse)
def enroll_cluster(
    cluster_id: str,
    payload: EnrollClusterRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    # Check if cluster is already registered to a user
    if cluster_id.startswith("user-"):
        raise HTTPException(status_code=400, detail="This cluster is already registered to a user")

    # Find the cluster face in the database scans
    found_face = None
    source_scan = None

    scans = db.query(PhotoScan).all()
    for scan in scans:
        if not scan.scan_details:
            continue
        faces_list = scan.scan_details.get("faces", [])
        for face in faces_list:
            if face.get("cluster", {}).get("cluster_id") == cluster_id:
                found_face = face
                source_scan = scan
                break
        if found_face:
            break

    if not found_face or not source_scan:
        raise HTTPException(status_code=404, detail="Cluster not found in recent scans")

    embedding_vector = found_face.get("embedding_vector")
    bbox = found_face.get("bbox")

    if not embedding_vector:
        raise HTTPException(status_code=400, detail="Face embedding vector is missing from scan details")

    # Read source image and crop the face for profile photo
    if not os.path.exists(source_scan.image_path):
        raise HTTPException(status_code=400, detail="Source image file not found on disk")

    img = cv2.imread(source_scan.image_path)
    if img is None:
        raise HTTPException(status_code=500, detail="Could not read source image file")

    h, w = img.shape[:2]
    x1, y1 = max(0, int(bbox["x1"])), max(0, int(bbox["y1"]))
    x2, y2 = min(w, int(bbox["x2"])), min(h, int(bbox["y2"]))

    if x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail="Invalid face bounding box for enrollment")

    face_crop = img[y1:y2, x1:x2]

    # Save cropped face to UPLOAD_DIR
    file_extension = ".jpg"
    filename = f"{uuid.uuid4()}{file_extension}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    try:
        cv2.imwrite(filepath, face_crop)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save profile image: {e}")

    try:
        # Create new User
        new_user = User(name=payload.name)
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        # Create FaceEmbedding
        vector = np.array(embedding_vector, dtype=np.float32)
        embedding_record = FaceEmbedding(
            user_id=new_user.id,
            embedding=vector.tobytes(),
            image_path=filepath,
        )
        db.add(embedding_record)
        db.commit()
        db.refresh(new_user)
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database enrollment failed: {e}")

    # Update all PhotoScan records that contain this cluster_id
    scans_to_update = []
    for scan in scans:
        if not scan.scan_details:
            continue
        updated = False
        faces_list = scan.scan_details.get("faces", [])
        for face in faces_list:
            if face.get("cluster", {}).get("cluster_id") == cluster_id:
                face["cluster"]["cluster_id"] = f"user-{new_user.id}"
                face["cluster"]["label"] = new_user.name
                face["cluster"]["is_new_cluster"] = False
                face["cluster"]["matched_user_id"] = new_user.id
                face["cluster"]["matched_user_name"] = new_user.name
                updated = True
        if updated:
            scan.scan_details = {"faces": faces_list}
            flag_modified(scan, "scan_details")
            scans_to_update.append(scan)

    if scans_to_update:
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            # Log error but don't fail registration since registration succeeded
            print(f"[Warning] Failed to update past scans: {e}")

    # Sync FAISS index: replace old cluster entries with the new registered user entry.
    face_index.remove_by_cluster_id(cluster_id)
    vector = np.array(embedding_vector, dtype=np.float32)
    new_cid = f"user-{new_user.id}"
    face_index.add(vector, {
        "cluster_id": new_cid,
        "label": new_user.name,
        "user_id": new_user.id,
        "user_name": new_user.name,
    })

    # Update face_clusters: rename old cluster → new user cluster.
    old_cluster = db.query(FaceCluster).filter_by(cluster_id=cluster_id).first()
    face_count = old_cluster.face_count if old_cluster else 1
    if old_cluster:
        db.delete(old_cluster)
    _upsert_cluster(
        db, new_cid,
        label=new_user.name,
        user_id=new_user.id,
        face_count_delta=face_count,
    )
    db.commit()

    return _serialize_user(new_user, request)


@router.post("/people/confirm")
def confirm_person_face(
    payload: ConfirmFaceRequest,
    db: Session = Depends(get_db)
):
    scan = db.query(PhotoScan).filter(PhotoScan.id == payload.photo_scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Photo scan record not found")

    if not scan.scan_details:
        raise HTTPException(status_code=400, detail="Scan details empty")

    faces_list = scan.scan_details.get("faces", [])
    target_face = None
    for face in faces_list:
        bbox = face.get("bbox", {})
        if abs(bbox.get("x1", 0) - payload.x1) <= 2 and abs(bbox.get("y1", 0) - payload.y1) <= 2:
            target_face = face
            break

    if not target_face:
        raise HTTPException(status_code=404, detail="Face not found in this scan")

    cluster = target_face.get("cluster", {})
    user_id = cluster.get("matched_user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="This face must be matched to a registered user first")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Matched user not found in database")

    embedding_vector = target_face.get("embedding_vector")
    if not embedding_vector:
        raise HTTPException(status_code=400, detail="Embedding vector missing from face instance")

    # Crop and save face to uploads
    if not os.path.exists(scan.image_path):
        raise HTTPException(status_code=400, detail="Source image file not found on disk")

    img = cv2.imread(scan.image_path)
    if img is None:
        raise HTTPException(status_code=500, detail="Could not read source image file")

    h, w = img.shape[:2]
    bbox = target_face.get("bbox")
    x1, y1 = max(0, int(bbox["x1"])), max(0, int(bbox["y1"]))
    x2, y2 = min(w, int(bbox["x2"])), min(h, int(bbox["y2"]))

    if x2 <= x1 or y2 <= y1:
        raise HTTPException(status_code=400, detail="Invalid bounding box for cropping")

    face_crop = img[y1:y2, x1:x2]
    file_extension = ".jpg"
    filename = f"{uuid.uuid4()}{file_extension}"
    filepath = os.path.join(settings.UPLOAD_DIR, filename)

    try:
        cv2.imwrite(filepath, face_crop)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save profile image: {e}")

    try:
        # Create new FaceEmbedding for the user (Continuous Learning!)
        vector = np.array(embedding_vector, dtype=np.float32)
        embedding_record = FaceEmbedding(
            user_id=user.id,
            embedding=vector.tobytes(),
            image_path=filepath,
            photo_scan_id=scan.id,   # referential traceability (Gap 1)
        )
        db.add(embedding_record)

        # Mark confirmed in scan_details
        target_face["cluster"]["is_confirmed"] = True
        scan.scan_details = {"faces": faces_list}
        flag_modified(scan, "scan_details")

        db.commit()

        # Sync FAISS index: add the confirmed embedding as a learning vector.
        face_index.add(vector, {
            "cluster_id": f"user-{user.id}",
            "label": user.name,
            "user_id": user.id,
            "user_name": user.name,
        })
    except Exception as e:
        if os.path.exists(filepath):
            os.remove(filepath)
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save confirmed embedding: {e}")

    return {"status": "success", "message": "Face confirmed and learning vector added"}


@router.post("/people/merge")
def merge_people(
    payload: MergePeopleRequest,
    db: Session = Depends(get_db)
):
    primary = payload.primary_cluster_id
    secondary = payload.secondary_cluster_id

    if primary == secondary:
        raise HTTPException(status_code=400, detail="Cannot merge a cluster with itself")

    # Case 1: Both are registered users
    if primary.startswith("user-") and secondary.startswith("user-"):
        primary_id = int(primary.split("-")[1])
        secondary_id = int(secondary.split("-")[1])

        primary_user = db.query(User).filter(User.id == primary_id).first()
        secondary_user = db.query(User).filter(User.id == secondary_id).first()

        if not primary_user or not secondary_user:
            raise HTTPException(status_code=404, detail="One or both users not found")

        # Transfer all FaceEmbeddings from secondary to primary
        embeddings = db.query(FaceEmbedding).filter(FaceEmbedding.user_id == secondary_id).all()
        for emb in embeddings:
            emb.user_id = primary_id
        
        # Find all scans of secondary user and update to primary user
        scans = db.query(PhotoScan).all()
        for scan in scans:
            if not scan.scan_details:
                continue
            faces_list = scan.scan_details.get("faces", [])
            updated = False
            for face in faces_list:
                if face.get("cluster", {}).get("cluster_id") == secondary:
                    face["cluster"]["cluster_id"] = primary
                    face["cluster"]["label"] = primary_user.name
                    face["cluster"]["matched_user_id"] = primary_id
                    face["cluster"]["matched_user_name"] = primary_user.name
                    updated = True
            if updated:
                scan.scan_details = {"faces": faces_list}
                flag_modified(scan, "scan_details")

        # Delete secondary user
        db.delete(secondary_user)
        db.commit()

        # Sync FAISS index: remap secondary user entries to primary.
        face_index.update_cluster_id(
            old_cluster_id=secondary,
            new_cluster_id=primary,
            new_label=primary_user.name,
        )
        face_index.remove_by_user_id(secondary_id)

        return {"status": "success", "message": f"Successfully merged user {secondary_user.name} into {primary_user.name}"}

    # Case 2: Primary is registered, secondary is unregistered
    elif primary.startswith("user-") and not secondary.startswith("user-"):
        primary_id = int(primary.split("-")[1])
        primary_user = db.query(User).filter(User.id == primary_id).first()
        if not primary_user:
            raise HTTPException(status_code=404, detail="Primary user not found")

        # Find any scan matching secondary to get a learning embedding vector
        secondary_face = None
        secondary_scan = None

        scans = db.query(PhotoScan).all()
        for scan in scans:
            if not scan.scan_details:
                continue
            faces_list = scan.scan_details.get("faces", [])
            updated = False
            for face in faces_list:
                if face.get("cluster", {}).get("cluster_id") == secondary:
                    face["cluster"]["cluster_id"] = primary
                    face["cluster"]["label"] = primary_user.name
                    face["cluster"]["is_new_cluster"] = False
                    face["cluster"]["matched_user_id"] = primary_id
                    face["cluster"]["matched_user_name"] = primary_user.name
                    updated = True
                    if not secondary_face:
                        secondary_face = face
                        secondary_scan = scan
            if updated:
                scan.scan_details = {"faces": faces_list}
                flag_modified(scan, "scan_details")

        # Continuous learning: Add the first face's embedding of the secondary cluster to primary user's profile
        if secondary_face and secondary_scan:
            embedding_vector = secondary_face.get("embedding_vector")
            bbox = secondary_face.get("bbox")
            if embedding_vector and bbox and os.path.exists(secondary_scan.image_path):
                img = cv2.imread(secondary_scan.image_path)
                if img is not None:
                    h, w = img.shape[:2]
                    x1, y1 = max(0, int(bbox["x1"])), max(0, int(bbox["y1"]))
                    x2, y2 = min(w, int(bbox["x2"])), min(h, int(bbox["y2"]))
                    if x2 > x1 and y2 > y1:
                        face_crop = img[y1:y2, x1:x2]
                        filename = f"{uuid.uuid4()}.jpg"
                        filepath = os.path.join(settings.UPLOAD_DIR, filename)
                        cv2.imwrite(filepath, face_crop)
                        
                        vector = np.array(embedding_vector, dtype=np.float32)
                        new_emb = FaceEmbedding(
                            user_id=primary_id,
                            embedding=vector.tobytes(),
                            image_path=filepath
                        )
                        db.add(new_emb)

        db.commit()

        # Sync FAISS index: remap secondary cluster to primary user and add learning vector.
        face_index.update_cluster_id(
            old_cluster_id=secondary,
            new_cluster_id=primary,
            new_label=primary_user.name,
        )
        if secondary_face:
            ev2 = secondary_face.get("embedding_vector")
            if ev2:
                face_index.add(np.array(ev2, dtype=np.float32), {
                    "cluster_id": primary,
                    "label": primary_user.name,
                    "user_id": primary_id,
                    "user_name": primary_user.name,
                })

        return {"status": "success", "message": f"Successfully merged cluster {secondary} into user {primary_user.name}"}

    # Case 3: Primary is unregistered, secondary is registered (swap roles)
    elif not primary.startswith("user-") and secondary.startswith("user-"):
        secondary_id = int(secondary.split("-")[1])
        secondary_user = db.query(User).filter(User.id == secondary_id).first()
        if not secondary_user:
            raise HTTPException(status_code=404, detail="Secondary user not found")

        # Find any scan matching primary (unregistered) to get learning embedding vector
        scans = db.query(PhotoScan).all()
        primary_face = None
        primary_scan = None
        for scan in scans:
            if not scan.scan_details:
                continue
            faces_list = scan.scan_details.get("faces", [])
            updated = False
            for face in faces_list:
                if face.get("cluster", {}).get("cluster_id") == primary:
                    face["cluster"]["cluster_id"] = secondary
                    face["cluster"]["label"] = secondary_user.name
                    face["cluster"]["is_new_cluster"] = False
                    face["cluster"]["matched_user_id"] = secondary_id
                    face["cluster"]["matched_user_name"] = secondary_user.name
                    updated = True
                    if not primary_face:
                        primary_face = face
                        primary_scan = scan
            if updated:
                scan.scan_details = {"faces": faces_list}
                flag_modified(scan, "scan_details")

        if primary_face and primary_scan:
            embedding_vector = primary_face.get("embedding_vector")
            bbox = primary_face.get("bbox")
            if embedding_vector and bbox and os.path.exists(primary_scan.image_path):
                img = cv2.imread(primary_scan.image_path)
                if img is not None:
                    h, w = img.shape[:2]
                    x1, y1 = max(0, int(bbox["x1"])), max(0, int(bbox["y1"]))
                    x2, y2 = min(w, int(bbox["x2"])), min(h, int(bbox["y2"]))
                    if x2 > x1 and y2 > y1:
                        face_crop = img[y1:y2, x1:x2]
                        filename = f"{uuid.uuid4()}.jpg"
                        filepath = os.path.join(settings.UPLOAD_DIR, filename)
                        cv2.imwrite(filepath, face_crop)
                        
                        vector = np.array(embedding_vector, dtype=np.float32)
                        new_emb = FaceEmbedding(
                            user_id=secondary_id,
                            embedding=vector.tobytes(),
                            image_path=filepath
                        )
                        db.add(new_emb)

        db.commit()

        # Sync FAISS index: remap primary unregistered cluster to secondary user.
        face_index.update_cluster_id(
            old_cluster_id=primary,
            new_cluster_id=secondary,
            new_label=secondary_user.name,
        )
        if primary_face:
            ev3 = primary_face.get("embedding_vector")
            if ev3:
                face_index.add(np.array(ev3, dtype=np.float32), {
                    "cluster_id": secondary,
                    "label": secondary_user.name,
                    "user_id": secondary_id,
                    "user_name": secondary_user.name,
                })

        return {"status": "success", "message": f"Successfully merged cluster {primary} into user {secondary_user.name}"}

    # Case 4: Both are unregistered clusters
    else:
        scans = db.query(PhotoScan).all()
        secondary_label = f"Cluster {primary}"
        for scan in scans:
            if not scan.scan_details:
                continue
            faces_list = scan.scan_details.get("faces", [])
            for face in faces_list:
                if face.get("cluster", {}).get("cluster_id") == primary:
                    secondary_label = face.get("cluster", {}).get("label") or secondary_label
                    break

        for scan in scans:
            if not scan.scan_details:
                continue
            faces_list = scan.scan_details.get("faces", [])
            updated = False
            for face in faces_list:
                if face.get("cluster", {}).get("cluster_id") == secondary:
                    face["cluster"]["cluster_id"] = primary
                    face["cluster"]["label"] = secondary_label
                    face["cluster"]["is_new_cluster"] = False
                    updated = True
            if updated:
                scan.scan_details = {"faces": faces_list}
                flag_modified(scan, "scan_details")

        db.commit()

        # Sync FAISS index: remap secondary cluster entries to primary.
        face_index.update_cluster_id(
            old_cluster_id=secondary,
            new_cluster_id=primary,
            new_label=secondary_label,
        )

        return {"status": "success", "message": f"Successfully merged cluster {secondary} into cluster {primary}"}


@router.post("/people/remove-match")
def remove_incorrect_match(
    payload: RemoveMatchRequest,
    db: Session = Depends(get_db)
):
    scan = db.query(PhotoScan).filter(PhotoScan.id == payload.photo_scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Photo scan record not found")

    if not scan.scan_details:
        raise HTTPException(status_code=400, detail="Scan details empty")

    faces_list = scan.scan_details.get("faces", [])
    target_face = None
    for face in faces_list:
        bbox = face.get("bbox", {})
        if abs(bbox.get("x1", 0) - payload.x1) <= 2 and abs(bbox.get("y1", 0) - payload.y1) <= 2:
            target_face = face
            break

    if not target_face:
        raise HTTPException(status_code=404, detail="Face not found in this scan")

    # Generate a brand new cluster ID to isolate this face completely
    new_cluster_id = f"unmatched-{uuid.uuid4().hex[:8]}"
    
    old_cluster_id = target_face.get("cluster", {}).get("cluster_id")
    ev_remove = target_face.get("embedding_vector")

    target_face["cluster"] = {
        "cluster_id": new_cluster_id,
        "label": f"New face cluster {new_cluster_id}",
        "is_new_cluster": True,
        "best_similarity": 0.0,
        "threshold": settings.SIMILARITY_THRESHOLD,
        "comparison_count": 0,
        "matched_user_id": None,
        "matched_user_name": None,
        "is_confirmed": False
    }

    scan.scan_details = {"faces": faces_list}
    flag_modified(scan, "scan_details")
    db.commit()

    if old_cluster_id and ev_remove:
        face_index.remove_by_cluster_id(new_cluster_id)  # idempotent guard
        vec_remove = np.array(ev_remove, dtype=np.float32)
        face_index.add(vec_remove, {
            "cluster_id": new_cluster_id,
            "label": f"New face cluster {new_cluster_id}",
            "user_id": None,
            "user_name": None,
        })

    # Sync face_clusters: create isolated cluster record.
    _upsert_cluster(
        db, new_cluster_id,
        label=f"New face cluster {new_cluster_id}",
        face_count_delta=1,
    )
    db.commit()

    return {"status": "success", "message": "Face match removed and reset to new cluster"}


# ---------------------------------------------------------------------------
# Gap 6 — DBSCAN global re-clustering
# ---------------------------------------------------------------------------

@router.post("/people/recluster")
def recluster_people(db: Session = Depends(get_db)):
    """Re-cluster all unregistered face clusters using DBSCAN.

    Algorithm
    ---------
    1. Collect every embedding from ``photo_scans.scan_details`` that belongs
       to an **unregistered** cluster (i.e. not ``user-{id}``).
    2. Run ``sklearn.cluster.DBSCAN`` with ``metric="cosine"`` and
       ``eps = 1 - SIMILARITY_THRESHOLD``.
    3. Build a remapping table: old_cluster_id → canonical_cluster_id.
       Registered clusters are *always* kept intact.
    4. Apply the remapping to every ``scan_details`` JSON blob in the DB.
    5. Update the ``face_clusters`` table.
    6. Rebuild the FAISS index.

    This is an on-demand operation; the real-time per-photo greedy assignment
    is unchanged.
    """
    from sklearn.cluster import DBSCAN as SklearnDBSCAN

    threshold = settings.SIMILARITY_THRESHOLD
    eps = max(1e-6, 1.0 - threshold)  # cosine distance threshold

    # Registered cluster IDs are anchored — never reassigned.
    registered_cids = {f"user-{u.id}" for u in db.query(User).all()}

    # -----------------------------------------------------------------------
    # 1. Collect all unregistered face embeddings
    # -----------------------------------------------------------------------
    entries: list[dict] = []
    scans_all = db.query(PhotoScan).all()

    for scan in scans_all:
        if not scan.scan_details:
            continue
        for fi, face in enumerate(scan.scan_details.get("faces", []), start=1):
            cluster = face.get("cluster") or {}
            cid = cluster.get("cluster_id", "")
            if not cid or cid in registered_cids:
                continue
            ev = face.get("embedding_vector")
            if not ev:
                continue
            entries.append({
                "vector": np.array(ev, dtype=np.float32),
                "cluster_id": cid,
                "scan_id": scan.id,
                "face_idx": fi,
            })

    if len(entries) < 2:
        return {
            "status": "skipped",
            "message": "Not enough unregistered faces to recluster.",
            "unregistered_faces": len(entries),
        }

    # -----------------------------------------------------------------------
    # 2. Run DBSCAN
    # -----------------------------------------------------------------------
    matrix = np.vstack([e["vector"] for e in entries]).astype(np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix_norm = matrix / norms

    db_scan = SklearnDBSCAN(eps=eps, min_samples=1, metric="cosine", algorithm="brute")
    labels = db_scan.fit_predict(matrix_norm)

    # -----------------------------------------------------------------------
    # 3. Choose a canonical cluster_id for each DBSCAN label
    #    Prefer stable (non-transient) IDs over "upload-*" temp IDs.
    # -----------------------------------------------------------------------
    label_to_canonical: dict[int, str] = {}
    for i, label in enumerate(labels):
        if label < 0:  # DBSCAN noise — keep as-is
            continue
        cid = entries[i]["cluster_id"]
        if label not in label_to_canonical:
            label_to_canonical[label] = cid
        elif not cid.startswith("upload-"):
            label_to_canonical[label] = cid  # prefer stable IDs

    # Build old → new remapping (only for entries that actually change).
    remapping: dict[str, str] = {}
    for i, label in enumerate(labels):
        if label < 0:
            continue
        old = entries[i]["cluster_id"]
        new = label_to_canonical.get(label, old)
        if old != new:
            remapping[old] = new

    if not remapping:
        return {
            "status": "no_change",
            "message": "DBSCAN found no clusters to merge.",
            "unregistered_faces": len(entries),
        }

    # -----------------------------------------------------------------------
    # 4. Apply remapping to all scan_details
    # -----------------------------------------------------------------------
    affected_scans: set[int] = set()
    for scan in scans_all:
        if not scan.scan_details:
            continue
        changed = False
        for face in scan.scan_details.get("faces", []):
            old_cid = face.get("cluster", {}).get("cluster_id", "")
            if old_cid in remapping:
                new_cid = remapping[old_cid]
                face["cluster"]["cluster_id"] = new_cid
                face["cluster"]["label"] = next(
                    (e["cluster_id"] for e in entries if e["cluster_id"] == new_cid),
                    f"Cluster {new_cid}",
                )
                changed = True
        if changed:
            scan.scan_details = {"faces": scan.scan_details["faces"]}
            flag_modified(scan, "scan_details")
            affected_scans.add(scan.id)

    db.commit()

    # -----------------------------------------------------------------------
    # 5. Update face_clusters table
    # -----------------------------------------------------------------------
    for old_cid, new_cid in remapping.items():
        old_rec = db.query(FaceCluster).filter_by(cluster_id=old_cid).first()
        old_count = old_rec.face_count if old_rec else 0
        if old_rec:
            db.delete(old_rec)
        _upsert_cluster(db, new_cid, label=f"Cluster {new_cid}", face_count_delta=old_count)
    db.commit()

    # -----------------------------------------------------------------------
    # 6. Rebuild FAISS index
    # -----------------------------------------------------------------------
    face_index.rebuild_from_db(db)

    return {
        "status": "success",
        "clusters_merged": len(remapping),
        "scans_updated": len(affected_scans),
        "unregistered_faces": len(entries),
    }
