"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/components/auth-provider";
import { getDefaultRouteForRole, isRouteAllowed, type AccountRole } from "@/lib/auth";

type AppShellProps = {
  children: React.ReactNode;
};

const NAV_ITEMS: Record<AccountRole, Array<{ href: string; label: string }>> = {
  admin: [
    { href: "/", label: "Dashboard" },
    { href: "/admin", label: "Admin Page" },
    { href: "/detections", label: "Detections Dashboard" },
    { href: "/dashboard/detection-history", label: "Detection History" },
    { href: "/people", label: "People" },
    { href: "/users", label: "Users" },
  ],
  user: [{ href: "/recognition", label: "Recognition" }],
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { account, isHydrated, logout } = useAuth();

  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!account) {
      if (!isLoginPage) {
        router.replace("/login");
      }
      return;
    }

    if (isLoginPage) {
      router.replace(getDefaultRouteForRole(account.role));
      return;
    }

    if (!isRouteAllowed(account.role, pathname)) {
      router.replace(getDefaultRouteForRole(account.role));
    }
  }, [account, isHydrated, isLoginPage, pathname, router]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#fef3c7,_#fff7ed_35%,_#f8fafc_70%)] px-6">
        <div className="rounded-[2rem] border border-amber-100 bg-white/90 px-8 py-6 text-sm font-medium text-slate-600 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          Loading workspace...
        </div>
      </div>
    );
  }

  if (!account) {
    return <main className="min-h-screen p-6 md:p-8">{children}</main>;
  }

  if (isLoginPage) {
    return null;
  }

  const navItems = NAV_ITEMS[account.role];
  const title = account.role === "admin" ? "Face Detection" : "";
  const subtitle =
    account.role === "admin"
      ? "Realtime monitoring, user enrollment, and system oversight."
      : "Open the camera and run live recognition from this device.";

  return (
    <div className="flex min-h-screen">
      <aside className="w-72 border-r border-amber-100 bg-white/85 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="border-b border-amber-100 px-6 py-8">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-600">
            {account.role === "admin" ? "Control Room" : "Recognition Portal"}
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>

        <div className="border-b border-amber-100 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Signed in as</p>
          <p className="mt-2 text-lg font-bold text-slate-900">{account.username}</p>
          <p className="mt-1 text-sm capitalize text-amber-700">{account.role}</p>
        </div>

        <nav className="mt-6 space-y-1 px-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-2xl px-4 py-3 text-sm font-medium transition ${isActive
                  ? "bg-amber-100 text-slate-900"
                  : "text-slate-700 hover:bg-amber-50 hover:text-slate-900"
                  }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pt-6">
          <button
            type="button"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
          >
            Log Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8">{children}</main>
    </div>
  );
}
