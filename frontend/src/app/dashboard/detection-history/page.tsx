"use client";

import { useEffect, useState } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";
import { BackendImage } from "@/components/backend-image";

type TimelineEvent = {
  timestamp: string;
  event: string;
};

type SessionHistoryItem = {
  id: number;
  user_id: number | null;
  name: string;
  entry_time: string;
  exit_time: string | null;
  duration: number;
  image_url: string | null;
  average_confidence: number;
  max_confidence: number;
  detection_type: "KNOWN" | "UNKNOWN" | "UNVERIFIED";
  session_status: "ACTIVE" | "COMPLETED";
  timeline: TimelineEvent[];
};

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const mins = m % 60;
  return `${h}h ${mins}m`;
}

function formatTime(isoString: string | null): string {
  if (!isoString) return "Active";
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

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "N/A";
  }
}

export default function DetectionHistoryPage() {
  const backendUrl = useBackendUrl();
  const [history, setHistory] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter States
  const [datePreset, setDatePreset] = useState<"TODAY" | "YESTERDAY" | "LAST_7" | "LAST_30" | "CUSTOM">("TODAY");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [detectionType, setDetectionType] = useState<"ALL" | "KNOWN" | "UNKNOWN" | "UNVERIFIED">("ALL");
  const [searchName, setSearchName] = useState("");

  // Modal Detail State
  const [selectedSession, setSelectedSession] = useState<SessionHistoryItem | null>(null);

  const fetchHistory = async () => {
    if (!backendUrl) return;
    try {
      setLoading(true);
      setError("");

      // Calculate start/end dates based on presets
      let startStr = "";
      let endStr = "";
      const now = new Date();

      if (datePreset === "TODAY") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        startStr = start.toISOString();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        endStr = end.toISOString();
      } else if (datePreset === "YESTERDAY") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        startStr = start.toISOString();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
        endStr = end.toISOString();
      } else if (datePreset === "LAST_7") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startStr = start.toISOString();
        endStr = now.toISOString();
      } else if (datePreset === "LAST_30") {
        const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startStr = start.toISOString();
        endStr = now.toISOString();
      } else if (datePreset === "CUSTOM") {
        if (customStartDate) {
          startStr = new Date(customStartDate).toISOString();
        }
        if (customEndDate) {
          const end = new Date(customEndDate);
          end.setHours(23, 59, 59, 999);
          endStr = end.toISOString();
        }
      }

      // Build Query params
      const params = new URLSearchParams();
      if (startStr) params.append("start_date", startStr);
      if (endStr) params.append("end_date", endStr);
      if (startTime) params.append("start_time", startTime);
      if (endTime) params.append("end_time", endTime);
      if (detectionType !== "ALL") params.append("detection_type", detectionType);
      if (searchName) params.append("person_name", searchName);

      const response = await fetchBackend(`${backendUrl}/api/v1/detections/history?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to load history logs");
      }
      const data = await response.json();
      setHistory(data.history || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load detection logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHistory();
  }, [backendUrl, datePreset, customStartDate, customEndDate, startTime, endTime, detectionType, searchName]);

  return (
    <div className="space-y-6">
      {/* HEADER BAR */}
      <div className="rounded-[2rem] border border-amber-100 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-600">Archive Logs</p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-900">Detection History Dashboard</h2>
        <p className="mt-4 max-w-3xl text-lg text-slate-600">
          Query complete presence logs, filter by timestamps, search unique identities, and view detailed recognition timelines with camera snapshots.
        </p>
      </div>

      {/* FILTER CONTROL CARD */}
      <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-md space-y-4">
        <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
          <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Search &amp; Filters
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {/* Date Preset */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Date Range</label>
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as any)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
            >
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="LAST_7">Last 7 Days</option>
              <option value="LAST_30">Last 30 Days</option>
              <option value="CUSTOM">Custom Range</option>
            </select>
          </div>

          {/* Custom Dates if CUSTOM Preset chosen */}
          {datePreset === "CUSTOM" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Start Date</label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">End Date</label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
                />
              </div>
            </>
          )}

          {/* Time Range */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Start Time</label>
            <input
              type="time"
              step="1"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">End Time</label>
            <input
              type="time"
              step="1"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Detection Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Detection Type</label>
            <select
              value={detectionType}
              onChange={(e) => setDetectionType(e.target.value as any)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 focus:border-amber-400 focus:bg-white focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              <option value="KNOWN">Known User</option>
              <option value="UNKNOWN">Unknown Face</option>
              <option value="UNVERIFIED">Unverified Detection</option>
            </select>
          </div>

          {/* Person Name Search */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Search Person</label>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-amber-400 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => {
              setDatePreset("TODAY");
              setCustomStartDate("");
              setCustomEndDate("");
              setStartTime("");
              setEndTime("");
              setDetectionType("ALL");
              setSearchName("");
            }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Reset Filters
          </button>
          <button
            onClick={fetchHistory}
            className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white hover:bg-slate-700 transition"
          >
            Reload Logs
          </button>
        </div>
      </div>

      {/* LOGS TABLE SECTION */}
      <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-lg">
        {loading ? (
          <div className="py-20 text-center flex flex-col items-center justify-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
            <p className="text-sm font-semibold text-slate-500">Querying historical records...</p>
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800">
            <p className="font-bold">Error loading history logs</p>
            <p className="mt-1 text-sm">{error}</p>
          </div>
        ) : history.length === 0 ? (
          <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-2xl">
            <p className="text-lg font-bold">No records found matching filters</p>
            <p className="mt-2 text-sm text-slate-400">Try adjusting your dates, query keywords, or category selects.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pl-2">Snapshot</th>
                  <th className="pb-3">Person Name</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Entry Time</th>
                  <th className="pb-3">Exit Time</th>
                  <th className="pb-3 text-right">Duration</th>
                  <th className="pb-3 text-right">Avg Conf.</th>
                  <th className="pb-3 pl-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {history.map((session) => {
                  let badgeBg = "bg-slate-100 text-slate-700";
                  if (session.detection_type === "KNOWN") badgeBg = "bg-green-100 text-green-800";
                  else if (session.detection_type === "UNKNOWN") badgeBg = "bg-amber-100 text-amber-800";
                  else if (session.detection_type === "UNVERIFIED") badgeBg = "bg-indigo-100 text-indigo-800";

                  return (
                    <tr
                      key={session.id}
                      onClick={() => setSelectedSession(session)}
                      className="cursor-pointer hover:bg-slate-50/80 transition group"
                    >
                      {/* Crop Snapshot */}
                      <td className="py-3.5 pl-2">
                        {session.image_url ? (
                          <BackendImage
                            src={session.image_url}
                            alt={session.name}
                            className="h-12 w-12 rounded-xl object-cover border border-slate-200 shadow-sm"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-[10px] font-semibold text-slate-400 border border-slate-200">
                            No Frame
                          </div>
                        )}
                      </td>

                      {/* Name */}
                      <td className="py-3.5 font-bold text-slate-800 group-hover:text-amber-600 transition">
                        {session.name}
                      </td>

                      {/* Category Type */}
                      <td className="py-3.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${badgeBg}`}>
                          {session.detection_type}
                        </span>
                      </td>

                      {/* Entry time */}
                      <td className="py-3.5 text-slate-600">
                        <span className="block font-semibold">{formatTime(session.entry_time)}</span>
                        <span className="text-xs text-slate-400">{formatDate(session.entry_time)}</span>
                      </td>

                      {/* Exit time */}
                      <td className="py-3.5 text-slate-600">
                        {session.session_status === "ACTIVE" ? (
                          <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-green-600 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                            Active
                          </span>
                        ) : (
                          <>
                            <span className="block font-semibold">{formatTime(session.exit_time)}</span>
                            <span className="text-xs text-slate-400">{formatDate(session.exit_time || "")}</span>
                          </>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 text-right font-semibold text-slate-700 tabular-nums">
                        {formatDuration(session.duration)}
                      </td>

                      {/* Confidence */}
                      <td className="py-3.5 text-right font-semibold text-slate-700 tabular-nums">
                        {(session.average_confidence * 100).toFixed(1)}%
                      </td>

                      {/* Status */}
                      <td className="py-3.5 pl-4">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider ${
                          session.session_status === "ACTIVE" ? "text-green-600" : "text-slate-400"
                        }`}>
                          {session.session_status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DETAIL VIEW MODAL */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
              <h3 className="text-xl font-black text-slate-950">Session Details (S{selectedSession.id})</h3>
              <button
                onClick={() => setSelectedSession(null)}
                className="rounded-full bg-white p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-[120px_1fr] gap-6">
                {/* Large Snapshot */}
                {selectedSession.image_url ? (
                  <BackendImage
                    src={selectedSession.image_url}
                    alt={selectedSession.name}
                    className="h-28 w-28 rounded-2xl object-cover border border-slate-200 shadow-sm"
                  />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-100 text-xs font-semibold text-slate-400 border border-slate-200">
                    No Snapshot
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-2xl font-black text-slate-900">{selectedSession.name}</h4>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wider ${
                      selectedSession.detection_type === "KNOWN" ? "bg-green-100 text-green-800" :
                      selectedSession.detection_type === "UNKNOWN" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"
                    }`}>
                      {selectedSession.detection_type}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
                      {selectedSession.session_status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-5 text-sm">
                <div>
                  <p className="font-bold text-slate-400 uppercase tracking-wider text-xs">Entry Timestamp</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {formatDate(selectedSession.entry_time)} at {formatTime(selectedSession.entry_time)}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-slate-400 uppercase tracking-wider text-xs">Exit Timestamp</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {selectedSession.session_status === "ACTIVE"
                      ? "Active Session"
                      : `${formatDate(selectedSession.exit_time || "")} at ${formatTime(selectedSession.exit_time)}`}
                  </p>
                </div>
                <div>
                  <p className="font-bold text-slate-400 uppercase tracking-wider text-xs">Total Duration</p>
                  <p className="mt-1 font-semibold text-slate-800 tabular-nums">{formatDuration(selectedSession.duration)}</p>
                </div>
                <div>
                  <p className="font-bold text-slate-400 uppercase tracking-wider text-xs">Confidence Stats</p>
                  <p className="mt-1 font-semibold text-slate-800 tabular-nums">
                    Average: {(selectedSession.average_confidence * 100).toFixed(1)}% <br />
                    Highest: {(selectedSession.max_confidence * 100).toFixed(1)}%
                  </p>
                </div>
              </div>

              {/* TIMELINE */}
              <div>
                <h5 className="text-lg font-bold text-slate-900 mb-4">Detection Timeline</h5>
                <div className="relative border-l border-slate-200 ml-4 space-y-6">
                  {selectedSession.timeline && selectedSession.timeline.length > 0 ? (
                    selectedSession.timeline.map((evt, idx) => {
                      let dotColor = "bg-slate-400 border-slate-300";
                      if (evt.event === "Entry") dotColor = "bg-green-500 border-green-200 ring-4 ring-green-100";
                      else if (evt.event === "Exit") dotColor = "bg-red-500 border-red-200 ring-4 ring-red-100";
                      else if (evt.event.startsWith("Active")) dotColor = "bg-amber-400 border-amber-200";

                      return (
                        <div key={idx} className="relative pl-6">
                          <span className={`absolute -left-[7px] top-1.5 h-3.5 w-3.5 rounded-full border-2 ${dotColor}`} />
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider tabular-nums">{evt.timestamp}</p>
                          <p className="text-sm font-semibold text-slate-800 mt-0.5">{evt.event}</p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="pl-6 text-sm text-slate-400 italic">No timeline markers logged.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
