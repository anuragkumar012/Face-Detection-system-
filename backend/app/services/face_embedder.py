import numpy as np
from insightface.app import FaceAnalysis


class FaceEmbeddingResult(dict):
    @property
    def embedding(self) -> np.ndarray:
        return self["embedding"]

    @property
    def bbox(self) -> np.ndarray:
        return self["bbox"]

    @property
    def det_score(self) -> float:
        return self["det_score"]

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


class FaceEmbedder:

    def __init__(self):
        self.app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(640, 640))
        self.fast_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        self.fast_app.prepare(ctx_id=0, det_size=(320, 320))

    def detect_faces(self, image: np.ndarray) -> list[np.ndarray]:
        faces = self.fast_app.get(image)
        return [face.bbox.astype(np.int32) for face in faces]

    def normalize_embedding(self, embedding: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(embedding)
        if norm == 0.0:
            return embedding
        return (embedding / norm).astype(np.float32)

    def create_embedding(self, face_obj) -> FaceEmbeddingResult:
        raw_emb = face_obj.embedding.astype(np.float32)
        norm_emb = self.normalize_embedding(raw_emb)
        bbox = face_obj.bbox.astype(np.int32)
        det_score = float(getattr(face_obj, "det_score", 0.0))
        return FaceEmbeddingResult(
            embedding=norm_emb,
            bbox=bbox,
            det_score=det_score
        )

    def _extract_embedding_from_crop(self, face_crop: np.ndarray) -> np.ndarray | None:
        faces = self.app.get(face_crop)
        if not faces:
            return None
        best_face = max(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        )
        return self.normalize_embedding(best_face.embedding.astype(np.float32))

    def _extract_embedding_and_quality_from_crop(self, face_crop: np.ndarray):
        faces = self.app.get(face_crop)
        if not faces:
            return None, None
        best_face = max(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        )
        return self.normalize_embedding(best_face.embedding.astype(np.float32)), best_face

    def get_embeddings(
        self, image: np.ndarray, realtime: bool = False
    ) -> list[FaceEmbeddingResult]:
        if not realtime:
            detected = self.app.get(image)
            return [self.create_embedding(face) for face in detected]

        h, w = image.shape[:2]
        results: list[FaceEmbeddingResult] = []
        faces = self.fast_app.get(image)
        for face in faces:
            bbox = face.bbox.astype(np.int32)
            det_score = float(getattr(face, "det_score", 0.0))
            x1, y1, x2, y2 = bbox.tolist()
            pad_x = max(int((x2 - x1) * 0.50), 10)
            pad_y = max(int((y2 - y1) * 0.50), 10)
            crop = image[
                max(y1 - pad_y, 0) : min(y2 + pad_y, h),
                max(x1 - pad_x, 0) : min(x2 + pad_x, w),
            ]
            if crop.size == 0:
                continue
            emb = self._extract_embedding_from_crop(crop)
            if emb is None:
                continue
            results.append(
                FaceEmbeddingResult(
                    embedding=emb,
                    bbox=bbox,
                    det_score=det_score
                )
            )
        return results


embedder = FaceEmbedder()
