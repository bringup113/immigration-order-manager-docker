/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PageResponse } from "@/lib/api-contracts";
import { fetchApiJson, isAbortError } from "@/lib/api-client";

type ApiPage<T> = PageResponse<T>;

const emptyPage = <T,>(): ApiPage<T> => ({
  rows: [],
  page: 1,
  pageSize: 30,
  hasMore: false,
  total: 0,
  totalPages: 1,
  owners: [],
});

export function useApiPage<T>(resource: string, enabled = true) {
  const [data, setData] = useState<ApiPage<T>>(emptyPage<T>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    active.current?.abort();
    if (!enabled) {
      setData(emptyPage<T>());
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await fetchApiJson<ApiPage<T> | T[]>(
        `/api/data/${resource}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setData(
        Array.isArray(result)
          ? {
              ...emptyPage<T>(),
              rows: result,
              total: result.length,
              pageSize: Math.max(1, result.length),
            }
          : result,
      );
    } catch (reason) {
      if (!controller.signal.aborted && !isAbortError(reason))
        setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [resource, enabled]);

  useEffect(() => {
    void reload();
    return () => active.current?.abort();
  }, [reload]);
  return { ...data, loading, error, reload };
}

export function useApiList<T>(resource: string) {
  return useApiPage<T>(resource);
}

export function apiPost<T = unknown>(resource: string, payload: unknown) {
  return fetchApiJson<T>(`/api/data/${resource}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
