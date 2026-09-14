"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/amount";
import { useApiPage } from "@/lib/use-api";
import { usePermissions } from "@/lib/use-permissions";

type Order = {
  id: string;
  order_no: string;
  agent_name: string;
  project_name: string;
  main_applicant: string | null;
  owner_name: string;
  status: string;
  receivable_base_minor: number;
  payable_base_minor: number;
  received_base_minor: number;
  paid_base_minor: number;
  total_steps: number;
  current_step: string | null;
  current_step_status: string | null;
  current_step_due_date: string | null;
  in_progress_steps: number;
  pending_follow_up: string | null;
  pending_follow_up_date: string | null;
};

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "办理中",
  PAUSED: "暂停",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
};

function localToday() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function CurrentStep({ order }: { order: Order }) {
  if (!order.current_step) {
    return (
      <div>
        <b>{order.total_steps ? "办理流程已结束" : "尚未设置流程"}</b>
        <p className="mt-1 text-xs text-slate-400">
          {order.total_steps ? "所有步骤均已处理" : "可在订单详情中增加步骤"}
        </p>
      </div>
    );
  }
  const active = order.current_step_status === "IN_PROGRESS";
  const extra =
    active && order.in_progress_steps > 1
      ? `等 ${order.in_progress_steps} 项进行中`
      : active
        ? "进行中"
        : "下一步";
  return (
    <div className="max-w-xs">
      <b>{order.current_step}</b>
      <p
        className={`mt-1 text-xs ${active ? "text-blue-600" : "text-slate-500"}`}
      >
        {extra}
        {order.current_step_due_date
          ? ` · 预计 ${order.current_step_due_date}`
          : " · 未设日期"}
      </p>
    </div>
  );
}

function PendingFollowUp({ order }: { order: Order }) {
  if (!order.pending_follow_up || !order.pending_follow_up_date)
    return <span className="text-xs text-slate-400">暂无待跟进</span>;
  const today = localToday();
  const overdue = order.pending_follow_up_date < today;
  const dueToday = order.pending_follow_up_date === today;
  return (
    <div className="max-w-xs">
      <b className={overdue ? "text-rose-700" : "text-slate-700"}>
        {order.pending_follow_up}
      </b>
      <p
        className={`mt-1 text-xs ${overdue ? "text-rose-600" : dueToday ? "text-amber-600" : "text-teal-700"}`}
      >
        {overdue ? "已逾期" : dueToday ? "今天跟进" : "计划跟进"} ·{" "}
        {order.pending_follow_up_date}
      </p>
    </div>
  );
}

export default function OrdersPage() {
  const can = usePermissions();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("ALL");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const params = new URLSearchParams({
    page: String(page),
    q: search,
    ...(owner === "ALL" ? {} : { owner }),
  });
  const { rows, loading, error, hasMore, owners } = useApiPage<Order>(
    `orders?${params}`,
  );
  const visible = rows;

  return (
    <AppShell>
      <PageHeader
        eyebrow="业务中心"
        title="订单管理"
        description="直接查看每张订单当前办到哪里、下一次需要跟进什么"
        action={
          can("orders.write") ? (
            <Button asChild className="bg-[#0f766e]">
              <Link href="/orders/new">
                <Plus size={16} /> 新增订单
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>列表只展示当前状态：</b>
        完整流程、历史跟进、材料与收付款记录都保留在订单详情中。
      </div>
      {error && <ErrorState message={error} />}
      {
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b p-5">
            <div className="relative max-w-sm flex-1">
              <Search
                size={17}
                className="absolute left-3 top-2.5 text-slate-400"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索订单、代理、项目、负责人、办理或跟进"
                className="h-10 bg-slate-50 pl-9"
              />
            </div>
            {owners.length > 1 && (
              <Select
                value={owner}
                onValueChange={(value) => {
                  setOwner(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="全部负责人" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部负责人</SelectItem>
                  {owners.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.username})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Badge variant="outline" className="ml-auto">
              第 {page} 页 · {visible.length} 张订单
            </Badge>
          </div>
          {loading && <LoadingState />}
          {!loading && rows.length === 0 && (
            <EmptyState
              title="没有符合条件的订单"
              description="请调整筛选条件或新增订单。"
            />
          )}
          <div className="overflow-x-auto">
            <table
              className={`w-full text-sm ${can("finance.read") ? "min-w-[1480px]" : "min-w-[1000px]"}`}
            >
              <thead>
                <tr className="table-head">
                  <th>订单 / 代理</th>
                  <th>项目 / 主申请人</th>
                  <th>当前办理</th>
                  <th>待跟进</th>
                  <th>订单状态</th>
                  {can("finance.read") && (
                    <>
                      <th>订单收款（USD）</th>
                      <th>订单付款（USD）</th>
                      <th>订单利润（USD）</th>
                    </>
                  )}
                  <th>负责人</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const profit =
                    Number(row.received_base_minor) -
                    Number(row.paid_base_minor);
                  const expectedProfit =
                    Number(row.receivable_base_minor) -
                    Number(row.payable_base_minor);
                  return (
                    <tr className="table-row" key={row.id}>
                      <td>
                        <Link
                          href={`/orders/${row.order_no}`}
                          className="font-semibold text-slate-800 hover:text-teal-700"
                        >
                          {row.order_no}
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.agent_name}
                        </p>
                      </td>
                      <td>
                        <b>{row.project_name}</b>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.main_applicant || "未填写"}
                        </p>
                      </td>
                      <td>
                        <CurrentStep order={row} />
                      </td>
                      <td>
                        <PendingFollowUp order={row} />
                      </td>
                      <td>
                        <Badge
                          variant="outline"
                          className={`status ${row.status === "ACTIVE" ? "blue" : row.status === "COMPLETED" ? "green" : "amber"}`}
                        >
                          {statusLabel[row.status] || row.status}
                        </Badge>
                      </td>
                      {can("finance.read") && (
                        <>
                          <td>
                            <MoneyPair
                              firstLabel="应收"
                              firstValue={row.receivable_base_minor}
                              secondLabel="实收"
                              secondValue={row.received_base_minor}
                            />
                          </td>
                          <td>
                            <MoneyPair
                              firstLabel="应付"
                              firstValue={row.payable_base_minor}
                              secondLabel="实付"
                              secondValue={row.paid_base_minor}
                            />
                          </td>
                          <td>
                            <MoneyPair
                              firstLabel="预计"
                              firstValue={expectedProfit}
                              secondLabel={
                                row.status === "COMPLETED" ? "实际" : "当前"
                              }
                              secondValue={profit}
                            />
                          </td>
                        </>
                      )}
                      <td>
                        <b>{row.owner_name}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-3 border-t p-4">
            <Button
              variant="outline"
              disabled={loading || page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </Button>
            <span className="text-sm">第 {page} 页</span>
            <Button
              variant="outline"
              disabled={loading || !hasMore}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
      }
    </AppShell>
  );
}

function MoneyPair({
  firstLabel,
  firstValue,
  secondLabel,
  secondValue,
}: {
  firstLabel: string;
  firstValue: number;
  secondLabel: string;
  secondValue: number;
}) {
  return (
    <div className="space-y-1 whitespace-nowrap">
      <p>
        <span className="mr-2 text-xs text-slate-400">{firstLabel}</span>
        <b>{formatMoney("USD", firstValue)}</b>
      </p>
      <p>
        <span className="mr-2 text-xs text-slate-400">{secondLabel}</span>
        <span>{formatMoney("USD", secondValue)}</span>
      </p>
    </div>
  );
}
