import numpy as np
from sqlalchemy.orm import Session
from app.services.matcher import matcher
from app.services.face_embedder import embedder


def recognize_faces_in_image(image: np.ndarray, db: Session | None = None, realtime: bool = False) -> list[dict]:
    faces = embedder.get_embeddings(image, realtime=realtime)
    
    results = []
    tracks_data = []
    
    for fi, face in enumerate(faces):
        bbox = face.bbox.astype(int).tolist()
        embedding = face.embedding
        match_res = matcher.verify_match(embedding) # Search ChromaDB and verify similarity using the matching engine
        user_id = match_res["user_id"]
        name = match_res["name"]
        conf = match_res["score"]
        
        results.append({
            "bbox": {"x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
            "match": {
                "user_id": user_id,
                "name": name,
                "confidence": conf
            }
        })
        
        # Map to track data for presence tracker
        track_id = 999000 + fi
        tracks_data.append({
            "track_id": track_id,
            "bbox": bbox,
            "user_id": user_id if user_id != -1 else None,
            "name": name,
            "confidence": conf,
            "person_type": "known" if name != "Unknown" else "unknown"
        })
        
        # Cache recognition and embedding for presence tracking
        from app.services.presence_tracker import presence_tracker
        presence_tracker.cache_recognition(track_id, name, user_id if user_id != -1 else None, conf, embedding)

    if db is not None:
        from app.services.presence_tracker import presence_tracker
        from app.api.websocket_gateway import gateway
        presence_tracker.process_frame(db, tracks_data, image, broadcast_callback=gateway.broadcast_sync)

    return results
