"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Starting a new cancellable search resets its visible request state. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, ArrowRight } from "lucide-react";
import { MobileCard, MobileMessage, MobilePermission } from "@/components/mobile/mobile-states";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { useCurrentUser } from "@/components/current-user-provider";
import { fetchApiJson, isAbortError } from "@/lib/api-client";
import type { GlobalSearchGroup, GlobalSearchResponse } from "@/lib/api-contracts";
import { orderDetailHref } from "@/lib/order-navigation";

const groups = [
  { key: "orders", label: "订单", permission: "orders.read" },
  { key: "projects", label: "项目", permission: "projects.read" },
  { key: "agents", label: "代理", permission: "agents.read" },
] as const;

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => { const value = key(row); if (seen.has(value)) return false; seen.add(value); return true; });
}

function MobileSearchContent() {
  const { user } = useCurrentUser();
  const can = (permission: string) => user.permissions.includes("*") || user.permissions.includes(permission);
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [data, setData] = useState<GlobalSearchResponse | null>(null);
  const [resultTerm, setResultTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [groupLoading, setGroupLoading] = useState<GlobalSearchGroup | null>(null);
  const [revision, setRevision] = useState(0);
  const pageController = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    pageController.current?.abort();
    let disposed = false;
    let request: AbortController | null = null;
    let timer: number | undefined;
    let attempt = 0;
    let needsRefresh = true;
    const deadline = Date.now() + 60000;
    setLoading(true);
    setNotice("");
    const stop = () => {
      needsRefresh = false;
      window.clearTimeout(timer);
      request?.abort();
      if (!disposed) { setLoading(false); setNotice("索引仍在同步，自动刷新已暂停。请稍后手动刷新。"); }
    };
    const deadlineTimer = window.setTimeout(() => { if (term && needsRefresh) stop(); }, 60000);
    const search = async () => {
      if (disposed || document.hidden || !needsRefresh) return;
      if (Date.now() >= deadline) { stop(); return; }
      request = new AbortController();
      const current = request;
      try {
        const result = await fetchApiJson<GlobalSearchResponse>(`/api/data/search?q=${encodeURIComponent(term)}`, { cache: "no-store", signal: current.signal });
        if (disposed || current.signal.aborted) return;
        setData(result);
        setResultTerm(term);
        setNotice("");
        setLoading(false);
        needsRefresh = Boolean(term && result.indexing);
        if (needsRefresh) {
          const delay = Math.min(8000, 1000 * 2 ** Math.min(attempt++, 3));
          if (Date.now() + delay < deadline) timer = window.setTimeout(() => void search(), delay);
          else stop();
        } else window.clearTimeout(deadlineTimer);
      } catch (reason) {
        if (disposed || current.signal.aborted || isAbortError(reason)) return;
        needsRefresh = false;
        window.clearTimeout(deadlineTimer);
        setLoading(false);
        setNotice(reason instanceof Error ? reason.message : "搜索失败，已有结果已保留。");
      }
    };
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.hidden) { request?.abort(); setLoading(false); }
      else if (needsRefresh && Date.now() < deadline) timer = window.setTimeout(() => void search(), 300);
      else if (needsRefresh) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    timer = window.setTimeout(() => void search(), 300);
    return () => {
      disposed = true;
      request?.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadlineTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [term, revision]);

  async function loadMore(group: GlobalSearchGroup) {
    const current = data?.pagination[group];
    if (!current?.hasMore || groupLoading || data?.indexing || !can(groups.find((item) => item.key === group)!.permission)) return;
    pageController.current?.abort();
    const controller = new AbortController();
    pageController.current = controller;
    setGroupLoading(group);
    try {
      const params = new URLSearchParams({ q: term, group, page: String(current.page + 1), pageSize: String(current.pageSize) });
      const result = await fetchApiJson<GlobalSearchResponse>(`/api/data/search?${params}`, { cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted) return;
      setData((old) => old ? ({
        ...old,
        [group]: group === "orders"
          ? dedupe([...old.orders, ...result.orders], (row) => row.order_no)
          : group === "projects"
            ? dedupe([...old.projects, ...result.projects], (row) => row.id)
            : dedupe([...old.agents, ...result.agents], (row) => row.id),
        pagination: { ...old.pagination, [group]: result.pagination[group] },
      }) : old);
      setNotice("");
    } catch (reason) {
      if (!controller.signal.aborted && !isAbortError(reason)) setNotice(reason instanceof Error ? reason.message : "加载更多失败");
    } finally { if (!controller.signal.aborted) setGroupLoading(null); }
  }

  useEffect(() => () => pageController.current?.abort(), [term]);
  const visibleData = data && (resultTerm === term || Boolean(notice)) ? data : null;

  return <MobileShell title="全局搜索">
    <div className="space-y-4">
      <label className="relative block"><span className="sr-only">全局搜索关键词</span><SearchIcon size={19} className="absolute left-3 top-3 text-slate-400" /><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="姓名+金额，或输入文件名、项目…" className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-teal-500" /></label>
      <p className="text-xs text-slate-500">用 + 连接多个关键词，可同时匹配订单的不同信息。</p>
      {notice && <MobileMessage tone="error">{notice} <button onClick={() => setRevision((value) => value + 1)} className="ml-2 font-semibold underline">刷新</button></MobileMessage>}
      {loading && !visibleData && <MobileMessage>正在搜索…</MobileMessage>}
      {visibleData?.indexing && term && <MobileMessage>最新修改正在同步，结果将自动更新。</MobileMessage>}
      {visibleData && groups.filter((group) => can(group.permission) && visibleData.pagination[group.key].loaded).map((group) => {
        const entries = visibleData[group.key];
        const page = visibleData.pagination[group.key];
        return <section key={group.key} className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-slate-700">{group.label} · {entries.length}</h2>
          {entries.map((item) => {
            const orderTarget = group.key === "orders" ? orderDetailHref((item as GlobalSearchResponse["orders"][number]).order_no, (item as GlobalSearchResponse["orders"][number]).target_tab, "mobile") : "";
            const href = group.key === "orders" ? `${orderTarget}${orderTarget.includes("?") ? "&" : "?"}from=search` : "";
            const title = group.key === "orders" ? `${(item as GlobalSearchResponse["orders"][number]).project_name} · ${(item as GlobalSearchResponse["orders"][number]).main_applicant || "未填写主申请人"}` : group.key === "projects" ? (item as GlobalSearchResponse["projects"][number]).name : (item as GlobalSearchResponse["agents"][number]).name;
            const detail = group.key === "orders" ? (item as GlobalSearchResponse["orders"][number]).match_summary : group.key === "projects" ? (item as GlobalSearchResponse["projects"][number]).country : (item as GlobalSearchResponse["agents"][number]).contact_name;
            const key = group.key === "orders" ? (item as GlobalSearchResponse["orders"][number]).order_no : (item as { id: string }).id;
            const card = <MobileCard className={`flex items-center gap-3 ${href ? "active:bg-teal-50" : ""}`}><div className="min-w-0 flex-1"><p className="font-semibold text-slate-800">{title}</p>{detail && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{detail}</p>}{!href && <p className="mt-2 text-[11px] font-medium text-slate-400">手机端仅显示搜索摘要</p>}</div>{href && <ArrowRight size={17} className="shrink-0 text-slate-400" />}</MobileCard>;
            return href ? <Link key={key} href={href} className="block">{card}</Link> : <div key={key}>{card}</div>;
          })}
          {entries.length === 0 && <p className="px-1 text-sm text-slate-400">暂无命中</p>}
          {page.hasMore && <button disabled={Boolean(groupLoading) || Boolean(visibleData.indexing) || resultTerm !== term} onClick={() => void loadMore(group.key)} className="w-full rounded-xl border border-slate-200 bg-white py-2 text-sm text-teal-700 disabled:opacity-50">{groupLoading === group.key ? "加载中…" : "继续查看"}</button>}
        </section>;
      })}
    </div>
  </MobileShell>;
}

export default function MobileSearchPage() {
  const { user } = useCurrentUser();
  const canRead = user.permissions.includes("*") || user.permissions.includes("orders.read");
  if (!canRead) return <MobileShell title="全局搜索"><MobilePermission /></MobileShell>;
  return <MobileSearchContent />;
}
