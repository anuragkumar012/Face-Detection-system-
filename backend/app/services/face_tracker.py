import numpy as np
import time

class FaceTracker:
    
    def __init__(self, max_disappeared=5, distance_threshold=120.0):
        self.next_track_id = 101 
        self.objects = {}        
        self.disappeared = {}    
        self.bboxes = {}         
        self.max_disappeared = max_disappeared
        self.distance_threshold = distance_threshold

    def register(self, centroid, bbox):
        track_id = self.next_track_id
        self.objects[track_id] = centroid
        self.bboxes[track_id] = bbox
        self.disappeared[track_id] = 0
        self.next_track_id += 1
        return track_id

    def deregister(self, track_id):
        if track_id in self.objects:
            del self.objects[track_id]
        if track_id in self.bboxes:
            del self.bboxes[track_id]
        if track_id in self.disappeared:
            del self.disappeared[track_id]

    def update(self, rects) -> list[tuple[int, list[int]]]:
        if len(rects) == 0:
            for track_id in list(self.disappeared.keys()):
                self.disappeared[track_id] += 1
                if self.disappeared[track_id] > self.max_disappeared:
                    self.deregister(track_id)
            return [(tid, self.bboxes[tid]) for tid in self.objects.keys()]

        input_centroids = np.zeros((len(rects), 2), dtype="int")
        for i, (x1, y1, x2, y2) in enumerate(rects):
            cX = int((x1 + x2) / 2.0)
            cY = int((y1 + y2) / 2.0)
            input_centroids[i] = (cX, cY)

        if len(self.objects) == 0:
            for i in range(len(input_centroids)):
                self.register(input_centroids[i], rects[i])
        else:
            track_ids = list(self.objects.keys())
            object_centroids = list(self.objects.values())
            D = np.linalg.norm(np.array(object_centroids)[:, np.newaxis] - input_centroids, axis=2)
            rows = D.min(axis=1).argsort()
            cols = D.argmin(axis=1)

            used_rows = set()
            used_cols = set()

            for row, col in zip(rows, cols):
                if row in used_rows or col in used_cols:
                    continue
                if D[row, col] > self.distance_threshold:
                    continue

                track_id = track_ids[row]
                self.objects[track_id] = input_centroids[col]
                self.bboxes[track_id] = rects[col]
                self.disappeared[track_id] = 0

                used_rows.add(row)
                used_cols.add(col)

            unused_rows = set(range(D.shape[0])).difference(used_rows)
            unused_cols = set(range(D.shape[1])).difference(used_cols)

            for row in unused_rows:
                track_id = track_ids[row]
                self.disappeared[track_id] += 1
                if self.disappeared[track_id] > self.max_disappeared:
                    self.deregister(track_id)

            for col in unused_cols:
                self.register(input_centroids[col], rects[col])

        return [(tid, self.bboxes[tid]) for tid in self.objects.keys() if self.disappeared[tid] == 0]

tracker = FaceTracker()
