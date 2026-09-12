"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api-client";
import { clearTokens, isAuthenticated, setTokens } from "@/lib/auth";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    if (!isAuthenticated()) {
      setUser(null);
      setAuthError(null);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
      setAuthError(null);
      void import("@/services/modelRegistry").then(({ hydrateRegistryFromServer }) =>
        hydrateRegistryFromServer(),
      );
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status?: unknown }).status)
          : undefined;

      if (status === 401) {
        clearTokens();
        setUser(null);
        setAuthError(null);
        return;
      }

      // Keep the token on transient API failures.  Clearing it here used to
      // send users to /login after any timeout, restart, or brief network loss.
      console.warn("[Auth] Unable to validate the current session; keeping it for retry.", error);
      setAuthError("Unable to verify the session. Check the API connection and retry.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const finish = () => {
      if (!cancelled) setLoading(false);
    };

    if (!isAuthenticated()) {
      setUser(null);
      setAuthError(null);
      finish();
      return;
    }

    void refreshUser().finally(finish);

    const timer = window.setTimeout(finish, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refreshUser]);

  const login = useCallback(
    async (username: string, password: string) => {
      const tokens = await authApi.login({ username, password });
      setTokens(tokens);
      await refreshUser();
      router.push("/");
    },
    [refreshUser, router],
  );

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      await authApi.register({ email, username, password });
      await login(username, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    setAuthError(null);
    router.push("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, authError, login, register, logout, refreshUser }),
    [user, loading, authError, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, authError, refreshUser } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }

    if (!loading && !user && !authError) {
      router.replace("/login");
    }
  }, [mounted, loading, user, authError, router]);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!isAuthenticated()) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (!user && authError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
        <p>{authError}</p>
        <button
          type="button"
          onClick={() => void refreshUser()}
          className="rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
