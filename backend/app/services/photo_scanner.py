import numpy as np

from app.core.config import settings
from app.services.face_embedder import embedder
from app.services.vector_index import face_index, cosine_similarity


LANDMARK_KEYS = ("left_eye", "right_eye", "nose", "left_mouth", "right_mouth")
FACENET_STYLE_MODEL_NAME = "InsightFace buffalo_l embedding, FaceNet-style vector space"


def _point_payload(point: np.ndarray) -> dict[str, int]:
    return {"x": int(point[0]), "y": int(point[1])}


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



def _assign_cluster(
    embedding: np.ndarray,
    within_scan_candidates: list[dict],
    new_cluster_id: str,
    threshold: float,
) -> dict:
    """Assign a cluster to *embedding*.

    Search strategy (two-stage):
    1. FAISS index  — fast O(log n) search across all historical faces.
    2. within_scan_candidates — tiny linear scan (≤ ~20 faces) covering faces
       already processed in the *current* photo that have not yet been flushed
       to the index.  This prevents two faces in the same upload from being
       incorrectly merged into one cluster before the index is updated.

    The FAISS result wins if it is the highest-scoring match above threshold.
    """
    # --- 1. FAISS cross-scan search ---
    faiss_result = face_index.search(embedding, k=1, threshold=threshold)

    # --- 2. Within-scan linear scan (current photo only) ---
    best_within: dict | None = None
    best_within_score = 0.0
    for candidate in within_scan_candidates:
        score = cosine_similarity(embedding, candidate["vector"])
        if score > best_within_score:
            best_within_score = score
            best_within = candidate

    # Choose the better of the two
    faiss_score = faiss_result["score"] if faiss_result else 0.0

    if faiss_result and faiss_score >= best_within_score and faiss_score >= threshold:
        return {
            "cluster_id": faiss_result["cluster_id"],
            "label": faiss_result["label"],
            "is_new_cluster": False,
            "best_similarity": round(faiss_score, 4),
            "threshold": threshold,
            "comparison_count": face_index.size + len(within_scan_candidates),
            "matched_user_id": faiss_result.get("user_id"),
            "matched_user_name": faiss_result.get("user_name"),
        }

    if best_within and best_within_score >= threshold:
        return {
            "cluster_id": best_within["cluster_id"],
            "label": best_within["label"],
            "is_new_cluster": False,
            "best_similarity": round(best_within_score, 4),
            "threshold": threshold,
            "comparison_count": face_index.size + len(within_scan_candidates),
            "matched_user_id": best_within.get("user_id"),
            "matched_user_name": best_within.get("user_name"),
        }

    return {
        "cluster_id": new_cluster_id,
        "label": f"New face cluster {new_cluster_id}",
        "is_new_cluster": True,
        "best_similarity": round(max(faiss_score, best_within_score), 4),
        "threshold": threshold,
        "comparison_count": face_index.size + len(within_scan_candidates),
        "matched_user_id": None,
        "matched_user_name": None,
    }


def _classify_lighting(face_crop: np.ndarray) -> str:
    if face_crop.size == 0:
        return "unknown"

    gray = np.mean(face_crop, axis=2) if face_crop.ndim == 3 else face_crop
    brightness = float(np.mean(gray))
    if brightness < 70:
        return "low light"
    if brightness > 190:
        return "very bright"
    return "balanced"


def _classify_camera_quality(face_crop: np.ndarray, bbox: list[int]) -> str:
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if face_crop.size == 0 or width < 80 or height < 80:
        return "low resolution"

    gray = np.mean(face_crop, axis=2).astype(np.uint8) if face_crop.ndim == 3 else face_crop
    sharpness = float(np.var(np.gradient(gray.astype(np.float32))[0]))
    if sharpness < 12:
        return "soft or blurry"
    return "usable"


def _classify_pose(landmarks: dict[str, dict[str, int]] | None) -> str:
    if not landmarks:
        return "unknown"

    left_eye = landmarks.get("left_eye")
    right_eye = landmarks.get("right_eye")
    nose = landmarks.get("nose")
    left_mouth = landmarks.get("left_mouth")
    right_mouth = landmarks.get("right_mouth")

    if not all([left_eye, right_eye, nose, left_mouth, right_mouth]):
        return "partially occluded or angled"

    face_center_x = (left_eye["x"] + right_eye["x"] + left_mouth["x"] + right_mouth["x"]) / 4
    eye_distance = max(abs(right_eye["x"] - left_eye["x"]), 1)
    nose_offset = abs(nose["x"] - face_center_x) / eye_distance
    eye_tilt = abs(left_eye["y"] - right_eye["y"]) / eye_distance

    if nose_offset > 0.35:
        return "side profile"
    if eye_tilt > 0.18:
        return "tilted"
    return "frontal"


