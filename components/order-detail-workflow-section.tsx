"use client";

import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { EmptyState, LoadingState } from "@/components/data-state";
import type { Row } from "@/components/order-detail-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";

const stepLabel: Record<string, string> = {
  PENDING: "待开始",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  SKIPPED: "已跳过",
};

const taskPriorityLabel: Record<string, string> = {
  LOW: "低",
  MEDIUM: "普通",
  HIGH: "高",
};

type Props = {
  loading: boolean;
  steps: Row[];
  tasks: Row[];
  progress: Row[];
  historyPage: number;
  historyHasMore: boolean;
  today: string;
  canWriteOrders: boolean;
  canOverrideOrders: boolean;
  canReadTasks: boolean;
  canWriteTasks: boolean;
  onAddStep: () => void;
  onMoveStep: (row: Row, direction: "UP" | "DOWN") => void;
  onEditStep: (row: Row) => void;
  onDeleteStep: (row: Row) => void;
  onStepStatusChange: (row: Row, status: string) => void;
  onAddTask: () => void;
  onToggleTask: (row: Row, status: "OPEN" | "COMPLETED") => void;
  onEditTask: (row: Row) => void;
  onDeleteTask: (row: Row) => void;
  onAddProgress: () => void;
  onCompleteFollowUp: (row: Row) => void;
  onHistoryPageChange: (page: number) => void;
};

