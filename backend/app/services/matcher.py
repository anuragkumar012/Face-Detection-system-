import numpy as np
from typing import Tuple
from app.core.config import settings


class FaceMatcher:
    """Matches a face embedding against the ChromaDB vector index.

    Exposes methods for similarity comparison, finding best match, and verification.
    """

    def match(
        self,
        target_embedding: np.ndarray,
        threshold: float | None = None,
    ) -> Tuple[str, int | None, float]:
        """Return (name, user_id, confidence) for backward compatibility."""
        if threshold is None:
            threshold = settings.SIMILARITY_THRESHOLD

        res = self.find_best_match(target_embedding, threshold=threshold)
        if not res["matched"]:
            return "Unknown", None, 0.0

        return res["name"], res["user_id"], res["score"]

    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Compute the cosine similarity between two 1D vectors."""
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        if denom == 0.0:
            return 0.0
        return float(np.dot(a, b) / denom)

    def find_best_match(self, embedding: np.ndarray, threshold: float | None = None) -> dict:
        """Search the ChromaDB index to find the best matching identity."""
        from app.services.vector_index import search_embedding
        
        if threshold is None:
            threshold = settings.SIMILARITY_THRESHOLD

        res = search_embedding(embedding, threshold=threshold)
        if res is None:
            return {
                "matched": False,
                "user_id": -1,
                "name": "Unknown",
                "score": 0.0
            }

        return {
            "matched": True,
            "user_id": res.get("user_id", -1),
            "name": res.get("user_name") or res.get("label") or "Unknown",
            "score": float(res.get("score", 0.0))
        }

    def verify_match(self, embedding: np.ndarray, threshold: float | None = None) -> dict:
        """Verify the matching identity against the database embeddings."""
        if threshold is None:
            threshold = settings.SIMILARITY_THRESHOLD
        return self.find_best_match(embedding, threshold=threshold)

    def check_duplicate_enrollment(self, embedding: np.ndarray, threshold: float = 0.80) -> None:
        """Check if face is already enrolled. Raise FaceDetectionError if similarity exceeds threshold."""
        from app.core.exceptions import FaceDetectionError
        
        res = self.find_best_match(embedding, threshold=threshold)
        if res["matched"]:
            raise FaceDetectionError(f"Face already enrolled as {res['name']}")


matcher = FaceMatcher()
