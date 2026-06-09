"use client";

import { useEffect, useState } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";

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

export default function MonitoringSessionHistoryPage() {
  const backendUrl = useBackendUrl();
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">("checking");
  const [dashboardHistory, setDashboardHistory] = useState<any[]>([]);

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

  // Connect to backend WebSocket for real-time updates
  useEffect(() => {
    if (!backendUrl || backendStatus !== "online") {
      return;
    }

    const wsProtocol = backendUrl.startsWith("https") ? "wss" : "ws";
    const wsUrl = `${backendUrl.replace(/^https?:\/\//, `${wsProtocol}://`)}/ws?ngrok-skip-browser-warning=true`;

    const socket = new WebSocket(wsUrl);

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "dashboard_stopped") {
          if (message.history_entry) {
            setDashboardHistory((prev) => [message.history_entry, ...prev]);
          }
        }
      } catch (err) {
        console.error("[WebSocket] Error handling message:", err);
      }
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [backendUrl, backendStatus]);

  return (
    <div className="space-y-4 sm:space-y-6">


      {/* ── MONITORING SESSION HISTORY ── */}
      <section className="rounded-[2rem] border border-amber-100 bg-white/90 p-6 sm:p-8 shadow-lg space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-2xl font-bold text-slate-900">Session Snapshots</h3>
          </div>
          <span className="rounded-none px-3 py-1 text-sm font-bold tracking-[0.2em]">
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
  );
}
