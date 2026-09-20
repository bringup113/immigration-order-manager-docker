/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Page<T> = { rows:T[]; hasMore:boolean; total:number;totalPages:number;owners:{id:string;name:string;username:string}[] };
export function useApiPage<T>(resource: string) {
  const [data,setData] = useState<Page<T>>({rows:[],hasMore:false,total:0,totalPages:1,owners:[]});
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current=controller;
    setLoading(true); setError("");
    try {
      const response=await fetch(`/api/data/${resource}`,{cache:"no-store",signal:controller.signal});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      if (!controller.signal.aborted) setData(Array.isArray(result) ? {rows:result,hasMore:false,total:result.length,totalPages:1,owners:[]} : result);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取失败"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  },[resource]);
  useEffect(() => { void reload(); return () => active.current?.abort(); },[reload]);
  return {...data,loading,error,reload};
}
export function useApiList<T>(resource:string) { return useApiPage<T>(resource); }

export async function apiPost(resource: string, payload: unknown) {
  const response = await fetch(`/api/data/${resource}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存失败");
  return data;
}
