"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  CircleDollarSign,
  FileText,
  HandCoins,
  ListChecks,
  MessageSquareText,
  ClipboardCheck,
  Plus,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/amount";
import { fetchApiJson } from "@/lib/api-client";
import type { Dashboard, ReminderType } from "@/lib/dashboard-contracts";
import { orderDetailHref } from "@/lib/order-navigation";

const reminderAppearance: Record<ReminderType, { icon: LucideIcon; tone: string }> = {
  RECEIPT: { icon: CircleDollarSign, tone: "bg-[#fff5dc] text-[#b7791f]" },
  PAYMENT: { icon: HandCoins, tone: "bg-[#edf3ff] text-[#4361a8]" },
  STEP: { icon: ListChecks, tone: "bg-blue-50 text-blue-700" },
  FOLLOW_UP: { icon: MessageSquareText, tone: "bg-amber-50 text-amber-700" },
  MATERIAL: { icon: FileText, tone: "bg-rose-50 text-rose-700" },
  TASK: { icon: ClipboardCheck, tone: "bg-cyan-50 text-cyan-700" },
};

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchApiJson<Dashboard>("/api/data/dashboard", { cache: "no-store" })
      .then(setData)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "读取失败"),
      );
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="订单总览"
        title="今天的订单与收付款情况"
        description="只统计订单内登记的实际收款和付款"
        action={
          data?.access.ordersWrite ? <Button asChild className="bg-[#0f766e]">
            <Link href="/orders/new"><Plus size={16} /> 新增订单</Link>
          </Button> : null
        }
      />
      {error && <ErrorState message={error} />}
      {!data ? <LoadingState /> : <>
        <section className={`grid gap-4 sm:grid-cols-2 ${data.access.finance ? "xl:grid-cols-4" : "xl:grid-cols-1"}`}>
          {data.access.orders && <Metric label="在办订单" value={String(data.activeOrders)} note="办理中与暂停订单" icon={BriefcaseBusiness} tone="teal" />}
          {data.access.finance && <><Metric label="待收款" value={formatMoney("USD", data.receivableMinor)} note="应收计划减已关联收款" icon={CircleDollarSign} tone="amber" />
          <Metric label="待付款" value={formatMoney("USD", data.payableMinor)} note="应付计划减已关联付款" icon={HandCoins} tone="blue" />
          <Metric label="订单利润" value={formatMoney("USD", data.balanceMinor)} note="全部实际收款减实际付款" icon={Scale} tone="green" /></>}
        </section>

        <section className={`mt-5 grid gap-5 ${data.access.finance ? "xl:grid-cols-[1.35fr_1fr]" : "xl:grid-cols-1"}`}>
          {data.access.finance && <article className="panel p-5 sm:p-6">
            <h2 className="section-title">近 6 个月订单实际收支</h2>
            <p className="section-subtitle">按每笔记录保存时的汇率折算为 USD</p>
            {data.trend.length === 0 ? (
              <div className="mt-6 flex h-52 items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">在订单中登记收款或付款后，这里会显示月度趋势。</div>
            ) : (
              <div className="mt-6 space-y-4">{data.trend.map((row) => {
                const max = Math.max(...data.trend.flatMap((item) => [Number(item.income_minor), Number(item.expense_minor)]), 1);
                return <div key={row.month} className="grid grid-cols-[72px_1fr] items-center gap-3">
                  <span className="text-xs text-slate-500">{row.month}</span>
                  <div className="space-y-2">
                    <Bar label="收款" value={Number(row.income_minor)} max={max} teal />
                    <Bar label="付款" value={Number(row.expense_minor)} max={max} />
                  </div>
                </div>;
              })}</div>
            )}
          </article>}

          <article id="reminders" className="panel scroll-mt-24 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div><h2 className="section-title">近期提醒</h2><p className="section-subtitle">按日期先后排列</p></div>
              <span className="text-sm font-medium text-teal-700">{data.reminders.length} 项</span>
            </div>
            {data.reminders.length === 0 ? <p className="mt-8 text-center text-sm text-slate-400">暂无待办日期</p> : (
              <div className="mt-5 space-y-3">{data.reminders.slice(0, 7).map((item, index) => {
                const appearance = reminderAppearance[item.reminder_type] ?? reminderAppearance.STEP;
                const ReminderIcon = appearance.icon;
                const overdue = new Date(`${item.due_date}T23:59:59`) < new Date();
                return <Link
                  href={orderDetailHref(item.order_no, item.target_tab)}
                  key={`${item.order_no}-${item.source}-${index}`}
                  className="todo-row group transition-colors hover:border-teal-200 hover:bg-teal-50/30"
                >
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${appearance.tone}`} aria-hidden="true">
                    <ReminderIcon size={18} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">{item.title || "待跟进"}</p>
                      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-slate-500">{item.source}</Badge>
                    </div>
                    <p className="truncate text-xs text-slate-500">{item.project_name} · {item.main_applicant || "未填写主申请人"}</p>
                  </div>
                  <span className={`shrink-0 text-xs tabular-nums ${overdue ? "font-medium text-rose-600" : "text-slate-400"}`}>{item.due_date}</span>
                </Link>;
              })}</div>
            )}
          </article>
        </section>

      </>}
    </AppShell>
  );
}

function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: LucideIcon; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div className="mt-5 text-sm text-slate-500">{label}</div><div className="mt-1 text-[27px] font-semibold tracking-tight tabular-nums">{value}</div><div className="mt-2 text-xs text-slate-500">{note}</div></article>;
}

function Bar({ label, value, max, teal = false }: { label: string; value: number; max: number; teal?: boolean }) {
  return <div className="flex items-center gap-2"><span className="w-8 text-[10px] text-slate-400">{label}</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${teal ? "bg-teal-500" : "bg-slate-600"}`} style={{ width: `${Math.max(2, (value / max) * 100)}%` }} /></div><span className="w-24 text-right text-xs tabular-nums">{formatMoney("USD", value)}</span></div>;
}
