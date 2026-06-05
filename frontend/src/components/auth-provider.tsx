"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AUTH_STORAGE_KEY, type AuthAccount } from "@/lib/auth";

type AuthContextValue = {
  account: AuthAccount | null;
  isHydrated: boolean;
  login: (nextAccount: AuthAccount) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AuthAccount | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (storedValue) {
      try {
        setAccount(JSON.parse(storedValue) as AuthAccount);
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
    setIsHydrated(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      isHydrated,
      login: (nextAccount) => {
        setAccount(nextAccount);
        window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAccount));
      },
      logout: () => {
        setAccount(null);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      },
    }),
    [account, isHydrated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}
