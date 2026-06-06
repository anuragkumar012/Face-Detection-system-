"use client";

import { useEffect, useState, useRef } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";

type Device = {
  device_id: string;
  hostname: string;
  username: string;
  os: string;
  agent_version: string;
  status: "online" | "offline";
  last_seen: string;
  current_frame: string | null;
  recognized_person: string | null;
};

export default function AdminPage() {
  const backendUrl = useBackendUrl();
  const [devices, setDevices] = useState<Device[]>([]);
  const deviceStatusesRef = useRef<Record<string, "online" | "offline">>({});
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "success" | "error" | "info" }[]>([]);

  const showToast = (message: string, type: "success" | "error" | "info") => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Check backend status
  useEffect(() => {
    if (!backendUrl) {
      return;
    }

    const checkBackend = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/`, {
          signal: AbortSignal.timeout(3000),
        });
        setBackendStatus(response.ok ? "online" : "offline");
      } catch {
        setBackendStatus("offline");
      }
    };

    void checkBackend();
    const interval = setInterval(checkBackend, 5000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  // Fetch devices list
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    const fetchDevices = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/device/status`);
        if (!response.ok) {
          throw new Error("Failed to load devices");
        }
        const data: Device[] = await response.json();
        setDevices(data);
        data.forEach((d) => {
          deviceStatusesRef.current[d.device_id] = d.status;
        });
      } catch (error) {
        console.error("Error fetching devices:", error);
      }
    };

    void fetchDevices();
    const deviceInterval = setInterval(fetchDevices, 5000);
    return () => clearInterval(deviceInterval);
  }, [backendUrl, backendStatus]);

  // Connect to backend WebSocket for real-time updates
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    const wsProtocol = backendUrl.startsWith("https") ? "wss" : "ws";
    const wsUrl = `${backendUrl.replace(/^https?:\/\//, `${wsProtocol}://`)}/ws`;

    console.log("[WebSocket] Connecting to", wsUrl);
    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connectWS = () => {
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("[WebSocket] Connected successfully");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "device_update") {
            const isOnline = message.status === "online";
            const prevStatus = deviceStatusesRef.current[message.device_id];

            if (message.status && prevStatus !== undefined && message.status !== prevStatus) {
              showToast(`Agent "${message.device_id}" is now ${message.status.toUpperCase()}`, isOnline ? "success" : "error");
            }
            if (message.status) {
              deviceStatusesRef.current[message.device_id] = message.status;
            }

            setDevices((prev) => {
              const idx = prev.findIndex((d) => d.device_id === message.device_id);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  status: message.status !== undefined ? message.status : updated[idx].status,
                  last_seen: message.last_seen || updated[idx].last_seen || new Date().toISOString(),
                  current_frame: message.current_frame !== undefined ? message.current_frame : updated[idx].current_frame,
                  recognized_person: message.recognized_person !== undefined ? message.recognized_person : updated[idx].recognized_person,
                };
                return updated;
              }
              return prev;
            });
          }
        } catch (err) {
          console.error("[WebSocket] Error handling message:", err);
        }
      };

      socket.onerror = (err) => {
        console.error("[WebSocket] Error:", err);
      };

      socket.onclose = () => {
        console.log("[WebSocket] Connection closed. Reconnecting in 3s...");
        reconnectTimeout = setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    return () => {
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [backendUrl, backendStatus]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ── TOAST NOTIFICATIONS ── */}
      <div className="fixed top-6 right-6 z-50 space-y-3 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full items-center gap-3 rounded-2xl p-4 shadow-xl border transition-all transform translate-y-0 duration-300 ${toast.type === "success"
              ? "bg-green-50 border-green-200 text-green-800"
              : toast.type === "error"
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-blue-50 border-blue-200 text-blue-800"
              }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toast.type === "success"
              ? "bg-green-200 text-green-800"
              : toast.type === "error"
                ? "bg-red-200 text-red-800"
                : "bg-blue-200 text-blue-800"
              }`}>
              {toast.type === "success" && (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {toast.type === "error" && (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {toast.type === "info" && (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </span>
            <div className="flex-1 text-sm font-bold">{toast.message}</div>
          </div>
        ))}
      </div>


      {/* ── HEADER & BACKEND STATUS ── */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between rounded-xl border border-amber-100 bg-white/90 p-4 sm:p-5 shadow-sm">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
            Monitoring Agents
          </h2>
          <p className="mt-1 max-w-2xl text-xs sm:text-sm text-slate-600">
            Manage and view live feeds from silent camera monitoring agents installed on company devices.
          </p>
        </div>

        {/* ── BACKEND STATUS BAR ── */}
        <div
          className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-bold shadow-sm ${backendStatus === "online"
            ? "text-black-800"
            : backendStatus === "offline"
              ? "text-black-800"
              : "text-black-800"
            }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${backendStatus === "online"
              ? "bg-green-500"
              : backendStatus === "offline"
                ? "bg-red-500"
                : "bg-yellow-500"
              }`}
          />
          {!backendUrl
            ? ""
            : backendStatus === "checking"
              ? "Checking..."
              : backendStatus === "online"
                ? "Monitoring Agent online"
                : "Monitoring Agent offline"}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {devices.length > 0 ? (
          devices.map((device) => (
            <div
              key={device.device_id}
              className={`overflow-hidden rounded-[2rem] border bg-white p-6 shadow-md transition-all ${device.status === "online" ? "border-green-200" : "border-slate-200"
                }`}
            >
              {/* Status & Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-bold text-slate-900 truncate max-w-[200px]" title={device.hostname}>
                    {device.hostname}
                  </h4>
                  <p className="text-xs text-slate-500">User: {device.username}</p>
                </div>
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${device.status === "online"
                    ? "bg-green-100 text-green-800"
                    : "bg-slate-100 text-slate-600"
                    }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${device.status === "online" ? "bg-green-500" : "bg-slate-400"
                      }`}
                  />
                  {device.status}
                </span>
              </div>

              {/* Live Feed Image */}
              <div className="relative mt-4 aspect-video overflow-hidden rounded-2xl border border-slate-100 bg-slate-950">
                {device.status === "online" && device.current_frame ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={device.current_frame}
                    alt={`${device.hostname} feed`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-center p-4">
                    <svg
                      className="h-8 w-8 text-slate-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      {device.status === "online" ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                        />
                      ) : (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                        />
                      )}
                    </svg>
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      {device.status === "online" ? "Waiting for camera feed..." : "Agent Offline"}
                    </p>
                  </div>
                )}

                {/* Face Overlay Tag */}
                {device.status === "online" && device.recognized_person && (
                  <div className="absolute bottom-2 left-2 rounded-lg bg-green-900/90 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-green-100 border border-green-700 backdrop-blur-sm">
                    Identified: {device.recognized_person}
                  </div>
                )}
              </div>

              {/* Device Info Fields */}
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">OS:</span>
                  <span className="font-medium text-slate-800">{device.os}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Agent Version:</span>
                  <span className="font-medium text-slate-800">{device.agent_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Device ID:</span>
                  <span className="font-mono text-[10px] text-slate-700 select-all">{device.device_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Last Seen:</span>
                  <span className="font-medium text-slate-800">
                    {new Date(device.last_seen).toLocaleTimeString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
            No silent monitoring agents registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