def _classify_occlusion_risk(features: dict[str, bool], pose: str) -> str:
    missing_count = sum(1 for is_present in features.values() if not is_present)
    if missing_count >= 2 or pose == "partially occluded or angled":
        return "high"
    if missing_count == 1 or pose in {"side profile", "tilted"}:
        return "medium"
    return "low"


def scan_faces_in_photo(image: np.ndarray, db=None, cluster_prefix: str = "upload") -> list[dict]:
    detected_faces = embedder.app.get(image)
    results = []
    within_scan_candidates: list[dict] = []
    threshold = settings.SIMILARITY_THRESHOLD

    for face_index, face in enumerate(detected_faces, start=1):
        bbox = face.bbox.astype(int).tolist()
        landmarks = None

        if getattr(face, "kps", None) is not None and len(face.kps) >= len(LANDMARK_KEYS):
            landmarks = {
                key: _point_payload(point)
                for key, point in zip(LANDMARK_KEYS, face.kps)
            }

        has_eyes = bool(landmarks and landmarks.get("left_eye") and landmarks.get("right_eye"))
        has_mouth = bool(landmarks and landmarks.get("left_mouth") and landmarks.get("right_mouth"))
        has_nose = bool(landmarks and landmarks.get("nose"))
        has_face_shape = (bbox[2] - bbox[0]) > 0 and (bbox[3] - bbox[1]) > 0
        has_relative_positions = _has_relative_positions(landmarks) if landmarks else False
        embedding = face.embedding.astype(np.float32)
        x1, y1, x2, y2 = bbox
        h, w = image.shape[:2]
        face_crop = image[max(y1, 0):min(y2, h), max(x1, 0):min(x2, w)]
        features = {
            "eyes": has_eyes,
            "nose": has_nose,
            "mouth": has_mouth,
            "face_shape": has_face_shape,
            "relative_positions": has_relative_positions,
        }
        pose = _classify_pose(landmarks)
        cluster = _assign_cluster(
            embedding,
            within_scan_candidates,
            new_cluster_id=f"{cluster_prefix}-face-{face_index}",
            threshold=threshold,
        )

        results.append({
            "bbox": {"x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
            "confidence": float(getattr(face, "det_score", 0.0) or 0.0),
            "landmarks": landmarks,
            "features": features,
            "embedding_space": {
                "model_name": FACENET_STYLE_MODEL_NAME,
                "vector_dimensions": int(embedding.size),
                "vector_norm": float(np.linalg.norm(embedding)),
                "signature_preview": [round(float(value), 4) for value in embedding[:8]],
                "similarity_metric": "cosine_similarity",
                "same_person_rule": "Faces from the same person should have higher similarity and sit closer in embedding space.",
                "different_person_rule": "Faces from different people should have lower similarity and sit farther apart in embedding space.",
            },
            "cluster": cluster,
            "variation_handling": {
                "lighting": _classify_lighting(face_crop),
                "pose": pose,
                "camera_quality": _classify_camera_quality(face_crop, bbox),
                "occlusion_risk": _classify_occlusion_risk(features, pose),
                "supported_changes": [
                    "different lighting",
                    "glasses or sunglasses",
                    "beard or clean-shaven",
                    "aging",
                    "selfie angles",
                    "side profiles",
                    "different camera quality",
                ],
                "note": "Matching uses the embedding vector, so style changes like beard, glasses, age, and camera angle are compared by identity geometry instead of exact pixels.",
            },
            "embedding_vector": [float(value) for value in embedding],
        })
        # Track in the within-scan list so subsequent faces in this same photo
        # can find this assignment without reading the FAISS index (which is
        # only updated after the scan record is committed).
        within_scan_candidates.append({
            "vector": embedding,
            "cluster_id": cluster["cluster_id"],
            "label": cluster["label"],
            "user_id": cluster["matched_user_id"],
            "user_name": cluster["matched_user_name"],
        })

    return results
