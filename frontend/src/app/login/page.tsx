"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { fetchBackend, useBackendUrl } from "@/lib/backend";
import { getDefaultRouteForRole, type AccountRole, type AuthAccount } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const backendUrl = useBackendUrl();
  const { login } = useAuth();

  const [role, setRole] = useState<AccountRole>("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!backendUrl) {
      setError("Backend URL is not configured yet.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetchBackend(`${backendUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          role,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || "Login failed.");
      }

      const account = (await response.json()) as AuthAccount;
      login(account);
      router.replace(getDefaultRouteForRole(account.role));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2.5rem] border border-amber-100 bg-white/90 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] md:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-600">
            Secure Access
          </p>
          <h1 className="mt-5 text-5xl font-black tracking-tight text-slate-900">
            Face Recognition Workspace
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Sign in as an admin to manage the dashboard, monitoring page, and enrolled users.
          </p>

          <div className="mt-8">
            <div className="rounded-[1.75rem] border border-slate-200 bg-amber-50/70 p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">
                Admin Privileges
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Dashboard visibility, live monitoring, device management, and user enrollment tools.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[2.5rem] border border-slate-200 bg-white/95 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] md:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-500">
            Login
          </p>
          <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
            Sign in to your account
          </h2>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Username</label>
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-300"
                placeholder="admin"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-300"
                placeholder="admin123"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !backendUrl}
              className="w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Signing In..." : "Sign In"}
            </button>
          </form>

          <div className="mt-6 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm text-slate-500">
            Demo default: admin / admin123
          </div>
        </section>
      </div>
    </div>
  );
}
