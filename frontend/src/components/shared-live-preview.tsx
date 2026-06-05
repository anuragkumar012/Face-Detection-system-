"use client";

import { useEffect, useState } from "react";
import type { AccountRole } from "@/lib/auth";
import { fetchBackend } from "@/lib/backend";

import type { LiveDetection } from "@/components/live-camera-recognition";

export type LivePreviewFrame = {
  source: AccountRole;
  frame_data_url: string | null;
  updated_at: string | null;
  is_live: boolean;
  detections?: LiveDetection[] | null;
};

type SharedLivePreviewProps = {
  backendUrl: string;
  sourceRole: AccountRole;
  title: string;
  description: string;
  emptyMessage: string;
  onPreviewData?: (data: LivePreviewFrame | null) => void;
};

export function SharedLivePreview({
  backendUrl,
  sourceRole,
  title,
  description,
  emptyMessage,
  onPreviewData,
}: SharedLivePreviewProps) {
  const [preview, setPreview] = useState<LivePreviewFrame | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");

  useEffect(() => {
    if (!backendUrl) {
      setPreview(null);
      setStatus("offline");
      onPreviewData?.(null);
      return;
    }

    let isMounted = true;

    const loadPreview = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/live-preview/${sourceRole}`, {
          signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
          if (!isMounted) {
            return;
          }

          setPreview(null);
          setStatus("offline");
          onPreviewData?.(null);
          return;
        }

        const data: LivePreviewFrame = await response.json();
        if (!isMounted) {
          return;
        }

        setPreview(data);
        setStatus(data.is_live && data.frame_data_url ? "live" : "offline");
        onPreviewData?.(data);
      } catch {
        if (!isMounted) {
          return;
        }

        setPreview(null);
        setStatus("offline");
        onPreviewData?.(null);
      }
    };

    void loadPreview();
    const interval = window.setInterval(() => {
      void loadPreview();
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [backendUrl, sourceRole]);

  const updatedAtLabel = preview?.updated_at
    ? new Date(preview.updated_at).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      })
    : null;

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] text-slate-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
            status === "live"
              ? "bg-green-100 text-green-800"
              : status === "loading"
              ? "bg-yellow-100 text-yellow-800"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {status === "live" ? "Live" : status === "loading" ? "Checking" : "Waiting"}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-[1.75rem] border border-slate-200 bg-black">
        {preview?.is_live && preview.frame_data_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.frame_data_url}
            alt={`${sourceRole} live preview`}
            className="h-auto max-h-[640px] w-full object-contain"
          />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 bg-slate-50 px-6 text-center">
            <p className="text-lg font-semibold text-slate-700">{emptyMessage}</p>
            <p className="max-w-md text-sm text-slate-500">
              The preview appears here automatically as soon as the {sourceRole} camera is started.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        {updatedAtLabel ? `Last frame received at ${updatedAtLabel}` : "No live frame received yet."}
      </p>
    </div>
  );
}