export function OrderDetailWorkflowSection({
  loading,
  steps,
  tasks,
  progress,
  historyPage,
  historyHasMore,
  today,
  canWriteOrders,
  canOverrideOrders,
  canReadTasks,
  canWriteTasks,
  onAddStep,
  onMoveStep,
  onEditStep,
  onDeleteStep,
  onStepStatusChange,
  onAddTask,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  onAddProgress,
  onCompleteFollowUp,
  onHistoryPageChange,
}: Props) {
  return (
    <TabsContent value="workflow" className="m-0 p-5">
      {loading && <LoadingState />}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <section className="rounded-2xl border p-5">
          <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-semibold">办理流程</h3>
              <p className="mt-1 text-sm text-slate-500">
                流程表示订单办到哪一步；状态在这里直接更新，步骤可修改、删除和调整顺序。
              </p>
            </div>
            {canWriteOrders && (
              <Button variant="outline" onClick={onAddStep}>
                <Plus size={16} /> 增加步骤
              </Button>
            )}
          </div>

          {steps.length === 0 ? (
            <EmptyState
              title="暂无流程步骤"
              description="可以为这张订单添加专属步骤。"
            />
          ) : (
            <div className="space-y-3">
              {steps.map((row, index) => (
                <div
                  key={String(row.id)}
                  className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[46px_1fr_auto_150px] md:items-center"
                >
                  <span
                    className={`grid size-10 place-items-center rounded-xl ${
                      row.status === "COMPLETED"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {row.status === "COMPLETED" ? (
                      <CheckCircle2 size={19} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <b>{String(row.name)}</b>
                    <p className="mt-1 text-xs text-slate-500">
                      {Boolean(row.required) ? "必办" : "选办"}
                      {row.due_date ? ` · 预计 ${row.due_date}` : " · 未设日期"}
                    </p>
                  </div>
                  {canWriteOrders ? (
                    <>
                      <div className="flex">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={index === 0}
                          onClick={() => onMoveStep(row, "UP")}
                          title="上移"
                          aria-label={`上移步骤：${String(row.name)}`}
                        >
                          <ArrowUp size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={index === steps.length - 1}
                          onClick={() => onMoveStep(row, "DOWN")}
                          title="下移"
                          aria-label={`下移步骤：${String(row.name)}`}
                        >
                          <ArrowDown size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onEditStep(row)}
                          title="修改"
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-600"
                          onClick={() => onDeleteStep(row)}
                          title="删除"
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                      <Select
                        value={String(row.status)}
                        onValueChange={(status) =>
                          onStepStatusChange(row, status)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(stepLabel)
                            .filter(
                              ([value]) =>
                                value !== "SKIPPED" ||
                                !Boolean(row.required) ||
                                canOverrideOrders,
                            )
                            .map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <span />
                      <Badge variant="outline">
                        {stepLabel[String(row.status)] || String(row.status)}
                      </Badge>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="workflow-side-column space-y-5">
          {canReadTasks && (
            <section className="rounded-2xl border p-5">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-semibold">订单待办</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    安排接下来需要处理的事项，可关联具体订单资料。
                  </p>
                </div>
                {canWriteTasks && (
                  <Button variant="outline" onClick={onAddTask}>
                    <Plus size={16} /> 新增待办
                  </Button>
                )}
              </div>
              {tasks.length === 0 ? (
                <EmptyState
                  title="暂无订单待办"
                  description="可增加催材料、联系渠道、收付款或其他需要处理的事项。"
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {tasks.map((row) => {
                    const completed = row.status === "COMPLETED";
                    const overdue = !completed && String(row.due_date) < today;
                    return (
                      <div
                        key={String(row.id)}
                        className={`rounded-2xl border p-4 ${
                          completed
                            ? "bg-slate-50"
                            : overdue
                              ? "border-rose-200 bg-rose-50/40"
                              : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            disabled={!canWriteTasks}
                            onClick={() =>
                              onToggleTask(
                                row,
                                completed ? "OPEN" : "COMPLETED",
                              )
                            }
                            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border ${
                              completed
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-400"
                            }`}
                            aria-label={completed ? "重新打开待办" : "完成待办"}
                          >
                            <CheckCircle2 size={17} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <b
                                className={
                                  completed ? "text-slate-400 line-through" : ""
                                }
                              >
                                {String(row.title)}
                              </b>
                              <Badge
                                variant="outline"
                                className={
                                  row.priority === "HIGH"
                                    ? "border-rose-200 text-rose-700"
                                    : ""
                                }
                              >
                                {taskPriorityLabel[String(row.priority)] ||
                                  row.priority}
                              </Badge>
                            </div>
                            <p
                              className={`mt-1 text-xs ${
                                overdue
                                  ? "font-medium text-rose-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {overdue
                                ? "已逾期"
                                : completed
                                  ? "已完成"
                                  : "截止"}{" "}
                              · {String(row.due_date)} ·{" "}
                              {String(row.owner_name)}
                            </p>
                            {row.related_type && (
                              <p className="mt-1 text-xs text-slate-400">
                                已关联订单资料
                              </p>
                            )}
                          </div>
                          {canWriteTasks && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEditTask(row)}
                                title="修改待办"
                              >
                                <Pencil size={15} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-rose-600"
                                onClick={() => onDeleteTask(row)}
                                title="删除待办"
                              >
                                <Trash2 size={15} />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border p-5">
            <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="font-semibold">跟进记录</h3>
                <p className="mt-1 text-sm text-slate-500">
                  记录申请人、代理、渠道或机构沟通及下一步；列表只显示当前未完成事项。
                </p>
              </div>
              {canWriteOrders && (
                <Button variant="outline" onClick={onAddProgress}>
                  <Plus size={16} /> 记录跟进
                </Button>
              )}
            </div>
            {progress.length === 0 ? (
              <EmptyState
                title="暂无跟进记录"
                description="记录第一条沟通、事件或下一步安排。"
              />
            ) : (
              <div className="space-y-4">
                {progress.map((row) => {
                  const dueDate = String(row.follow_up_date || "");
                  const done = Boolean(row.follow_up_done);
                  const overdue = Boolean(dueDate) && !done && dueDate < today;
                  return (
                    <div key={String(row.id)} className="flex gap-4">
                      <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
                        <CalendarClock size={17} />
                      </span>
                      <div className="flex-1 border-b pb-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs text-slate-400">
                            {String(row.progress_date)}
                            {Boolean(row.pinned) && " · 已置顶"}
                          </p>
                          {dueDate && (
                            <Badge
                              variant="outline"
                              className={`px-2 py-0 text-[11px] ${
                                done
                                  ? "border-slate-200 text-slate-500"
                                  : overdue
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {done
                                ? `跟进已完成 · ${dueDate}`
                                : overdue
                                  ? `跟进已逾期 · ${dueDate}`
                                  : `待跟进 · ${dueDate}`}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 font-semibold">
                          {String(row.title)}
                        </p>
                        {row.details && (
                          <p className="mt-1 text-sm text-slate-500">
                            {String(row.details)}
                          </p>
                        )}
                        {row.next_action && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <p
                              className={`text-xs ${
                                done
                                  ? "text-slate-400 line-through"
                                  : overdue
                                    ? "text-rose-700"
                                    : "text-teal-700"
                              }`}
                            >
                              下一步：{String(row.next_action)}
                            </p>
                            {canWriteOrders && dueDate && !done && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onCompleteFollowUp(row)}
                              >
                                <CheckCircle2 size={15} /> 完成跟进
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-3">
        <Button
          variant="outline"
          disabled={loading || historyPage === 1}
          onClick={() => onHistoryPageChange(historyPage - 1)}
        >
          上一页跟进
        </Button>
        <span>跟进第 {historyPage} 页</span>
        <Button
          variant="outline"
          disabled={loading || !historyHasMore}
          onClick={() => onHistoryPageChange(historyPage + 1)}
        >
          下一页跟进
        </Button>
      </div>
    </TabsContent>
  );
}
