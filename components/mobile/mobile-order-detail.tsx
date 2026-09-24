"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Route changes reset the cancellable detail request and browser back target. */

import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  FolderOpen,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MobileMessage, MobilePermission } from "@/components/mobile/mobile-states";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { MobileWorkflowActions } from "@/components/mobile/mobile-workflow-actions";
import { MobileCashActions } from "@/components/mobile/mobile-cash-actions";
import { MobileMaterials } from "@/components/mobile/mobile-materials";
import { useCurrentUser } from "@/components/current-user-provider";
import type { OrderDetailData } from "@/components/order-detail-types";
import type { Row } from "@/components/order-detail-ui";
import type { OrderDetailTab } from "@/lib/api-contracts";
import { fetchApiJson, isAbortError } from "@/lib/api-client";
import { formatMoney } from "@/lib/amount";
import { orderDetailHref } from "@/lib/order-navigation";

const tabs: Array<{
  value: OrderDetailTab;
  label: string;
  shortLabel: string;
  permission: string;
  icon: LucideIcon;
}> = [
  { value: "workflow", label: "办理与跟进", shortLabel: "办理", permission: "orders.read", icon: ClipboardList },
  { value: "finance", label: "订单收支", shortLabel: "收支", permission: "finance.read", icon: Wallet },
  { value: "people", label: "申请人与材料", shortLabel: "申请人", permission: "orders.read", icon: Users },
  { value: "common", label: "合同与付款", shortLabel: "合同", permission: "materials.read", icon: FolderOpen },
];

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "办理中",
  PAUSED: "暂停",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
};
const stepStatus: Record<string, string> = {
  NOT_STARTED: "未开始",
  PENDING: "未开始",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
};

function value(row: Row, key: string) {
  return String(row[key] ?? "");
}

function number(row: Row, key: string) {
  return Number(row[key] ?? 0);
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {detail && <span className="text-xs text-slate-400">{detail}</span>}
    </div>
  );
}

