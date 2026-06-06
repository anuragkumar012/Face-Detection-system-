"use client";

import { useEffect, useState, FormEvent } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";
import { BackendImage } from "@/components/backend-image";

type PersonFaceInstance = {
  photo_scan_id: number;
  photo_scan_filename: string | null;
  photo_scan_created_at: string;
  image_url: string;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
  is_confirmed: boolean;
  variation_handling?: {
    lighting: string;
    pose: string;
    camera_quality: string;
    occlusion_risk: string;
    supported_changes: string[];
    note: string;
  } | null;
  features?: {
    eyes: boolean;
    nose: boolean;
    mouth: boolean;
    face_shape: boolean;
    relative_positions: boolean;
  } | null;
};

type PersonCluster = {
  cluster_id: string;
  label: string;
  is_registered: boolean;
  user_id: number | null;
  cover_image_url: string | null;
  cover_bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null;
  faces: PersonFaceInstance[];
};

export default function PeoplePage() {
  const backendUrl = useBackendUrl();
  const [people, setPeople] = useState<PersonCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<"all" | "registered" | "unregistered">("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Selected Person (album view modal)
  const [selectedPerson, setSelectedPerson] = useState<PersonCluster | null>(null);
  
  // Enrollment form state
  const [enrollName, setEnrollName] = useState("");
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState("");

  // Continuous Learning states per-face in modal
  const [modalActionError, setModalActionError] = useState("");
  const [modalActionLoadingId, setModalActionLoadingId] = useState<string | null>(null);

  // Merge Mode states
  const [isMergeMode, setIsMergeMode] = useState(false);
  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [mergePrimaryId, setMergePrimaryId] = useState<string>("");
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState("");

  // Full-size Photo Preview Modal
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const loadPeople = async () => {
    if (!backendUrl) return;
    try {
      setLoading(true);
      setError("");
      const response = await fetchBackend(`${backendUrl}/api/v1/people`);
      if (!response.ok) {
        throw new Error("Failed to fetch face clusters");
      }
      const data: PersonCluster[] = await response.json();
      setPeople(data);
      
      // If a person is currently selected, update their state with refreshed data
      if (selectedPerson) {
        const updated = data.find((p) => p.cluster_id === selectedPerson.cluster_id);
        if (updated) {
          setSelectedPerson(updated);
        } else {
          setSelectedPerson(null);
        }
      }
    } catch (err: unknown) {
      console.warn("Failed to fetch:", err);
      setError(err instanceof Error ? err.message : "Failed to load people database");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPeople();
  }, [backendUrl]);

  // Enrolls a cluster (naming it, creating user + first embedding)
  const handleEnroll = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPerson || !enrollName.trim()) return;

    setEnrollLoading(true);
    setEnrollError("");

    try {
      const response = await fetchBackend(
        `${backendUrl}/api/v1/people/${selectedPerson.cluster_id}/enroll`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: enrollName.trim() }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || "Enrollment failed");
      }

      setEnrollName("");
      // Reload the data to reflect the changes
      await loadPeople();
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : "Failed to enroll person");
    } finally {
      setEnrollLoading(false);
    }
  };

  // Continuous Learning: Confirm face match (adding embedding)
  const handleConfirmFace = async (face: PersonFaceInstance) => {
    if (!selectedPerson) return;
    const actionId = `confirm-${face.photo_scan_id}-${face.bbox.x1}`;
    setModalActionLoadingId(actionId);
    setModalActionError("");

    try {
      const response = await fetchBackend(`${backendUrl}/api/v1/people/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_scan_id: face.photo_scan_id,
          x1: face.bbox.x1,
          y1: face.bbox.y1,
          x2: face.bbox.x2,
          y2: face.bbox.y2,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || "Failed to confirm face");
      }

      await loadPeople();
    } catch (err: unknown) {
      setModalActionError(err instanceof Error ? err.message : "Error confirming face");
    } finally {
      setModalActionLoadingId(null);
    }
  };

  // Continuous Learning: Remove incorrect face match (isolating it)
  const handleRemoveMatch = async (face: PersonFaceInstance) => {
    if (!selectedPerson) return;
    const actionId = `remove-${face.photo_scan_id}-${face.bbox.x1}`;
    setModalActionLoadingId(actionId);
    setModalActionError("");

    try {
      const response = await fetchBackend(`${backendUrl}/api/v1/people/remove-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo_scan_id: face.photo_scan_id,
          x1: face.bbox.x1,
          y1: face.bbox.y1,
          x2: face.bbox.x2,
          y2: face.bbox.y2,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || "Failed to remove match");
      }

      await loadPeople();
    } catch (err: unknown) {
      setModalActionError(err instanceof Error ? err.message : "Error removing match");
    } finally {
      setModalActionLoadingId(null);
    }
  };

  // Continuous Learning: Merge selected clusters
  const handleMergeSubmit = async () => {
    if (selectedMergeIds.length !== 2 || !mergePrimaryId) return;

    setMergeLoading(true);
    setMergeError("");
    
    const secondaryId = selectedMergeIds.find((id) => id !== mergePrimaryId) || "";

    try {
      const response = await fetchBackend(`${backendUrl}/api/v1/people/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_cluster_id: mergePrimaryId,
          secondary_cluster_id: secondaryId,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail || "Merge failed");
      }

      // Reset merge states
      setIsMergeMode(false);
      setSelectedMergeIds([]);
      setMergePrimaryId("");
      
      await loadPeople();
    } catch (err: unknown) {
      setMergeError(err instanceof Error ? err.message : "Failed to merge groups");
    } finally {
      setMergeLoading(false);
    }
  };

  // Build the cover image URL helper
  const getCoverUrl = (person: PersonCluster) => {
    if (person.is_registered && person.cover_image_url) {
      return person.cover_image_url;
    }
    if (person.faces.length > 0 && person.cover_bbox) {
      const face = person.faces[0];
      const bbox = person.cover_bbox;
      return `${backendUrl}/api/v1/people/crop?photo_scan_id=${face.photo_scan_id}&x1=${bbox.x1}&y1=${bbox.y1}&x2=${bbox.x2}&y2=${bbox.y2}`;
    }
    return "";
  };

  // Build the face crop URL helper for album items
  const getFaceCropUrl = (face: PersonFaceInstance) => {
    const bbox = face.bbox;
    return `${backendUrl}/api/v1/people/crop?photo_scan_id=${face.photo_scan_id}&x1=${bbox.x1}&y1=${bbox.y1}&x2=${bbox.x2}&y2=${bbox.y2}`;
  };

  // Handles clicking a person card in the directory
  const handleCardClick = (person: PersonCluster) => {
    if (isMergeMode) {
      const id = person.cluster_id;
      if (selectedMergeIds.includes(id)) {
        const next = selectedMergeIds.filter((x) => x !== id);
        setSelectedMergeIds(next);
        if (mergePrimaryId === id) {
          setMergePrimaryId(next[0] || "");
        }
      } else {
        if (selectedMergeIds.length < 2) {
          const next = [...selectedMergeIds, id];
          setSelectedMergeIds(next);
          if (next.length === 1) {
            setMergePrimaryId(id);
          }
        }
      }
    } else {
      setSelectedPerson(person);
    }
  };

  // Filters and searches the clusters list
  const filteredPeople = people.filter((person) => {
    // 1. Filter by type
    if (filterType === "registered" && !person.is_registered) return false;
    if (filterType === "unregistered" && person.is_registered) return false;

    // 2. Search query filter
    if (searchQuery.trim() !== "") {
      return person.label.toLowerCase().includes(searchQuery.toLowerCase());
    }

    return true;
  });

  return (
    <div className="space-y-6">


      {/* Merge Mode Action Banner */}
      {isMergeMode && (
        <div className="rounded-[2rem] border border-indigo-200 bg-indigo-50 p-5 sm:p-6 text-slate-900 shadow-md">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-lg font-black text-indigo-950">Merge Person Groups</h4>
              <p className="text-sm text-indigo-800">
                Select exactly 2 groups to merge. Currently selected: {selectedMergeIds.length}/2
              </p>
            </div>
            <button
              onClick={() => {
                setIsMergeMode(false);
                setSelectedMergeIds([]);
                setMergePrimaryId("");
                setMergeError("");
              }}
              className="rounded-xl border border-indigo-300 bg-white px-5 py-2.5 text-sm font-bold text-indigo-900 transition hover:bg-indigo-100"
            >
              Cancel Merge Mode
            </button>
          </div>

          {selectedMergeIds.length === 2 && (
            <div className="mt-5 border-t border-indigo-200 pt-4">
              <p className="text-sm font-semibold text-indigo-950">
                Choose the primary identity to retain:
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {selectedMergeIds.map((id) => {
                  const label = people.find((p) => p.cluster_id === id)?.label || id;
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-slate-900">
                      <input
                        type="radio"
                        name="primary-merge"
                        checked={mergePrimaryId === id}
                        onChange={() => setMergePrimaryId(id)}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      {label} ({id.startsWith("user-") ? "Enrolled" : "Cluster"})
                    </label>
                  );
                })}
              </div>

              {mergeError && (
                <div className="mt-3 rounded-xl bg-rose-100 p-3 text-xs font-semibold text-rose-700">
                  {mergeError}
                </div>
              )}

              <button
                onClick={handleMergeSubmit}
                disabled={mergeLoading || !mergePrimaryId}
                className="mt-4 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {mergeLoading ? "Merging..." : "Confirm & Merge"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Control bar (Filters & Search) */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "registered", "unregistered"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`rounded-2xl px-5 py-2.5 text-sm font-bold capitalize transition-all ${
                filterType === type
                  ? "bg-slate-900 text-white shadow-md"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              {type === "all"
                ? "All People"
                : type === "registered"
                ? "Enrolled Users"
                : "Unregistered Clusters"}
            </button>
          ))}
          
          {!isMergeMode && (
            <button
              onClick={() => setIsMergeMode(true)}
              className="ml-2 rounded-2xl bg-indigo-50 border border-indigo-200 px-5 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100 transition"
            >
              Merge Groups
            </button>
          )}
        </div>

        <div className="relative max-w-sm flex-1">
          <input
            type="text"
            placeholder="Search by name or label..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-5 py-2.5 text-sm text-slate-950 placeholder-slate-400 focus:border-amber-400 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {/* People Grid */}
      {loading && people.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border border-slate-200 bg-white/90">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
            <p className="text-sm font-semibold text-slate-500">Loading clusters...</p>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
          <p className="font-bold">Error loading database</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      ) : filteredPeople.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center text-slate-500">
          <p className="text-lg font-bold">No clusters found</p>
          <p className="mt-2 text-sm text-slate-500">
            {searchQuery
              ? "Try adjusting your search keywords."
              : "Upload scanned photos with faces under the Recognition tab to build clusters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {filteredPeople.map((person) => {
            const coverUrl = getCoverUrl(person);
            const isSelectedForMerge = selectedMergeIds.includes(person.cluster_id);
            return (
              <article
                key={person.cluster_id}
                onClick={() => handleCardClick(person)}
                className={`group relative cursor-pointer overflow-hidden rounded-[2rem] border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${
                  isMergeMode
                    ? isSelectedForMerge
                      ? "border-indigo-500 ring-4 ring-indigo-500/20 bg-indigo-50/10"
                      : "border-slate-200 bg-white opacity-70 hover:opacity-100"
                    : "border-slate-200 bg-white shadow-sm hover:border-slate-300"
                }`}
              >
                {/* Image Cover */}
                <div className="relative aspect-square w-full overflow-hidden bg-slate-100 border-b border-slate-100">
                  {coverUrl ? (
                    <BackendImage
                      src={coverUrl}
                      alt={person.label}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-200 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      No Face Image
                    </div>
                  )}
                  
                  {/* Selection Overlay in Merge Mode */}
                  {isMergeMode && (
                    <div className="absolute inset-0 bg-slate-900/10 flex items-start justify-end p-4">
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center border-2 shadow-md ${
                        isSelectedForMerge 
                          ? "bg-indigo-600 border-indigo-600 text-white font-bold text-sm"
                          : "bg-white border-slate-300"
                      }`}>
                        {isSelectedForMerge ? "✓" : ""}
                      </div>
                    </div>
                  )}

                  {/* Status Badge */}
                  {!isMergeMode && (
                    <span
                      className={`absolute top-4 left-4 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider shadow-sm ${
                        person.is_registered
                          ? "bg-emerald-500 text-white"
                          : "bg-amber-500 text-white"
                      }`}
                    >
                      {person.is_registered ? "Enrolled" : "Cluster"}
                    </span>
                  )}
                </div>

                {/* Details Footer */}
                <div className="p-5">
                  <h3 className="truncate text-lg font-bold text-slate-900 group-hover:text-amber-600 transition">
                    {person.label}
                  </h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold">{person.faces.length} photos</span>
                    <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 truncate max-w-[120px]">
                      {person.cluster_id}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Details Album Modal */}
      {selectedPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="flex h-full max-h-[90vh] sm:max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 bg-slate-50/50 p-6">
              <div className="flex gap-4 items-center min-w-0">
                {getCoverUrl(selectedPerson) && (
                  <BackendImage
                    src={getCoverUrl(selectedPerson)}
                    alt={selectedPerson.label}
                    className="h-16 w-16 rounded-2xl border border-slate-200 object-cover shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-black text-slate-900 truncate max-w-[180px] sm:max-w-xs md:max-w-md">
                      {selectedPerson.label}
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                        selectedPerson.is_registered
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {selectedPerson.is_registered ? "Registered" : "Unregistered"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 truncate">
                    Album ID: {selectedPerson.cluster_id} · {selectedPerson.faces.length} appearance{selectedPerson.faces.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedPerson(null);
                  setEnrollError("");
                  setEnrollName("");
                  setModalActionError("");
                }}
                className="rounded-full bg-white p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900 border border-slate-200 transition self-end sm:self-center shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Error messages inside modal */}
              {modalActionError && (
                <div className="rounded-xl bg-red-100 p-4 text-sm font-semibold text-red-700">
                  {modalActionError}
                </div>
              )}

              {/* Enrollment / Rename section for unregistered clusters */}
              {!selectedPerson.is_registered && (
                <div className="rounded-3xl border border-amber-200 bg-amber-50/40 p-5">
                  <h4 className="text-sm font-bold text-amber-800 uppercase tracking-wider">
                    Identify this Person
                  </h4>
                  <p className="mt-1 text-xs text-slate-600">
                    Add a name to enroll this cluster into the database. All historical and future matching frames of this face will automatically update to this name.
                  </p>
                  
                  {enrollError && (
                    <div className="mt-3 rounded-xl bg-red-100 p-3 text-xs font-semibold text-red-700">
                      {enrollError}
                    </div>
                  )}

                  <form onSubmit={handleEnroll} className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      placeholder="Enter name (e.g. Jane Doe)"
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-amber-400"
                      disabled={enrollLoading}
                      required
                    />
                    <button
                      type="submit"
                      className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 transition"
                      disabled={enrollLoading}
                    >
                      {enrollLoading ? "Enrolling..." : "Enroll Cluster"}
                    </button>
                  </form>
                </div>
              )}

              {/* Album Faces Gallery */}
              <div>
                <h4 className="text-lg font-bold text-slate-900">Album Detections</h4>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {selectedPerson.faces.map((face, index) => {
                    const faceCrop = getFaceCropUrl(face);
                    const isConfirmLoading = modalActionLoadingId === `confirm-${face.photo_scan_id}-${face.bbox.x1}`;
                    const isRemoveLoading = modalActionLoadingId === `remove-${face.photo_scan_id}-${face.bbox.x1}`;
                    return (
                      <div
                        key={`${face.photo_scan_id}-${index}`}
                        className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white hover:shadow-md"
                      >
                        {/* Dynamic Face Crop */}
                        <div
                          className="relative aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-100 bg-white"
                          onClick={() => setPreviewPhotoUrl(face.image_url)}
                        >
                          <BackendImage
                            src={faceCrop}
                            alt={`Detection ${index + 1}`}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition duration-300">
                            <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-slate-800">
                              View Full Photo
                            </span>
                          </div>
                        </div>

                        {/* Metadata Details */}
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span className="font-semibold truncate max-w-[120px]">
                              {face.photo_scan_filename || `Scan #${face.photo_scan_id}`}
                            </span>
                            <span className="bg-slate-200 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-700">
                              {(face.confidence * 100).toFixed(0)}% Match
                            </span>
                          </div>
                          
                          <p className="text-[10px] text-slate-400">
                            Scanned {new Date(face.photo_scan_created_at).toLocaleString()}
                          </p>

                          {/* Continuous Learning Control Buttons */}
                          <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2 text-[11px]">
                            {/* Confirm Match / Learning confirmation */}
                            {selectedPerson.is_registered && (
                              <div className="flex-1">
                                {face.is_confirmed ? (
                                  <span className="flex items-center justify-center gap-1 rounded bg-green-50 px-2 py-1 text-green-700 font-bold border border-green-200">
                                    ✓ Confirmed
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleConfirmFace(face)}
                                    disabled={!!modalActionLoadingId}
                                    className="w-full rounded bg-slate-900 px-2.5 py-1 text-white font-bold hover:bg-slate-700 disabled:opacity-50 transition"
                                  >
                                    {isConfirmLoading ? "Confirming..." : "Confirm Face"}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Remove Match / Unmatch */}
                            <button
                              onClick={() => handleRemoveMatch(face)}
                              disabled={!!modalActionLoadingId}
                              className="rounded border border-red-200 bg-red-50/50 px-2 py-1 text-red-600 font-bold hover:bg-red-50 hover:text-red-700 disabled:opacity-50 transition"
                              title="Remove Match (un-link from album)"
                            >
                              {isRemoveLoading ? "Removing..." : "Remove Match"}
                            </button>
                          </div>

                          {/* Variation details */}
                          {face.variation_handling && (
                            <div className="grid grid-cols-2 gap-1 pt-2 text-[9px]">
                              {[
                                ["Lighting", face.variation_handling.lighting],
                                ["Pose", face.variation_handling.pose],
                                ["Quality", face.variation_handling.camera_quality],
                                ["Occlusion", face.variation_handling.occlusion_risk],
                              ].map(([label, value]) => (
                                <div key={label} className="rounded bg-white p-1 border border-slate-200">
                                  <span className="block font-bold text-slate-400 uppercase tracking-wide">
                                    {label}
                                  </span>
                                  <span className="font-semibold text-slate-600 capitalize truncate block">
                                    {value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full size photo viewer overlay */}
      {previewPhotoUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setPreviewPhotoUrl(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-2xl bg-slate-900 border border-slate-800">
            <button
              onClick={() => setPreviewPhotoUrl(null)}
              className="absolute top-4 right-4 z-10 rounded-full bg-slate-900/80 p-2 text-white hover:bg-slate-800 transition"
            >
              ✕
            </button>
            <BackendImage
              src={previewPhotoUrl}
              alt="Full scan preview"
              className="max-h-[85vh] max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
