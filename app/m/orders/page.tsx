"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronRight } from "lucide-react";
import { MobileCard, MobileMessage, MobilePermission } from "@/components/mobile/mobile-states";
import { MobileShell } from "@/components/mobile/mobile-shell";
import type { OrderListRow } from "@/lib/api-contracts";
import { orderDetailHref } from "@/lib/order-navigation";
import { DEFAULT_ORDER_SORT, orderSortOptions } from "@/lib/order-sort";
import { useApiPage } from "@/lib/use-api";
import { usePermissions } from "@/lib/use-permissions";

const statusLabel: Record<string, string> = {
  DRAFT: "草稿", ACTIVE: "办理中", PAUSED: "暂停", COMPLETED: "已完成", CANCELLED: "已取消", REFUNDED: "已退款",
};

function nextOrderDate(order: OrderListRow) {
  return [
    order.current_step_due_date ? { label: "流程预计", date: order.current_step_due_date } : null,
    order.pending_follow_up_date ? { label: "待跟进", date: order.pending_follow_up_date } : null,
  ].filter((entry): entry is { label: string; date: string } => Boolean(entry)).sort((a, b) => a.date.localeCompare(b.date))[0];
}

function MobileOrdersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const can = usePermissions();
  const canReadOrders = can("orders.read");
  const q = params.get("q") || "";
  const requestedPage = Number(params.get("page") || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  const requestedSort = params.get("sort") || DEFAULT_ORDER_SORT;
  const sort = orderSortOptions.some((option) => option.value === requestedSort) ? requestedSort : DEFAULT_ORDER_SORT;
  const requestedStatus = params.get("status") || "";
  const status = requestedStatus in statusLabel ? requestedStatus : "";
  const restored = useRef("");
  const query = new URLSearchParams({ page: String(page), pageSize: "10", q, sort });
  if (status) query.set("status", status);
  const { rows, loading, error, total, totalPages, hasMore, reload } = useApiPage<OrderListRow>(`orders?${query}`, canReadOrders);
  const currentPath = `/m/orders${params.size ? `?${params}` : ""}`;

  useEffect(() => {
    if (loading || restored.current === currentPath) return;
    restored.current = currentPath;
    const saved = sessionStorage.getItem("migra-mobile-order-scroll");
    if (!saved) return;
    try {
      const value = JSON.parse(saved) as { path: string; top: number };
      if (value.path === currentPath && Number.isFinite(value.top)) requestAnimationFrame(() => window.scrollTo(0, value.top));
    } catch { /* Old browser storage is not navigation state. */ }
  }, [currentPath, loading]);

  function navigate(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    sessionStorage.removeItem("migra-mobile-order-scroll");
    router.push(`/m/orders?${next}`, { scroll: true });
  }

  return <MobileShell title="订单">
    {!canReadOrders ? <MobilePermission /> : <div className="space-y-4">
      <OrderSearchForm key={q} initialQuery={q} onSubmit={(value) => navigate({ q: value, page: "1" })} />
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="订单状态筛选">
        {([ ["", "全部"], ["ACTIVE", "办理中"], ["PAUSED", "暂停"], ["DRAFT", "草稿"], ["COMPLETED", "已完成"] ] as const).map(([value, label]) => <button key={value} onClick={() => navigate({ status: value, page: "1" })} aria-pressed={status === value} className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${status === value ? "bg-teal-700 text-white" : "bg-white text-slate-600"}`}>{label}</button>)}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">{loading ? "正在更新…" : `共 ${total} 张订单`}</p>
        <select aria-label="订单排序" value={sort} onChange={(event) => navigate({ sort: event.target.value, page: "1" })} className="max-w-[200px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700">
          {orderSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {error && <MobileMessage tone="error">{error} <button onClick={() => void reload()} className="ml-2 font-semibold underline">重试</button></MobileMessage>}
      {loading && rows.length === 0 && <MobileMessage>正在读取订单…</MobileMessage>}
      {!loading && !error && rows.length === 0 && <MobileMessage>没有符合条件的订单。</MobileMessage>}
      {!loading && !error && rows.length > 0 && <div className="space-y-3">
        {rows.map((order) => {
          const nextDate = nextOrderDate(order);
          return (
            <Link key={order.id} href={orderDetailHref(order.order_no, undefined, "mobile")}
              onClick={() => sessionStorage.setItem("migra-mobile-order-scroll", JSON.stringify({ path: currentPath, top: window.scrollY }))}>
              <MobileCard className="active:border-teal-300 active:bg-teal-50">
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-slate-900">{order.main_applicant || "未填写主申请人"}</p>
                  <p className="mt-1 truncate text-sm text-slate-600">{order.project_name}</p>
                </div><span className="shrink-0 rounded-full bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700">{statusLabel[order.status] || order.status}</span></div>
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600"><span className="min-w-0 flex-1 truncate">{order.current_step || (Number(order.total_steps) ? "办理流程已结束" : "尚未设置流程")}</span><ChevronRight size={17} className="shrink-0 text-slate-400" /></div>
                {nextDate && <p className="mt-1 text-xs text-slate-500">{nextDate.label} {nextDate.date}</p>}
              </MobileCard>
            </Link>
          );
        })}
      </div>}
      {total > 0 && <div className="flex items-center justify-between gap-3 pb-2">
        <button disabled={loading || page <= 1} onClick={() => navigate({ page: String(page - 1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">上一页</button>
        <span className="text-xs text-slate-500">{page} / {totalPages}</span>
        <button disabled={loading || !hasMore} onClick={() => navigate({ page: String(page + 1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">下一页</button>
      </div>}
    </div>}
  </MobileShell>;
}

function OrderSearchForm({ initialQuery, onSubmit }: { initialQuery: string; onSubmit: (query: string) => void }) {
  const [draft, setDraft] = useState(initialQuery);
  function submit(event: FormEvent) { event.preventDefault(); onSubmit(draft.trim()); }
  return <form onSubmit={submit} className="flex gap-2">
    <label className="relative min-w-0 flex-1"><span className="sr-only">搜索订单</span><Search size={18} className="absolute left-3 top-3 text-slate-400" /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="项目、申请人、代理或办理内容" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-teal-500" /></label>
    <button className="rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white">搜索</button>
  </form>;
}

export default function MobileOrdersPage() {
  return <Suspense fallback={<MobileShell title="订单"><MobileMessage>正在读取订单…</MobileMessage></MobileShell>}><MobileOrdersContent /></Suspense>;
}
