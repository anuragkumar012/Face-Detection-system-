"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountRole } from "@/lib/auth";
import { fetchBackend } from "@/lib/backend";

export type LiveDetection = {
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  match: {
    user_id: number;
    name: string;
    confidence: number;
    image_url?: string | null;
  } | null;
};

type LiveCameraRecognitionProps = {
  backendStatus: "checking" | "online" | "offline";
  backendUrl: string;
  onDetectionsChange?: (detections: LiveDetection[]) => void;
  publisherRole?: AccountRole;
};

export function LiveCameraRecognition({
  backendStatus,
  backendUrl,
  onDetectionsChange,
  publisherRole,
}: LiveCameraRecognitionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionPollRef = useRef<number | null>(null);
  const previewPollRef = useRef<number | null>(null);
  const recognitionInFlightRef = useRef(false);
  const previewInFlightRef = useRef(false);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [detections, setDetections] = useState<LiveDetection[]>([]);

  const clearPublishedPreview = async () => {
    if (!backendUrl || !publisherRole) {
      return;
    }

    try {
      await fetchBackend(`${backendUrl}/api/v1/live-preview/${publisherRole}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error(error);
    }
  };

  const clearPolling = () => {
    if (recognitionPollRef.current !== null) {
      window.clearInterval(recognitionPollRef.current);
      recognitionPollRef.current = null;
    }

    if (previewPollRef.current !== null) {
      window.clearInterval(previewPollRef.current);
      previewPollRef.current = null;
    }
  };

  const stopStream = () => {
    clearPolling();
    recognitionInFlightRef.current = false;
    previewInFlightRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setDetections([]);
    onDetectionsChange?.([]);
    void clearPublishedPreview();
  };

  const captureCurrentFrame = async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );

    if (!blob) {
      return null;
    }

    return blob;
  };

  const publishLivePreview = async (blob?: Blob) => {
    if (!backendUrl || !publisherRole) {
      console.warn("[LiveCamera] publishLivePreview skipped: missing backendUrl or publisherRole", { backendUrl, publisherRole });
      return;
    }

    const frameBlob = blob ?? (await captureCurrentFrame());
    if (!frameBlob) {
      console.warn("[LiveCamera] publishLivePreview skipped: no frame captured");
      return;
    }

    console.log(`[LiveCamera] Uploading frame (${frameBlob.size} bytes) to /api/v1/live-preview`);

    const formData = new FormData();
    formData.append("source", publisherRole);
    formData.append("file", frameBlob, `${publisherRole}-preview.jpg`);

    const response = await fetchBackend(`${backendUrl}/api/v1/live-preview`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      console.error("[LiveCamera] Live preview upload failed:", response.status, response.statusText);
      throw new Error("Live preview upload failed");
    }

    // Parse the detection results embedded in the preview response.
    const data = await response.json();
    console.log("[LiveCamera] Preview response detections:", data.detections?.length ?? "null", data.detections);
    if (data.detections && Array.isArray(data.detections)) {
      const mapped: LiveDetection[] = data.detections;
      setDetections(mapped);
      onDetectionsChange?.(mapped);
    } else {
      setDetections([]);
      onDetectionsChange?.([]);
    }
  };


  const publishPreviewFrame = async () => {
    if (!backendUrl || backendStatus !== "online" || !publisherRole || previewInFlightRef.current) {
      console.log("[LiveCamera] publishPreviewFrame skipped:", { backendUrl: !!backendUrl, backendStatus, publisherRole, inFlight: previewInFlightRef.current });
      return;
    }

    previewInFlightRef.current = true;
    try {
      await publishLivePreview();
    } catch (err) {
      console.error("[LiveCamera] publishPreviewFrame error:", err);
    } finally {
      previewInFlightRef.current = false;
    }
  };



  const recognizeFrame = async () => {
    if (!backendUrl || backendStatus !== "online" || recognitionInFlightRef.current) {
      return;
    }

    const blob = await captureCurrentFrame();
    if (!blob) {
      return;
    }

    recognitionInFlightRef.current = true;
    try {
      const formData = new FormData();
      formData.append("file", blob, "frame.jpg");

      const response = await fetchBackend(`${backendUrl}/api/v1/recognize-live`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Live recognition request failed");
      }

      const data: LiveDetection[] = await response.json();
      setDetections(data);
      onDetectionsChange?.(data);
    } catch (error) {
      console.error(error);
      setStreamError("Recognition is running, but the backend could not analyze the current frame.");
    } finally {
      recognitionInFlightRef.current = false;
    }
  };

  const startStream = async () => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setStreamError("Browser camera access usually requires HTTPS or localhost. Open this page securely or allow camera access for this origin.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStreamError("This browser does not support direct webcam access.");
      return;
    }

    try {
      setStreamError("");
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      const video = videoRef.current;
      if (!video) {
        throw new Error("Video preview element is not available.");
      }

      video.srcObject = mediaStream;
      await video.play();
      setIsStreaming(true);
      clearPolling();

      // Always publish preview frames (server handles recognition for user role).
      previewPollRef.current = window.setInterval(() => {
        void publishPreviewFrame();
      }, 800);

      // Only run the separate client-side recognition loop when NOT publishing
      // to the server (i.e., no publisherRole). When publisherRole is set,
      // the server runs InsightFace on each preview frame and returns detections
      // in the response, which publishLivePreview already parses above.
      if (!publisherRole) {
        recognitionPollRef.current = window.setInterval(() => {
          void recognizeFrame();
        }, 1200);
        void recognizeFrame();
      }

      void publishPreviewFrame();

    } catch (error) {
      console.error(error);
      stopStream();
      setStreamError("Could not access the laptop camera. Allow camera permission in the browser and try again.");
    }
  };

  useEffect(() => {
    const currentVideo = videoRef.current;
    return () => {
      clearPolling();
      recognitionInFlightRef.current = false;
      previewInFlightRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void clearPublishedPreview();
      if (currentVideo) {
        currentVideo.srcObject = null;
      }
    };
  }, [backendUrl, publisherRole]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    if (!isStreaming || !video || video.videoWidth === 0 || video.videoHeight === 0) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.clearRect(0, 0, canvas.width, canvas.height);

    detections.forEach((detection) => {
      const { x1, y1, x2, y2 } = detection.bbox;
      const color = detection.match?.name && detection.match.name !== "Unknown" ? "#22c55e" : "#ef4444";
      context.strokeStyle = color;
      context.lineWidth = 3;
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const label = detection.match?.name && detection.match.name !== "Unknown"
        ? `${detection.match.name} (${(detection.match.confidence * 100).toFixed(1)}%)`
        : "Unknown";

      context.font = "bold 20px Segoe UI";
      const textWidth = context.measureText(label).width;
      const textX = x1;
      const textY = Math.max(26, y1 - 10);
      context.fillStyle = color;
      context.fillRect(textX, textY - 22, textWidth + 16, 28);
      context.fillStyle = "#ffffff";
      context.fillText(label, textX + 8, textY - 2);
    });
  }, [detections, isStreaming]);

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] text-slate-900">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold">Laptop Camera Preview</h3>
          <p className="mt-1 text-sm text-slate-500">
            This preview uses the browser camera on the device that opens the page, then sends frames to the backend for recognition.
          </p>
        </div>
        <button
          onClick={isStreaming ? stopStream : () => void startStream()}
          disabled={backendStatus !== "online" || !backendUrl}
          className={`rounded-full px-5 py-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            isStreaming ? "bg-red-500 hover:bg-red-600" : "bg-slate-900 hover:bg-slate-700"
          }`}
        >
          {isStreaming ? "Stop Camera" : "Start Camera"}
        </button>
      </div>

      {streamError && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {streamError}
        </div>
      )}

      <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`h-auto max-h-[640px] w-full object-contain ${isStreaming ? "block" : "invisible h-64"}`}
        />
        <canvas
          ref={overlayCanvasRef}
          className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${
            isStreaming ? "block" : "hidden"
          }`}
        />

        {!isStreaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 bg-slate-50 text-center">
            <p className="text-lg font-semibold text-slate-700">Camera Ready</p>
            <p className="max-w-md text-sm text-slate-500">
              Start the camera to use the webcam from this laptop or browser device for live recognition.
            </p>
          </div>
        )}
      </div>

      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
}
