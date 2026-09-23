"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { safeReturnPath } from "@/lib/safe-return-path";

type UserContext = { user: ChatGPTUser; refresh: () => Promise<void> };
const Context = createContext<UserContext | null>(null);

export function CurrentUserProvider({
  initialUser,
  children,
}: {
  initialUser: ChatGPTUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const [user, setUser] = useState(initialUser);
  const pending = useRef<Promise<void> | null>(null);

  const redirectToLogin = useCallback(() => {
    const returnTo = safeReturnPath(
      `${window.location.pathname}${window.location.search}`,
    );
    router.replace(`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  }, [router]);

  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    pending.current = fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        if (response.ok) setUser(await response.json());
      })
      .catch(() => undefined)
      .finally(() => {
        pending.current = null;
      });
    return pending.current;
  }, [redirectToLogin]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("migra-user-changed", onFocus);
    window.addEventListener("migra-session-expired", redirectToLogin);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("migra-user-changed", onFocus);
      window.removeEventListener("migra-session-expired", redirectToLogin);
    };
  }, [refresh, redirectToLogin]);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      void refresh();
    }
  }, [pathname, refresh]);

  return (
    <Context.Provider value={{ user, refresh }}>{children}</Context.Provider>
  );
}

export function useCurrentUser() {
  const context = useContext(Context);
  if (!context) throw new Error("CurrentUserProvider is required");
  return context;
}