export function MobileOrderDetail({
  orderNo,
  requestedTab,
  source,
  dashboardRange,
}: {
  orderNo: string;
  requestedTab: OrderDetailTab;
  source?: "search" | "dashboard";
  dashboardRange?: "overdue" | "today" | "week";
}) {
  const { user } = useCurrentUser();
  const can = (permission: string) =>
    user.permissions.includes("*") || user.permissions.includes(permission);
  const tab: OrderDetailTab =
    (requestedTab === "finance" && !can("finance.read")) ||
    (requestedTab === "common" && !can("materials.read"))
      ? "workflow"
      : requestedTab;
  const [data, setData] = useState<OrderDetailData | null>(null);
  const [dataSection, setDataSection] = useState<OrderDetailTab | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [cashPage, setCashPage] = useState(1);
  const [backHref, setBackHref] = useState(
    source === "search" ? "/m/search" : source === "dashboard" && dashboardRange ? `/m?range=${dashboardRange}` : source === "dashboard" ? "/m" : "/m/orders",
  );
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (source) return;
    const saved = sessionStorage.getItem("migra-mobile-order-scroll");
    if (!saved) return;
    try {
      const path = (JSON.parse(saved) as { path?: string }).path;
      if (path?.startsWith("/m/orders?") || path === "/m/orders") setBackHref(path);
    } catch {
      // Ignore stale browser state.
    }
  }, [source]);

  useEffect(() => {
    if (!can("orders.read")) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      section: tab,
      surface: "mobile",
      historyPage: String(historyPage),
      cashPage: String(cashPage),
      cashStatus: "active",
    });
    setLoading(true);
    setError("");
    fetchApiJson<OrderDetailData>(
      `/api/orders/${encodeURIComponent(orderNo)}?${params}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then((result) => {
        setData(result);
        setDataSection(tab);
      })
      .catch((reason) => {
        if (!isAbortError(reason)) {
          setError(reason instanceof Error ? reason.message : "读取订单失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The API independently checks permission and order scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNo, tab, historyPage, cashPage, revision]);

  const order = data?.order;
  const sectionReady = Boolean(data && dataSection === tab);
  const mainApplicant = data?.applicants.find((item) => item.applicant_type === "MAIN");
  const completedSteps =
    data?.steps.filter((item) => item.status === "COMPLETED" || item.status === "SKIPPED").length ?? 0;
  const currentStep = data?.steps.find((item) => item.status === "IN_PROGRESS") ??
    data?.steps.find((item) => item.status === "PENDING" || item.status === "NOT_STARTED");
  const sum = (rows: Row[], key: string) =>
    rows.reduce((total, item) => total + number(item, key), 0);
  const receivable = data?.plans.filter((item) => item.plan_type === "RECEIVABLE") ?? [];
  const payable = data?.plans.filter((item) => item.plan_type === "PAYABLE") ?? [];
  const sortedPlans = [...(data?.plans ?? [])].sort((left, right) => {
    const leftRemaining = Math.max(0, number(left, "planned_amount_minor") - number(left, "allocated_minor"));
    const rightRemaining = Math.max(0, number(right, "planned_amount_minor") - number(right, "allocated_minor"));
    if (Boolean(leftRemaining) !== Boolean(rightRemaining)) return leftRemaining ? -1 : 1;
    return value(left, "due_date").localeCompare(value(right, "due_date"));
  });
  const showWorkflowActions = Boolean(sectionReady && tab === "workflow" && can("orders.write"));
  const showFinanceActions = Boolean(sectionReady && tab === "finance" && can("finance.write"));
  const hasBottomActions = showWorkflowActions || showFinanceActions;
  const visibleTabs = tabs.filter((item) => can(item.permission));

  const mobileTabHref = (nextTab: OrderDetailTab) => {
    const target = orderDetailHref(orderNo, nextTab, "mobile");
    if (!source) return target;
    const context = new URLSearchParams({ from: source });
    if (source === "dashboard" && dashboardRange) context.set("range", dashboardRange);
    return `${target}${target.includes("?") ? "&" : "?"}${context}`;
  };

  return (
    <MobileShell title="订单" backHref={backHref}>
      {!can("orders.read") ? (
        <MobilePermission />
      ) : (
        <div className="-mx-4 -mt-4">
          {error && !data && (
            <div className="p-4">
              <MobileMessage tone="error">
                {error}{" "}
                <button
                  onClick={() => setRevision((current) => current + 1)}
                  className="ml-2 font-semibold underline"
                >
                  重试
                </button>
              </MobileMessage>
            </div>
          )}
          {loading && !data && (
            <div className="p-4">
              <MobileMessage>正在读取订单…</MobileMessage>
            </div>
          )}
          {order && (
            <>
              <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-teal-900 px-4 pb-5 pt-4 text-white">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium tracking-wide text-teal-200">
                      {value(order, "order_no") || orderNo}
                    </p>
                    <h2 className="mt-1 truncate text-2xl font-semibold">
                      {value(mainApplicant ?? {}, "name") || "未填写主申请人"}
                    </h2>
                    <p className="mt-1 truncate text-sm text-slate-200">
                      {value(order, "project_name_snapshot")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-teal-50 ring-1 ring-white/15">
                    {statusLabel[value(order, "status")] || value(order, "status")}
                  </span>
                </div>
                <p className="mt-4 text-xs text-slate-300">
                  负责人：{value(order, "owner_name") || "未分配"}
                </p>
              </section>

              <nav
                aria-label="订单详情模块"
                className="sticky top-14 z-10 grid border-b border-slate-200 bg-white/95 px-1 backdrop-blur"
                style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
              >
                {visibleTabs.map((item) => {
                    const Icon = item.icon;
                    const active = tab === item.value;
                    return (
                      <Link
                        key={item.value}
                        href={mobileTabHref(item.value)}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                          active ? "text-teal-700" : "text-slate-500"
                        }`}
                      >
                        <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                        {item.shortLabel}
                        {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-teal-600" />}
                      </Link>
                    );
                  })}
              </nav>

              <div className={`space-y-4 px-4 py-4 ${hasBottomActions ? "pb-32" : ""}`}>
                {error && (
                  <MobileMessage tone="error">
                    {error}{" "}
                    <button
                      onClick={() => setRevision((current) => current + 1)}
                      className="ml-2 font-semibold underline"
                    >
                      重试
                    </button>
                  </MobileMessage>
                )}
                {loading && sectionReady && (
                  <p role="status" className="text-center text-xs text-slate-500">
                    正在更新模块…
                  </p>
                )}
                {loading && !sectionReady && <MobileMessage>正在读取当前模块…</MobileMessage>}

                {showWorkflowActions && data && (
                  <MobileWorkflowActions
                    orderNo={orderNo}
                    order={order}
                    steps={data.steps}
                    readPending={loading || Boolean(error)}
                    onReload={() => {
                      setHistoryPage(1);
                      setRevision((current) => current + 1);
                    }}
                  />
                )}

                {showFinanceActions && data && (
                  <MobileCashActions
                    orderNo={orderNo}
                    version={number(order, "version")}
                    plans={data.plans}
                    currencies={data.availableCurrencies ?? []}
                    readPending={loading || Boolean(error)}
                    onReload={() => {
                      setCashPage(1);
                      setRevision((current) => current + 1);
                    }}
                  />
                )}

                {!error && sectionReady && data && tab === "workflow" && (
                  <div className="space-y-4">
                    <section className="overflow-hidden rounded-2xl bg-white">
                      <SectionHeading
                        title="办理流程"
                        detail={`已完成 ${completedSteps}/${data.steps.length}`}
                      />
                      {data.steps.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-slate-500">尚未设置流程。</p>
                      ) : (
                        <div className="p-4">
                          {currentStep ? (
                            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
                              <p className="text-xs font-semibold tracking-wide text-teal-700">当前步骤</p>
                              <p className="mt-2 text-lg font-semibold text-teal-950">{value(currentStep, "name")}</p>
                              <p className="mt-2 text-sm text-teal-800">
                                {stepStatus[value(currentStep, "status")] || value(currentStep, "status")}
                                {currentStep.due_date ? ` · 预计 ${value(currentStep, "due_date")}` : " · 未设日期"}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">全部办理步骤已完成。</div>
                          )}
                          <details className="mt-3 rounded-xl border border-slate-200">
                            <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-700">
                              查看完整流程 · {data.steps.length} 步
                            </summary>
                            <ol className="border-t border-slate-100">
                              {data.steps.map((step) => {
                                const status = value(step, "status");
                                const active = status === "IN_PROGRESS";
                                const finished = status === "COMPLETED" || status === "SKIPPED";
                                const StepIcon = finished ? CheckCircle2 : active ? CircleDot : Circle;
                                return (
                                  <li key={value(step, "id")} className={`flex gap-3 border-t border-slate-100 px-4 py-3 first:border-0 ${active ? "bg-teal-50/70" : ""}`}>
                                    <StepIcon size={19} className={`mt-0.5 shrink-0 ${finished ? "text-teal-600" : active ? "text-blue-600" : "text-slate-300"}`} />
                                    <div className="min-w-0 flex-1">
                                      <p className={`font-medium ${active ? "text-teal-950" : "text-slate-800"}`}>{value(step, "name")}</p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        {stepStatus[status] || status}{step.due_date ? ` · 预计 ${value(step, "due_date")}` : ""}
                                      </p>
                                    </div>
                                  </li>
                                );
                              })}
                            </ol>
                          </details>
                        </div>
                      )}
                    </section>

                    {can("tasks.read") && (
                      <details className="overflow-hidden rounded-2xl bg-white">
                        <summary className="cursor-pointer list-none px-4 py-4 font-semibold text-slate-900">
                          待办事项 <span className="ml-1 text-xs font-normal text-slate-400">{data.tasks.length} 项</span>
                        </summary>
                        <div className="border-t border-slate-100 px-4 pb-2">
                          {data.tasks.length ? (
                            data.tasks.map((task) => (
                              <div key={value(task, "id")} className="border-t border-slate-100 py-3 first:border-0">
                                <p className="text-sm font-medium">{value(task, "title")}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {value(task, "due_date")} · {value(task, "owner_name")}
                                </p>
                              </div>
                            ))
                          ) : (
                            <p className="py-4 text-sm text-slate-500">暂无待办。</p>
                          )}
                        </div>
                      </details>
                    )}

                    <details className="overflow-hidden rounded-2xl bg-white">
                      <summary className="cursor-pointer list-none px-4 py-4 font-semibold text-slate-900">
                        跟进记录 <span className="ml-1 text-xs font-normal text-slate-400">· 本页 {data.progress.length} 条</span>
                      </summary>
                      <div className="border-t border-slate-100 px-4 pb-3">
                        {data.progress.length ? (
                          data.progress.map((entry) => (
                            <div key={value(entry, "id")} className="border-t border-slate-100 py-3 text-sm first:border-0">
                              <p className="font-medium">{value(entry, "title")}</p>
                              <p className="mt-1 text-xs text-slate-500">记录日期：{value(entry, "progress_date")}</p>
                              {entry.details && (
                                <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">
                                  {value(entry, "details")}
                                </p>
                              )}
                              {entry.next_action && (
                                <p className="mt-2 text-xs text-slate-600">
                                  下一步：{value(entry, "next_action")}
                                  {entry.follow_up_date ? ` · ${value(entry, "follow_up_date")}` : ""}
                                </p>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="py-4 text-sm text-slate-500">暂无跟进记录。</p>
                        )}
                        {data.historyHasMore && (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              setHistoryPage((current) => current + 1);
                            }}
                            className="py-2 text-sm font-semibold text-teal-700"
                          >
                            下一页跟进
                          </button>
                        )}
                        {historyPage > 1 && (
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              setHistoryPage((current) => current - 1);
                            }}
                            className="ml-4 py-2 text-sm font-semibold text-teal-700"
                          >
                            上一页
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                )}

                {!error && sectionReady && data && tab === "finance" && can("finance.read") && (
                  <div className="space-y-4">
                    <details className="overflow-hidden rounded-2xl bg-white">
                      <summary className="min-h-12 cursor-pointer list-none px-4 py-4 font-semibold text-slate-800">查看收支汇总</summary>
                      <section className="grid grid-cols-2 border-t border-slate-100">
                        {[
                          ["预计应收", sum(receivable, "planned_base_minor")],
                          ["实际已收", data.receivedBaseMinor],
                          ["预计应付", sum(payable, "planned_base_minor")],
                          ["实际已付", data.paidBaseMinor],
                        ].map(([label, amount], index) => (
                          <div key={String(label)} className={`p-4 ${index % 2 ? "border-l" : ""} ${index > 1 ? "border-t" : ""} border-slate-100`}>
                            <p className="text-xs text-slate-500">{label} · USD</p>
                            <p className="mt-2 font-semibold text-slate-900">{formatMoney("USD", Number(amount))}</p>
                          </div>
                        ))}
                      </section>
                      <p className="border-t border-slate-100 px-4 py-3 text-xs leading-5 text-slate-500">
                        汇总使用本位币 USD；计划按预算汇率，实际按每笔入账汇率。是否结清以计划原币判断。
                      </p>
                    </details>

                    <section className="overflow-hidden rounded-2xl bg-white">
                      <SectionHeading title="收付款计划" detail={`${data.plans.length} 项`} />
                      {sortedPlans.length ? (
                        sortedPlans.map((plan) => {
                          const remaining = Math.max(
                            0,
                            number(plan, "planned_amount_minor") - number(plan, "allocated_minor"),
                          );
                          return (
                            <div key={value(plan, "id")} className="border-t border-slate-100 px-4 py-3 first:border-0">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-slate-900">{value(plan, "name")}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {plan.plan_type === "RECEIVABLE" ? "应收" : "应付"} · {value(plan, "due_date") || "未设日期"}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-semibold">
                                    {formatMoney(value(plan, "currency"), plan.planned_amount_minor)}
                                  </p>
                                  <p className={`mt-1 text-xs ${remaining ? "text-amber-700" : "text-teal-700"}`}>
                                    {remaining ? `剩余 ${formatMoney(value(plan, "currency"), remaining)}` : "已结清"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="px-4 py-5 text-sm text-slate-500">暂无收付款计划。</p>
                      )}
                    </section>

                    <section className="overflow-hidden rounded-2xl bg-white">
                      <SectionHeading title="实际收付" detail={`本页 ${data.cashEntries.length} 笔`} />
                      {data.cashEntries.length ? (
                        data.cashEntries.map((entry) => (
                          <div key={value(entry, "id")} className="border-t border-slate-100 px-4 py-3 first:border-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-slate-900">
                                  {entry.direction === "RECEIPT" ? "收款" : "付款"} · {value(entry, "description")}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {value(entry, "entry_date")}
                                  {entry.plan_name ? ` · ${value(entry, "plan_name")}` : ""}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-sm font-semibold">
                                  {formatMoney(value(entry, "currency"), entry.amount_minor)}
                                </p>
                                {entry.currency !== "USD" && (
                                  <p className="mt-1 text-xs text-slate-500">
                                    {formatMoney("USD", entry.base_amount_minor)}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="px-4 py-5 text-sm text-slate-500">暂无收付款记录。</p>
                      )}
                      <div className="px-4 pb-3">
                        {data.cashHasMore && (
                          <button
                            onClick={() => setCashPage((current) => current + 1)}
                            className="py-2 text-sm font-semibold text-teal-700"
                          >
                            下一页收付
                          </button>
                        )}
                        {cashPage > 1 && (
                          <button
                            onClick={() => setCashPage((current) => current - 1)}
                            className="ml-4 py-2 text-sm font-semibold text-teal-700"
                          >
                            上一页
                          </button>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {!error && sectionReady && data && tab === "people" &&
                  (can("materials.read") ? (
                    <MobileMaterials
                      orderNo={orderNo}
                      version={number(order, "version")}
                      applicants={data.applicants}
                      materials={data.materials}
                      files={data.materialFiles}
                      canWrite={can("materials.write")}
                      canMrz={can("applicants.mrz")}
                      readPending={loading || Boolean(error)}
                      onReload={() => setRevision((current) => current + 1)}
                    />
                  ) : (
                    <section className="overflow-hidden rounded-2xl bg-white">
                      {data.applicants.map((applicant) => (
                        <div key={value(applicant, "id")} className="border-t border-slate-100 px-4 py-4 first:border-0">
                          <p className="font-semibold">{value(applicant, "name")}</p>
                          <p className="mt-2 text-xs text-slate-500">当前账号无材料查看权限。</p>
                        </div>
                      ))}
                    </section>
                  ))}

                {!error && sectionReady && data && tab === "common" && can("materials.read") && (
                  <MobileMaterials
                    orderNo={orderNo}
                    version={number(order, "version")}
                    applicants={data.applicants}
                    materials={data.materials}
                    files={data.materialFiles}
                    canWrite={can("materials.write")}
                    canMrz={false}
                    readPending={loading || Boolean(error)}
                    onReload={() => setRevision((current) => current + 1)}
                    common
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </MobileShell>
  );
}
