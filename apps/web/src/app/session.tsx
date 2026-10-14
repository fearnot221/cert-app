import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage, post, resetCsrf } from "../lib/api";
import type { Membership, Session } from "../lib/types";

type SessionState = {
  session: Session | null;
  loading: boolean;
  error: string;
  /** A message to show on the sign-in page, such as an expired session. */
  notice: string;
  setNotice: (notice: string) => void;
  refresh: () => Promise<Session | null>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);
const sessionKey = ["session"];

async function fetchSession(): Promise<Session | null> {
  try {
    return await api<Session>("/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: Infinity });
  const refresh = useCallback(async () => {
    const session = await queryClient.fetchQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: 0 });
    return session;
  }, [queryClient]);
  const logout = useCallback(async () => {
    await post("/auth/logout");
    resetCsrf();
    queryClient.clear();
    queryClient.setQueryData(sessionKey, null);
  }, [queryClient]);
  useEffect(() => {
    const expired = () => {
      resetCsrf();
      queryClient.setQueryData(sessionKey, null);
      setNotice("登入已逾期，請重新登入後繼續。");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [queryClient]);
  return (
    <SessionContext.Provider
      value={{
        session: query.data ?? null,
        loading: query.isPending,
        error: query.error ? errorMessage(query.error) : "",
        notice,
        setNotice,
        refresh,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/** Where a person lands after signing in: their first organization, or their own certificates. */
export function homePath(session: Session | null) {
  const first = session?.memberships[0]?.organization;
  return first ? workspacePath(first, "templates") : "/me";
}

/** Workspace pages live under the organization's short address, e.g. /zhixing/batches. */
export function workspacePath(organization: { slug: string }, path = "templates") {
  return `/${organization.slug}${path ? `/${path}` : ""}`;
}

export function findMembership(session: Session | null, slug?: string): Membership | undefined {
  return session?.memberships.find((m) => m.organization.slug === slug);
}
