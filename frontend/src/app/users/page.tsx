"use client";

import { useEffect, useRef, useState } from "react";
import { fetchBackend, useBackendUrl } from "@/lib/backend";
import { BackendImage } from "@/components/backend-image";


type User = {
  id: number;
  name: string;
  created_at: string;
  image_url?: string | null;
};

export default function UsersPage() {
  const backendUrl = useBackendUrl();
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!backendUrl) {
      return;
    }

    let active = true;

    const loadUsers = async () => {
      try {
        const res = await fetchBackend(`${backendUrl}/api/v1/users`);
        const data = await res.json();
        if (active) {
          setUsers(data);
        }
      } catch (err) {
        console.error("Failed to fetch users", err);
      }
    };

    void loadUsers();

    return () => {
      active = false;
    };
  }, [backendUrl]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !file) {
      setError("Please provide a name and an image.");
      return;
    }

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", file);

    try {
      const res = await fetchBackend(`${backendUrl}/api/v1/enroll`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Enrollment failed");
      }

      setName("");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      const refreshResponse = await fetchBackend(`${backendUrl}/api/v1/users`);
      const refreshedUsers = await refreshResponse.json();
      setUsers(refreshedUsers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure?")) {
      return;
    }

    try {
      await fetchBackend(`${backendUrl}/api/v1/users/${id}`, { method: "DELETE" });
      const refreshResponse = await fetchBackend(`${backendUrl}/api/v1/users`);
      const refreshedUsers = await refreshResponse.json();
      setUsers(refreshedUsers);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-amber-100 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-600">
          Users
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-tight text-slate-900">
          User Enrollment
        </h2>
        <p className="mt-4 max-w-3xl text-lg text-slate-600">
          Add a user name and image, store the upload information in the database, and
          make the records available to the admin page.
        </p>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] text-slate-900">
        <h3 className="mb-4 text-xl font-bold">Enroll New User</h3>
        {error && <div className="mb-4 text-red-500">{error}</div>}
        <form onSubmit={handleEnroll} className="flex flex-col items-end gap-4 md:flex-row">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border bg-white p-2 text-slate-900"
              placeholder="John Doe"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Face Image</label>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full rounded border bg-white p-2 text-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !backendUrl}
            className="rounded-full bg-slate-900 px-6 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Enrolling..." : "Enroll User"}
          </button>
        </form>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-white/90 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)] text-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">Enrolled Users</h3>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            {users.length} Total
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4"
            >
              {user.image_url ? (
                <BackendImage
                  src={user.image_url}
                  alt={user.name}
                  className="h-20 w-20 rounded-2xl object-cover"
                />

              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-200 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  No Photo
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold text-slate-900">{user.name}</p>
                <p className="mt-1 text-sm text-slate-500">User ID: {user.id}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Enrolled {new Date(user.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(user.id)}
                className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          ))}

          {users.length === 0 && (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500 lg:col-span-2">
              No users enrolled yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
