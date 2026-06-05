import logging
import threading
import uuid
import numpy as np
import chromadb
from app.core.config import settings
from __future__ import annotations

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 512   # ArcFace buffalo_l fixed output dimension, it has high accuracy in biometrics


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0.0:
        return 0.0
    return float(np.dot(a, b) / denom)


def euclidean_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a.astype(np.float32) - b.astype(np.float32)))


def _serialize_metadata(meta: dict) -> dict:
    clean_meta = {}
    for k, v in meta.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            clean_meta[k] = v
        else:
            clean_meta[k] = str(v)
    return clean_meta


class ChromaIndex:

    def __init__(self, path: str = "chroma_db", collection_name: str = "enrolled_faces") -> None:
        self.path = path
        self.collection_name = collection_name
        self.client = chromadb.PersistentClient(path=self.path)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        self._lock = threading.Lock()

    @property
    def size(self) -> int:
        with self._lock:
            return self.collection.count()

    def add(self, embedding: np.ndarray, metadata: dict) -> None:
        raw = embedding.astype(np.float32)
        flat_emb = raw.flatten()
        
        if "user_id" in metadata and metadata["user_id"] is not None:
            uid = f"user-emb-{metadata['user_id']}-{uuid.uuid4().hex[:8]}"
        elif "cluster_id" in metadata:
            uid = f"cluster-{metadata['cluster_id']}-{uuid.uuid4().hex[:8]}"
        else:
            uid = f"emb-{uuid.uuid4().hex}"

        clean_meta = _serialize_metadata(metadata)
        with self._lock:
            self.collection.add(
                ids=[uid],
                embeddings=[flat_emb.tolist()],
                metadatas=[clean_meta]
            )

    def search(
        self,
        embedding: np.ndarray,
        k: int = 1,
        threshold: float | None = None,
    ) -> dict | None:
        if self.size == 0:
            return None

        if threshold is None:
            threshold = settings.SIMILARITY_THRESHOLD

        flat_emb = embedding.astype(np.float32).flatten()
        with self._lock:
            results = self.collection.query(
                query_embeddings=[flat_emb.tolist()],
                n_results=k
            )

        if not results or not results["ids"] or len(results["ids"][0]) == 0:
            return None

        best_dist = float(results["distances"][0][0])
        best_meta = results["metadatas"][0][0]
        
        # similarity = 1.0 - distance
        similarity = 1.0 - best_dist
        if similarity < threshold:
            return None

        result = dict(best_meta)
        result["score"] = similarity
        if "user_id" in result and result["user_id"] is not None:
            result["user_id"] = int(result["user_id"])
        
        # compatibility for FAISS outputs
        if "user_name" not in result and "label" in result:
            result["user_name"] = result["label"]
        return result

    def remove_by_cluster_id(self, cluster_id: str) -> int:
        with self._lock:
            res = self.collection.get(where={"cluster_id": cluster_id})
            count = len(res["ids"]) if res and "ids" in res else 0
            if count > 0:
                self.collection.delete(where={"cluster_id": cluster_id})
        return count

    def remove_by_user_id(self, user_id: int) -> int:
        with self._lock:
            res = self.collection.get(where={"user_id": user_id})
            count = len(res["ids"]) if res and "ids" in res else 0
            if count > 0:
                self.collection.delete(where={"user_id": user_id})
        return count

    def update_cluster_id(
        self, old_cluster_id: str, new_cluster_id: str, new_label: str
    ) -> int:
        with self._lock:
            res = self.collection.get(where={"cluster_id": old_cluster_id})
            if not res or not res["ids"]:
                return 0
            ids = res["ids"]
            metadatas = []
            for meta in res["metadatas"]:
                new_meta = dict(meta)
                new_meta["cluster_id"] = new_cluster_id
                new_meta["label"] = new_label
                metadatas.append(_serialize_metadata(new_meta))
            self.collection.update(ids=ids, metadatas=metadatas)
        return len(ids)

    def rebuild_from_db(self, db) -> None:
        from app.models.face_embedding import FaceEmbedding
        from app.models.photo_scan import PhotoScan
        from app.models.user import User

        ids: list[str] = []
        raws: list[list[float]] = []
        meta: list[dict] = []

        # Registered user embeddings
        records = (
            db.query(FaceEmbedding, User)
            .join(User, FaceEmbedding.user_id == User.id)
            .all()
        )
        for emb_rec, user in records:
            vec = np.frombuffer(emb_rec.embedding, dtype=np.float32).copy()
            if vec.size != EMBEDDING_DIM:
                continue
            ids.append(f"user-emb-{emb_rec.id}")
            raws.append(vec.tolist())
            meta.append(_serialize_metadata({
                "cluster_id": f"user-{user.id}",
                "label": user.name,
                "user_id": user.id,
                "user_name": user.name,
                "photo_scan_id": emb_rec.photo_scan_id,
                "angle": emb_rec.angle or "front",
            }))

        # Unregistered cluster embeddings from scan history
        scans = (
            db.query(PhotoScan)
            .order_by(PhotoScan.created_at.desc())
            .limit(200)
            .all()
        )
        for scan in scans:
            if not scan.scan_details:
                continue
            for fi, face in enumerate(scan.scan_details.get("faces", []), start=1):
                ev = face.get("embedding_vector")
                if not ev:
                    continue
                vec = np.array(ev, dtype=np.float32)
                if vec.size != EMBEDDING_DIM:
                    continue
                cluster = face.get("cluster") or {}
                cid = cluster.get("cluster_id") or f"photo-scan-{scan.id}-face-{fi}"
                ids.append(f"scan-{scan.id}-face-{fi}")
                raws.append(vec.tolist())
                meta.append(_serialize_metadata({
                    "cluster_id": cid,
                    "label": cluster.get("label") or f"Cluster {cid}",
                    "user_id": cluster.get("matched_user_id"),
                    "user_name": cluster.get("matched_user_name"),
                    "photo_scan_id": scan.id,
                }))

        # Recreate the collection to clear all data
        with self._lock:
            try:
                self.client.delete_collection(self.collection_name)
            except Exception:
                pass
            self.collection = self.client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"}
            )
            
            if ids:
                # Add in chunks to avoid any single payload size limits
                chunk_size = 500
                for i in range(0, len(ids), chunk_size):
                    self.collection.add(
                        ids=ids[i : i + chunk_size],
                        embeddings=raws[i : i + chunk_size],
                        metadatas=meta[i : i + chunk_size]
                    )

        logger.info("[ChromaIndex] Rebuilt collection from DB with %d vectors.", len(ids))

face_index = ChromaIndex() # Reusable Service methods for ChromaDB operations

def add_embedding(
    user_id: int,
    name: str,
    photo_scan_id: int | None,
    embedding: np.ndarray,
    angle: str | None = None,
) -> None:
    metadata = {
        "user_id": user_id,
        "name": name,
        "user_name": name,
        "label": name,
        "cluster_id": f"user-{user_id}",
        "photo_scan_id": photo_scan_id,
        "angle": angle or "front",
    }
    face_index.add(embedding, metadata)


def update_embedding(
    user_id: int,
    name: str,
    photo_scan_id: int | None,
    embedding: np.ndarray,
    angle: str | None = None,
) -> None:
    face_index.remove_by_user_id(user_id)
    add_embedding(user_id, name, photo_scan_id, embedding, angle)


def delete_embedding(user_id: int) -> None:
    face_index.remove_by_user_id(user_id)


def search_embedding(embedding: np.ndarray, threshold: float | None = None) -> dict | None:
    return face_index.search(embedding, k=1, threshold=threshold)


def rebuild_index(db) -> None:
    face_index.rebuild_from_db(db)
