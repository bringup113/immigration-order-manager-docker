"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RotateCw, CircleDollarSign, HandCoins, ListChecks, MessageSquareText, FileText, ClipboardCheck } from "lucide-react";
import { MobileMessage, MobilePermission } from "@/components/mobile/mobile-states";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { usePermissions } from "@/lib/use-permissions";
import { fetchApiJson, isAbortError } from "@/lib/api-client";
import type { Dashboard, ReminderType } from "@/lib/dashboard-contracts";
import { orderDetailHref } from "@/lib/order-navigation";
import { formatMoney } from "@/lib/amount";

const appearances = {
  RECEIPT: { icon: CircleDollarSign, color: "bg-amber-50 text-amber-700" },
  PAYMENT: { icon: HandCoins, color: "bg-blue-50 text-blue-700" },
  STEP: { icon: ListChecks, color: "bg-teal-50 text-teal-700" },
  FOLLOW_UP: { icon: MessageSquareText, color: "bg-orange-50 text-orange-700" },
  MATERIAL: { icon: FileText, color: "bg-rose-50 text-rose-700" },
  TASK: { icon: ClipboardCheck, color: "bg-cyan-50 text-cyan-700" },
} as const satisfies Record<ReminderType, { icon: typeof CircleDollarSign; color: string }>;

type Range = "all" | "overdue" | "today" | "week";

export default function MobileHome() {
  const can = usePermissions();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("all");
  const [displayedRange, setDisplayedRange] = useState<Range | null>(null);
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => setRevision((value) => value + 1), []);
  const canReadDashboard = can("dashboard.read");

  useEffect(() => {
    if (!canReadDashboard) return;
    const controller = new AbortController();
    fetchApiJson<Dashboard>(`/api/data/dashboard?range=${range}`, { cache: "no-store", signal: controller.signal })
      .then((result) => { setData(result); setDisplayedRange(range); setError(""); })
      .catch((reason) => {
        if (!isAbortError(reason)) setError(reason instanceof Error ? reason.message : "读取提醒失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canReadDashboard, range, revision]);

  const counts = data?.reminderCounts;
  const todayKey = counts?.todayKey || "";
  const reminders = displayedRange === range ? data?.reminders ?? [] : [];
  const rangeTotal = range === "all" ? (counts?.overdue ?? 0) + (counts?.today ?? 0) + (counts?.week ?? 0) : counts?.[range] ?? 0;

  return <MobileShell title="工作台" action={<button onClick={load} aria-label="刷新提醒" className="grid size-10 place-items-center rounded-xl text-teal-700 active:bg-teal-50"><RotateCw size={19} /></button>}>
    {!canReadDashboard ? <MobilePermission /> : <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold tracking-widest text-teal-700">MIGRA · 移民订单</p>
        <h2 className="mt-1 text-2xl font-semibold">需要处理的事</h2>
        <p className="mt-1 text-sm text-slate-500">先看逾期与今天，再安排未来 7 天</p>
      </div>
      {error && <MobileMessage tone="error">{error} <button onClick={load} className="ml-2 font-semibold underline">重试</button></MobileMessage>}
      {loading && !data && <MobileMessage>正在读取提醒…</MobileMessage>}
      {data && <>
        <div className="grid grid-cols-3 gap-2" aria-label="待办数量">
          {([ ["overdue", "逾期"], ["today", "今天"], ["week", "未来 7 天"] ] as const).map(([key, label]) =>
            <button key={key} onClick={() => setRange(key)} aria-pressed={range === key} className={`rounded-2xl border p-3 text-left ${range === key ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white"}`}>
              <span className="block text-xs text-slate-500">{label}</span><span className={`mt-2 block text-2xl font-semibold tabular-nums ${key === "overdue" && Number(counts?.overdue) ? "text-rose-700" : "text-slate-900"}`}>{counts?.[key] ?? "—"}</span>
            </button>) }
        </div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-800">{range === "all" ? "全部待办" : range === "overdue" ? "逾期待办" : range === "today" ? "今天待办" : "未来 7 天待办"} · {rangeTotal}</h3>
          {range !== "all" && <button onClick={() => setRange("all")} className="text-xs font-semibold text-teal-700">查看全部</button>}
        </div>
        {displayedRange !== range ? (error ? null : <MobileMessage>正在读取待办…</MobileMessage>) : reminders.length === 0 ? <MobileMessage>当前范围内没有待办提醒。</MobileMessage> :
          <div className="space-y-3">{reminders.map((item, index) => {
            const appearance = appearances[item.reminder_type] ?? appearances.STEP;
            const Icon = appearance.icon;
                const target = orderDetailHref(item.order_no, item.target_tab, "mobile");
                return <Link key={`${item.order_no}-${item.source}-${index}`} href={`${target}${target.includes("?") ? "&" : "?"}from=dashboard`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:bg-teal-50">
              <div className="flex items-start gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${appearance.color}`}><Icon size={19} /></span>
                <div className="min-w-0 flex-1"><p className="text-sm text-slate-600">{item.main_applicant || "未填写主申请人"} · {item.project_name}</p><p className="mt-1 font-semibold text-slate-800">{item.title}</p><p className={`mt-2 text-xs ${item.due_date < todayKey ? "font-semibold text-rose-700" : "text-slate-500"}`}>{item.due_date < todayKey ? "已逾期 · " : item.due_date === todayKey ? "今天到期 · " : "预计 · "}{item.due_date}</p></div>
                <ArrowRight size={17} className="mt-2 shrink-0 text-slate-400" />
              </div>
            </Link>;
          })}</div>}
        {displayedRange === range && rangeTotal > reminders.length && <p className="text-center text-xs text-slate-500">当前显示最早 {reminders.length} 项，完整数量见上方</p>}
        <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm"><summary className="cursor-pointer font-semibold text-slate-700">订单概况</summary><div className="mt-3 space-y-2 text-slate-600">{data.access.orders && <p>在办订单：{data.activeOrders}</p>}{data.access.finance && <><p>待收款：折合 {formatMoney("USD", data.receivableMinor)}</p><p>待付款：折合 {formatMoney("USD", data.payableMinor)}</p></>}</div></details>
      </>}
    </div>}
  </MobileShell>;
}
