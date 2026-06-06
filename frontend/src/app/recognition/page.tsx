"use client";

import { FormEvent, useEffect, useState } from "react";
import { LiveCameraRecognition } from "@/components/live-camera-recognition";
import { BackendImage } from "@/components/backend-image";


import { fetchBackend, useBackendUrl } from "@/lib/backend";

type PhotoScanFace = {
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
  features: {
    eyes: boolean;
    nose: boolean;
    mouth: boolean;
    face_shape: boolean;
    relative_positions: boolean;
  };
  embedding_space: {
    model_name: string;
    vector_dimensions: number;
    vector_norm: number;
    signature_preview: number[];
    similarity_metric: string;
    same_person_rule: string;
    different_person_rule: string;
  };
  cluster: {
    cluster_id: string;
    label: string;
    is_new_cluster: boolean;
    best_similarity: number;
    threshold: number;
    comparison_count: number;
    matched_user_id: number | null;
    matched_user_name: string | null;
  };
  variation_handling: {
    lighting: string;
    pose: string;
    camera_quality: string;
    occlusion_risk: string;
    supported_changes: string[];
    note: string;
  };
};

type PhotoScan = {
  id: number;
  image_url: string;
  original_filename: string | null;
  source: string;
  face_count: number;
  faces: PhotoScanFace[];
  created_at: string;
};

