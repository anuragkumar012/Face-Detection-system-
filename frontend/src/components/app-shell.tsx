"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { getDefaultRouteForRole, isRouteAllowed, type AccountRole } from "@/lib/auth";

type AppShellProps = {
  children: React.ReactNode;
};

const NAV_ITEMS: Record<AccountRole, Array<{ href: string; label: string; isSubItem?: boolean }>> = {
  admin: [

    { href: "/admin", label: "Admin Page" },
    { href: "/detections", label: "Detections Dashboard" },
    { href: "/monitoring-session-history", label: "Monitoring Session History", isSubItem: true },
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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

  // Close sidebar on navigation change (mobile)
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

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
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Mobile Header Bar */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-amber-100 bg-white/85 px-6 shadow-sm backdrop-blur lg:hidden">
        <div className="flex flex-col min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-600 truncate">
            {account.role === "admin" ? "Control Room" : "Recognition Portal"}
          </p>
          <h1 className="text-lg font-black tracking-tight text-slate-900 leading-none mt-1 truncate">
            {title || "Face Detection"}
          </h1>
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="rounded-xl border border-amber-100 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none"
          aria-label="Toggle menu"
        >
          {isSidebarOpen ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </header>

      {/* Sidebar aside */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-72 transform border-r border-amber-100 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 flex flex-col shrink-0
          ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="border-b border-amber-100 px-6 py-8 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-600">
            {account.role === "admin" ? "Control Room" : "Recognition Portal"}
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>



        <nav className="mt-6 flex-1 space-y-1 px-4 overflow-y-auto">
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

        <div className="px-4 py-6 border-t border-amber-50 shrink-0">
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

      {/* Backdrop overlay for mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-xs lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <main className="flex-1 p-4 sm:p-6 md:p-8 min-w-0">{children}</main>
    </div>
  );
}
