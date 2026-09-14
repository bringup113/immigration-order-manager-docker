"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ChatGPTUser } from "@/app/chatgpt-auth";

type UserContext = { user: ChatGPTUser; refresh: () => Promise<void> };
const Context = createContext<UserContext | null>(null);
export function CurrentUserProvider({initialUser,children}:{initialUser:ChatGPTUser;children:React.ReactNode}) {
  const router=useRouter();
  const pathname=usePathname();
  const previousPath=useRef(pathname);
  const [user,setUser]=useState(initialUser);
  const pending=useRef<Promise<void> | null>(null);
  const refresh=useCallback(() => {
    if (pending.current) return pending.current;
    pending.current=fetch("/api/auth/me",{cache:"no-store"}).then(async response => {
      if (response.status===401) { router.replace("/api/auth/login"); return; }
      if (response.ok) setUser(await response.json());
    }).catch(() => undefined).finally(() => {pending.current=null;});
    return pending.current;
  },[router]);
  useEffect(() => {
    const onFocus=() => {if(document.visibilityState==="visible") void refresh();};
    document.addEventListener("visibilitychange",onFocus);
    window.addEventListener("migra-user-changed",onFocus);
    return () => {document.removeEventListener("visibilitychange",onFocus);window.removeEventListener("migra-user-changed",onFocus);};
  },[refresh]);
  useEffect(() => {
    if(previousPath.current!==pathname){previousPath.current=pathname;void refresh();}
  },[pathname,refresh]);
  return <Context.Provider value={{user,refresh}}>{children}</Context.Provider>;
}
export function useCurrentUser() {
  const context=useContext(Context);
  if (!context) throw new Error("CurrentUserProvider is required");
  return context;
}