export default function RecognitionPage() {
  const backendUrl = useBackendUrl();
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [photoScans, setPhotoScans] = useState<PhotoScan[]>([]);
  const [scanStatus, setScanStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    if (!backendUrl) {
      return;
    }

    const checkBackend = async () => {
      try {
        const res = await fetchBackend(`${backendUrl}/`, {
          signal: AbortSignal.timeout(3000),
        });
        setBackendStatus(res.ok ? "online" : "offline");
      } catch {
        setBackendStatus("offline");
      }
    };

    void checkBackend();
    const interval = setInterval(checkBackend, 5000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    const loadRecentScans = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/photo-scans?limit=6`);
        if (!response.ok) {
          throw new Error("Failed to load photo scans");
        }
        const data: { scans: PhotoScan[] } = await response.json();
        setPhotoScans(data.scans);
      } catch (error) {
        console.error(error);
      }
    };

    void loadRecentScans();
  }, [backendUrl, backendStatus]);

  const handlePhotoScan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!backendUrl || selectedFiles.length === 0 || backendStatus !== "online") {
      return;
    }

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    formData.append("source", "frontend");

    setScanStatus("uploading");
    setScanError("");

    try {
      const response = await fetchBackend(`${backendUrl}/api/v1/photo-scans`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.detail || "Could not scan uploaded photos");
      }

      const data: { scans: PhotoScan[] } = await response.json();
      setPhotoScans((current) => [...data.scans, ...current].slice(0, 6));
      setSelectedFiles([]);
      event.currentTarget.reset();
      setScanStatus("idle");
    } catch (error) {
      setScanStatus("error");
      setScanError(error instanceof Error ? error.message : "Could not scan uploaded photos");
    }
  };

  const featureLabels: Array<[keyof PhotoScanFace["features"], string]> = [
    ["eyes", "Eyes"],
    ["nose", "Nose"],
    ["mouth", "Mouth"],
    ["face_shape", "Face shape"],
    ["relative_positions", "Relative positions"],
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-amber-100 bg-white/90 p-5 sm:p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-600">
          Recognition
        </p>
        <h2 className="mt-1.5 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
          Laptop Camera Live Recognition
        </h2>
        <p className="mt-2 max-w-3xl text-sm sm:text-base text-slate-600">
          The live preview uses the camera from the laptop or browser device that opens this
          page, and shares that preview to the admin page in realtime.
        </p>
      </div>

      <div
        className={`flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
          backendStatus === "online"
            ? "bg-green-100 text-green-800"
            : backendStatus === "offline"
            ? "bg-red-100 text-red-800"
            : "bg-yellow-100 text-yellow-800"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            backendStatus === "online"
              ? "bg-green-500"
              : backendStatus === "offline"
              ? "bg-red-500"
              : "bg-yellow-500"
          }`}
        />
        {!backendUrl
          ? "Set NEXT_PUBLIC_BACKEND_URL to your backend ngrok URL."
          : backendStatus === "checking"
          ? "Checking backend..."
          : backendStatus === "online"
          ? `Backend Online - ${backendUrl || "resolving..."}`
          : `Backend Offline - start Python server at ${backendUrl || "the server host"}`}
      </div>

      <section className="grid grid-cols-1 gap-6">
        <div className="rounded-[2rem] border border-slate-200 bg-white/95 p-5 sm:p-6 shadow-lg">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                Photo face detection
              </p>
              <h3 className="mt-2 text-2xl font-black text-slate-900">
                Scan Uploaded Photos First
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Each image is checked for face boundaries, eyes, nose, mouth, face shape, and landmark positions before results are saved.
              </p>
            </div>

            <form onSubmit={handlePhotoScan} className="flex flex-col gap-3 sm:flex-row sm:items-center w-full lg:w-auto">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
                className="w-full lg:max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
              />
              <button
                type="submit"
                disabled={backendStatus !== "online" || selectedFiles.length === 0 || scanStatus === "uploading"}
                className="w-full sm:w-auto rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 shrink-0 text-center"
              >
                {scanStatus === "uploading" ? "Scanning..." : "Scan Photos"}
              </button>
            </form>
          </div>

          {scanStatus === "error" && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {scanError}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {photoScans.length > 0 ? (
              photoScans.map((scan) => (
                <article key={scan.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                    <BackendImage
                      src={scan.image_url}
                      alt={scan.original_filename || "Uploaded photo"}
                      className="h-40 w-full rounded-xl border border-slate-200 object-cover sm:w-40"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-lg font-black text-slate-900">
                          {scan.original_filename || `Scan ${scan.id}`}
                        </p>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                          {scan.face_count} face{scan.face_count === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div className="mt-3 space-y-3">
                        {scan.faces.length > 0 ? (
                          scan.faces.map((face, index) => (
                            <div key={`${scan.id}-${index}`} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                                Face {index + 1} · {(face.confidence * 100).toFixed(1)}%
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Box: {face.bbox.x1}, {face.bbox.y1}, {face.bbox.x2}, {face.bbox.y2}
                              </p>
                              <p className="mt-2 text-xs font-semibold text-slate-600">
                                FaceNet-style vector: {face.embedding_space.vector_dimensions}D · {face.embedding_space.similarity_metric.replace("_", " ")}
                              </p>
                              <p className="mt-1 break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
                                [{face.embedding_space.signature_preview.join(", ")}, ...]
                              </p>
                              <div className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white">
                                <p className="font-bold">
                                  {face.cluster.is_new_cluster ? "New cluster" : "Matched cluster"}: {face.cluster.label}
                                </p>
                                <p className="mt-1 text-slate-300">
                                  Compared with {face.cluster.comparison_count} vector{face.cluster.comparison_count === 1 ? "" : "s"}.
                                  Best similarity {(face.cluster.best_similarity * 100).toFixed(1)}%
                                  {" "}against threshold {(face.cluster.threshold * 100).toFixed(0)}%.
                                </p>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                Same-person faces end up in the same cluster; different people stay farther apart.
                              </p>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                {[
                                  ["Lighting", face.variation_handling.lighting],
                                  ["Pose", face.variation_handling.pose],
                                  ["Quality", face.variation_handling.camera_quality],
                                  ["Occlusion", face.variation_handling.occlusion_risk],
                                ].map(([label, value]) => (
                                  <div key={label} className="rounded-lg bg-slate-50 px-2 py-1.5 ring-1 ring-slate-200">
                                    <p className="font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
                                    <p className="mt-0.5 font-semibold capitalize text-slate-700">{value}</p>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {["Clean-shaven", "Beard", "Sunglasses", "Selfie"].map((label) => (
                                  <span key={label} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">
                                    {label}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {featureLabels.map(([key, label]) => (
                                  <span
                                    key={key}
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                                      face.features[key]
                                        ? "bg-emerald-100 text-emerald-700"
                                        : "bg-slate-100 text-slate-400"
                                    }`}
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">
                            No human faces detected in this image.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500 lg:col-span-2">
                Upload photos to start recording face detection scans in the database.
              </div>
            )}
          </div>
        </div>

        <LiveCameraRecognition
          backendStatus={backendStatus}
          backendUrl={backendUrl}
          publisherRole="user"
        />


      </section>
    </div>
  );
}
