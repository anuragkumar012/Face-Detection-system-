"use client";

import { useEffect, useState } from "react";
import { buildBackendHeaders } from "@/lib/backend";

interface BackendImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: React.ReactNode;
}

export function BackendImage({ src, fallback, alt, ...props }: BackendImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!src) {
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();

    const fetchImage = async () => {
      try {
        setLoading(true);
        setError(false);

        const response = await fetch(src, {
          headers: buildBackendHeaders(),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const blob = await response.blob();
        if (active) {
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
          setLoading(false);
        }
      } catch (err: any) {
        if (active && err.name !== "AbortError") {
          console.warn("BackendImage fetch error:", err.message || err);
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchImage();

    return () => {
      active = false;
      controller.abort();
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [src]);

  if (loading) {
    return (
      <div className={`${props.className} flex items-center justify-center bg-slate-100 animate-pulse`}>
        <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <>
        {fallback || (
          <div className={`${props.className} flex items-center justify-center bg-slate-200 text-slate-400`}>
            <span className="text-[10px]">Error</span>
          </div>
        )}
      </>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={blobUrl} alt={alt} {...props} />
  );
}
