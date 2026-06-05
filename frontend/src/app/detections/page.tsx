"use client";

import { useEffect, useState, useRef } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";
import { BackendImage } from "@/components/backend-image";

type PresenceLog = {
  id: number;
  user_id: number | null;
  name: string;
  start_time: string;
  last_seen: string;
  entry_time: string;
  exit_time: string | null;
  duration: number;
  image_url: string | null;
  session_status: "ACTIVE" | "COMPLETED";
  detection_type: "KNOWN" | "UNKNOWN" | "UNVERIFIED";
};

type PresenceSummary = {
  total_known_persons: number;
  total_unknown_persons: number;
  known_time_present: number;
  unknown_time_present: number;
  history: PresenceLog[];
};

type User = {
  id: number;
  name: string;
  created_at: string;
  image_url?: string | null;
};

function formatTime(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) {
    return `${m}m ${sec}s`;
  }
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${h}h ${mins}m`;
}

function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  } catch {
    return "N/A";
  }
}

function formatDateLabel(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export default function DetectionsPage() {
  const backendUrl = useBackendUrl();

  const [users, setUsers] = useState<User[]>([]);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [dashboardHistory, setDashboardHistory] = useState<any[]>([]);
  const [isAgentActive, setIsAgentActive] = useState<boolean>(false);
  const isAgentActiveRef = useRef<boolean | undefined>(undefined);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: "success" | "error" | "info" }[]>([]);

  const showToast = (message: string, type: "success" | "error" | "info") => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const [presenceData, setPresenceData] = useState<PresenceSummary>({
    total_known_persons: 0,
    total_unknown_persons: 0,
    known_time_present: 0,
    unknown_time_present: 0,
    history: [],
  });

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

  // Fetch enrolled users list
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    const fetchUsers = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/users`);
        if (!response.ok) {
          throw new Error("Failed to load users");
        }
        const data: User[] = await response.json();
        setUsers(data);
      } catch (error) {
        console.error(error);
      }
    };

    void fetchUsers();
    const userInterval = setInterval(fetchUsers, 10000);
    return () => clearInterval(userInterval);
  }, [backendUrl, backendStatus]);

  // Fetch dashboard history
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }
    const loadDashboardHistory = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/detections/dashboard-history`);
        if (response.ok) {
          const data = await response.json();
          setDashboardHistory(data);
        }
      } catch (error) {
        console.error("Error loading dashboard history:", error);
      }
    };
    void loadDashboardHistory();
  }, [backendUrl, backendStatus]);

  // Fetch agent status
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }
    const checkAgentStatus = async () => {
      try {
        const response = await fetchBackend(`${backendUrl}/api/v1/device/status`);
        if (response.ok) {
          const data = await response.json();
          const onlineDevice = data.find((d: any) => d.status === "online");
          setIsAgentActive(!!onlineDevice);
        }
      } catch (error) {
        console.error("Error checking agent status:", error);
      }
    };
    void checkAgentStatus();
    const interval = setInterval(checkAgentStatus, 5000);
    return () => clearInterval(interval);
  }, [backendUrl, backendStatus]);

  // Reset presence data when agent goes offline, or load it when agent is online
  useEffect(() => {
    isAgentActiveRef.current = isAgentActive;
    if (!isAgentActive) {
      setPresenceData({
        total_known_persons: 0,
        total_unknown_persons: 0,
        known_time_present: 0,
        unknown_time_present: 0,
        history: [],
      });
    } else {
      if (backendUrl && backendStatus === "online") {
        const loadInitialPresence = async () => {
          try {
            const response = await fetchBackend(`${backendUrl}/api/v1/detections/presence`);
            if (!response.ok) {
              throw new Error("Failed to load initial presence data");
            }
            const data: PresenceSummary = await response.json();
            setPresenceData(data);
          } catch (error) {
            console.error("Error loading initial presence:", error);
          }
        };
        void loadInitialPresence();
      }
    }
  }, [isAgentActive, backendUrl, backendStatus]);

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
            const prevOnline = isAgentActiveRef.current;
            setIsAgentActive(isOnline);
            if (prevOnline !== undefined && isOnline !== prevOnline) {
              showToast(`Agent "${message.device_id}" is now ${message.status.toUpperCase()}`, isOnline ? "success" : "error");
            }
            isAgentActiveRef.current = isOnline;
          }
          else if (message.type === "dashboard_stopped") {
            const prevOnline = isAgentActiveRef.current;
            setIsAgentActive(false);
            if (prevOnline) {
              showToast(`Monitoring session completed for agent "${message.device_id}"`, "info");
            }
            if (message.history_entry) {
              setDashboardHistory((prev) => [message.history_entry, ...prev]);
            }
          }
          else if (message.type === "dashboard_update") {
            if (!isAgentActiveRef.current) return;
            setPresenceData((prev) => ({
              ...prev,
              total_known_persons: message.knownPersons ?? prev.total_known_persons,
              total_unknown_persons: message.unknownPersons ?? prev.total_unknown_persons,
              known_time_present: message.rawKnownTime ?? prev.known_time_present,
              unknown_time_present: message.rawUnknownTime ?? prev.unknown_time_present,
            }));
          }
          else if (message.type === "presence_log_update") {
            if (!isAgentActiveRef.current) return;
            const logId = parseInt(message.sessionId.replace("S", ""), 10);

            setPresenceData((prev) => {
              const existingIdx = prev.history.findIndex((log) => log.id === logId);
              let updatedHistory = [...prev.history];

              if (existingIdx > -1) {
                updatedHistory[existingIdx] = {
                  ...updatedHistory[existingIdx],
                  name: message.user,
                  last_seen: new Date().toISOString(),
                  image_url: message.imageUrl ?? updatedHistory[existingIdx].image_url,
                  session_status: "ACTIVE"
                };
              } else {
                const newLog: PresenceLog = {
                  id: logId,
                  user_id: null,
                  name: message.user,
                  start_time: new Date().toISOString(),
                  last_seen: new Date().toISOString(),
                  entry_time: new Date().toISOString(),
                  exit_time: null,
                  duration: 0,
                  image_url: message.imageUrl,
                  session_status: "ACTIVE",
                  detection_type: message.user !== "Unknown" ? "KNOWN" : "UNKNOWN"
                };
                updatedHistory.unshift(newLog);
              }

              return {
                ...prev,
                history: updatedHistory
              };
            });
          }
          else if (message.type === "session_ended") {
            if (!isAgentActiveRef.current) return;
            const logId = parseInt(message.sessionId.replace("S", ""), 10);

            setPresenceData((prev) => {
              const existingIdx = prev.history.findIndex((log) => log.id === logId);
              if (existingIdx > -1) {
                const updatedHistory = [...prev.history];
                const parts = message.duration.split(":");
                const secs = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);

                updatedHistory[existingIdx] = {
                  ...updatedHistory[existingIdx],
                  last_seen: new Date().toISOString(),
                  exit_time: new Date().toISOString(),
                  duration: secs,
                  session_status: "COMPLETED"
                };
                return {
                  ...prev,
                  history: updatedHistory
                };
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

  // Local timer to increment durations in real time for active sessions
  useEffect(() => {
    const timer = setInterval(() => {
      if (!isAgentActive) return; // Pause increments if agent is inactive!

      setPresenceData((prev) => {
        let hasActiveKnown = false;
        let hasActiveUnknown = false;

        const updatedHistory = prev.history.map((log) => {
          const isSessionActive = log.session_status === "ACTIVE";
          if (isSessionActive) {
            if (log.name !== "Unknown") {
              hasActiveKnown = true;
            } else {
              hasActiveUnknown = true;
            }
            return {
              ...log,
              duration: log.duration + 1
            };
          }
          return log;
        });

        return {
          ...prev,
          known_time_present: prev.known_time_present + (hasActiveKnown ? 1 : 0),
          unknown_time_present: prev.unknown_time_present + (hasActiveUnknown ? 1 : 0),
          history: updatedHistory
        };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isAgentActive]);


  return (
    <div className="space-y-8">
      {/* ── HEADER CARD ── */}
      <section className="rounded-[2rem] border border-amber-100 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-600">
          Detections &amp; Presence
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-900">
          Detections Dashboard
        </h2>
        <p className="mt-3 max-w-3xl text-lg text-slate-600">
          Real-time tracking of known and unknown persons, presence duration statistics, and enrolled user directory.
        </p>
      </section>

      {/* ── BACKEND STATUS BAR ── */}
      <div
        className={`flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${backendStatus === "online"
          ? "bg-green-100 text-green-800"
          : backendStatus === "offline"
            ? "bg-red-100 text-red-800"
            : "bg-yellow-100 text-yellow-800"
          }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${backendStatus === "online"
            ? "bg-green-500 animate-pulse"
            : backendStatus === "offline"
              ? "bg-red-500"
              : "bg-yellow-500 animate-pulse"
            }`}
        />
        {!backendUrl
          ? "Set NEXT_PUBLIC_BACKEND_URL to your backend ngrok URL."
          : backendStatus === "checking"
            ? "Checking backend..."
            : backendStatus === "online"
              ? `Backend Online - ${backendUrl}`
              : `Backend Offline - start Python server at ${backendUrl}`}
      </div>

      <div className="space-y-8 animate-fade-in">
        {/* ── TOAST NOTIFICATIONS ── */}
        <div className="fixed top-6 right-6 z-50 space-y-3 pointer-events-none max-w-sm w-full">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full items-center gap-3 rounded-2xl p-4 shadow-xl border transition-all transform translate-y-0 duration-300 ${
                toast.type === "success"
                  ? "bg-green-50 border-green-200 text-green-800"
                  : toast.type === "error"
                    ? "bg-red-50 border-red-200 text-red-800"
                    : "bg-blue-50 border-blue-200 text-blue-800"
              }`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                toast.type === "success"
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

        {/* ── AGENT STATUS BANNER ── */}
        {!isAgentActive && (
          <div className="rounded-[2rem] border border-red-100 bg-red-50/40 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </span>
              <div>
                <h4 className="text-lg font-bold text-red-800">Detections Dashboard Paused</h4>
                <p className="text-sm text-red-600 font-medium">Monitoring Agent is offline. Detections and presence logging are suspended.</p>
              </div>
            </div>
            <div className="text-xs text-red-700 bg-red-100/60 rounded-xl px-4 py-2 font-semibold">
              Start agent executable to resume monitoring.
            </div>
          </div>
        )}

        {/* ── SUMMARY STATISTICS CARDS ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Total Known Persons */}
          <div className="rounded-3xl border border-emerald-100 bg-white/95 p-6 shadow-md">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Total Known Persons
            </span>
            <p className="mt-3 text-3xl font-black text-slate-800">{presenceData.total_known_persons}</p>
            <p className="mt-1 text-xs text-slate-500">Unique registered users seen</p>
          </div>

          {/* Total Unknown Sessions */}
          <div className="rounded-3xl border border-rose-100 bg-white/95 p-6 shadow-md">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Total Unknown Persons
            </span>
            <p className="mt-3 text-3xl font-black text-slate-800">{presenceData.total_unknown_persons}</p>
            <p className="mt-1 text-xs text-slate-500">Unregistered face logs recorded</p>
          </div>

          {/* Known Time Present */}
          <div className="rounded-3xl border border-teal-100 bg-white/95 p-6 shadow-md">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Known Time Present
            </span>
            <p className="mt-3 text-3xl font-black text-slate-800">{formatTime(presenceData.known_time_present)}</p>
            <p className="mt-1 text-xs text-slate-500">Cumulative visibility (HH:MM:SS)</p>
          </div>

          {/* Unknown Time Present */}
          <div className="rounded-3xl border border-amber-100 bg-white/95 p-6 shadow-md">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Unknown Time Present
            </span>
            <p className="mt-3 text-3xl font-black text-slate-800">{formatTime(presenceData.unknown_time_present)}</p>
            <p className="mt-1 text-xs text-slate-500">Cumulative untracked time (HH:MM:SS)</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.9fr]">
          {/* ── REAL-TIME PRESENCE LOG HISTORY ── */}
          <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-2xl font-bold text-slate-900">Real-time Presence Log</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                {presenceData.history.length} Sessions
              </span>
            </div>

            <div className="mt-5 space-y-4 max-h-[700px] overflow-y-auto pr-2">
              {presenceData.history.length > 0 ? (
                presenceData.history.map((log) => {
                  const isSessionActive = log.session_status === "ACTIVE";
                  return (
                    <div
                      key={log.id}
                      className={`flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border p-4 transition-all ${isSessionActive
                        ? "border-green-300 bg-green-50/40 shadow-sm"
                        : "border-slate-200 bg-slate-50/50 hover:bg-slate-50"
                        }`}
                    >
                      {/* Dynamic camera snapshot preview */}
                      {log.image_url ? (
                        <BackendImage
                          src={log.image_url}
                          alt={log.name}
                          className="h-16 w-16 rounded-2xl object-cover border border-slate-200 shadow-sm"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 border border-slate-300">
                          No Photo
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-lg font-bold text-slate-900">
                            {log.name}
                          </p>
                          {isSessionActive ? (
                            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-green-700 animate-pulse border border-green-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                              Active
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-slate-500 border border-slate-200">
                              Completed
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wide text-[10px] block">Entry Time</span>
                            {formatDateTime(log.entry_time || log.start_time)}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-400 uppercase tracking-wide text-[10px] block">Exit Time</span>
                            {isSessionActive ? "--" : formatDateTime(log.exit_time || log.last_seen)}
                          </div>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-400">
                          Session Date: {formatDateLabel(log.entry_time || log.start_time)}
                        </p>
                      </div>

                      <div className="text-left sm:text-right shrink-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Duration</p>
                        <p className="mt-0.5 text-lg font-black text-slate-800 tabular-nums">
                          {formatDuration(log.duration)}
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                  No presence sessions registered in the database yet. Let a user start their camera to populate the logs.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── MONITORING SESSION HISTORY ── */}
        <section className="rounded-[2rem] border border-amber-100 bg-white/90 p-8 shadow-lg space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">Monitoring Session History</h3>
              <p className="text-sm text-slate-500 mt-1">Snapshot summaries of past monitoring sessions when agents went offline.</p>
            </div>
            <span className="rounded-full bg-amber-50 border border-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              {dashboardHistory.length} Sessions Saved
            </span>
          </div>

          {dashboardHistory.length > 0 ? (
            <div className="space-y-6">
              {dashboardHistory.map((sess) => (
                <div key={sess.id} className="border border-slate-200 rounded-3xl p-6 bg-slate-50/50 hover:bg-slate-50 transition-all space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Agent Device</span>
                      <span className="font-extrabold text-slate-800">{sess.device_id}</span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-600 sm:text-right">
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wide text-[10px] font-bold">Session Start</span>
                        {new Date(sess.session_start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </div>
                      <div>
                        <span className="text-slate-400 block uppercase tracking-wide text-[10px] font-bold">Session End</span>
                        {new Date(sess.session_end).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 block">Total Known Persons</span>
                      <span className="text-xl font-extrabold text-slate-800">{sess.total_known_persons}</span>
                    </div>
                    <div className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-rose-600 block">Total Unknown Persons</span>
                      <span className="text-xl font-extrabold text-slate-800">{sess.total_unknown_persons}</span>
                    </div>
                    <div className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-teal-600 block">Known Time Present</span>
                      <span className="text-xl font-extrabold text-slate-800">{formatTime(sess.known_time_present)}</span>
                    </div>
                    <div className="bg-white border border-slate-100 p-4 rounded-xl shadow-sm">
                      <span className="text-[10px] uppercase font-bold text-amber-600 block">Unknown Time Present</span>
                      <span className="text-xl font-extrabold text-slate-800">{formatTime(sess.unknown_time_present)}</span>
                    </div>
                  </div>

                  {/* Presence Logs during session */}
                  {sess.presence_logs && sess.presence_logs.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Real-time Presence Log</span>
                      <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2">
                        {sess.presence_logs.map((log: any) => (
                          <div key={log.id} className="flex items-center gap-3 bg-white border border-slate-100 p-3 rounded-xl text-xs shadow-sm">
                            {log.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`${backendUrl}${log.imageUrl}`} alt={log.name} className="h-8 w-8 rounded-lg object-cover" />
                            ) : (
                              <div className="h-8 w-8 rounded-lg bg-slate-200 flex items-center justify-center font-bold text-slate-400">?</div>
                            )}
                            <div className="min-w-0 flex-1">
                              <span className="font-bold text-slate-800 block">{log.name}</span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(log.entry_time).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} - {new Date(log.exit_time).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono text-slate-600 font-semibold">{formatDuration(log.duration)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              No monitoring session history saved yet.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
