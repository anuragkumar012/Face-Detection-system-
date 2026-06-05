import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.face_embedding import FaceEmbedding
from app.services.face_embedder import embedder
from app.core.exceptions import FaceDetectionError


def enroll_user(
    db: Session,
    name: str,
    image: np.ndarray,
    image_path: str | None = None,
    photo_scan_id: int | None = None,
    angle: str | None = None,
) -> User:
    faces = embedder.get_embeddings(image)

    # 1. Face Count Validation
    if len(faces) == 0:
        raise FaceDetectionError("No faces detected in the image.")
    if len(faces) > 1:
        raise FaceDetectionError(
            "Multiple faces detected. Please provide an image with only one face."
        )

    face = faces[0]
    bbox = face.bbox

    # 2. Face Size Validation (minimum 80x80)
    w_face = bbox[2] - bbox[0]
    h_face = bbox[3] - bbox[1]
    if w_face < 80 or h_face < 80:
        raise FaceDetectionError(
            f"Face is too small ({w_face}x{h_face}px). Bounding box must be at least 80x80 pixels."
        )

    # 3. Blurriness Quality Validation (Laplacian variance threshold: 80.0)
    h_img, w_img = image.shape[:2]
    x1, y1 = max(0, int(bbox[0])), max(0, int(bbox[1]))
    x2, y2 = min(w_img, int(bbox[2])), min(h_img, int(bbox[3]))
    face_crop = image[y1:y2, x1:x2]

    if face_crop.size > 0:
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        if variance < 40.0:
            raise FaceDetectionError(
                f"Face image is too blurry (Laplacian variance: {variance:.2f}). Please upload a sharper image."
            )

    embedding = face.embedding

    # 4. Duplicate Enrollment Check (similarity threshold: 0.80)
    from app.services.matcher import matcher
    match_res = matcher.find_best_match(embedding, threshold=0.80)

    # Check if a user with this name already exists in the database
    db_user = db.query(User).filter(User.name == name).first()

    if match_res["matched"]:
        if db_user is None or match_res["user_id"] != db_user.id:
            raise FaceDetectionError(f"Face already enrolled as {match_res['name']}")

    # 5. Persist to SQL Database
    if db_user is None:
        db_user = User(name=name)
        db.add(db_user)
        db.flush()

    embedding_bytes = embedding.tobytes()
    db_embedding = FaceEmbedding(
        user_id=db_user.id,
        embedding=embedding_bytes,
        image_path=image_path,
        photo_scan_id=photo_scan_id,
        angle=angle or "front",
    )
    
    try:
        db.add(db_embedding)
        db.commit()
        db.refresh(db_user)
    except Exception:
        db.rollback()
        raise

    # 6. Persist to ChromaDB Vector Index
    from app.services.vector_index import add_embedding
    add_embedding(
        user_id=db_user.id,
        name=db_user.name,
        photo_scan_id=photo_scan_id,
        embedding=embedding,
        angle=angle or "front",
    )

    return db_user
