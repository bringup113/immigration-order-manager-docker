"use client";

import {
  Archive,
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderMaterialList } from "@/components/order-material-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/amount";

export type Row = Record<string, string | number | boolean | null>;
export type CashDirection = "RECEIPT" | "PAYMENT";

export const planLabel: Record<string, string> = {
  RECEIVABLE: "订单应收",
  PAYABLE: "订单应付",
};

export const directionLabel: Record<CashDirection, string> = {
  RECEIPT: "收款",
  PAYMENT: "付款",
};

export const orderStatusLabel: Record<string, string> = {
  DRAFT: "草稿",
  ACTIVE: "办理中",
  PAUSED: "暂停",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  REFUNDED: "已退款",
};

function Metric({
  label,
  value,
  green = false,
}: {
  label: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 font-semibold ${green ? "text-emerald-700" : ""}`}>
        {value}
      </p>
    </div>
  );
}
function ClosureItem({
  label,
  value,
  blocking = false,
}: {
  label: string;
  value: number;
  blocking?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 text-sm ${value > 0 ? (blocking ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800") : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
    >
      <span>{label}</span>
      <b className="float-right">{value > 0 ? `${value} 项` : "无"}</b>
    </div>
  );
}
function CashEntryTable({
  rows,
  canWrite,
  canRestore,
  onEdit,
  onVoid,
  onRestore,
}: {
  rows: Row[];
  canWrite: boolean;
  canRestore: boolean;
  onEdit: (direction: CashDirection, row: Row) => void;
  onVoid: (row: Row) => void;
  onRestore: (row: Row) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1120px] text-sm">
        <thead>
          <tr className="table-head">
            <th>日期</th>
            <th>类型</th>
            <th>说明</th>
            <th>实际金额</th>
            <th>本位币金额</th>
            <th>关联计划</th>
            <th>备注</th>
            <th>状态</th>
            {(canWrite || canRestore) && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const direction = String(row.direction) as CashDirection;
            const voided = row.status === "VOIDED";
            return (
              <tr
                className={`table-row ${voided ? "bg-slate-50 text-slate-500" : ""}`}
                key={String(row.id)}
              >
                <td>{String(row.entry_date)}</td>
                <td>
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium ${voided ? "text-slate-500" : direction === "RECEIPT" ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {direction === "RECEIPT" ? (
                      <ArrowDownLeft size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}{" "}
                    {directionLabel[direction]}
                  </span>
                </td>
                <td>
                  <b>{String(row.description)}</b>
                  <p className="mt-1 text-xs text-slate-400">
                    汇率 1 USD ={" "}
                    {Number(row.rate_per_usd).toLocaleString("zh-CN", {
                      maximumFractionDigits: 8,
                    })}{" "}
                    {String(row.currency)}
                  </p>
                </td>
                <td className="font-semibold">
                  {formatMoney(String(row.currency), row.amount_minor)}
                </td>
                <td>{formatMoney("USD", row.base_amount_minor)}</td>
                <td>
                  {String(row.plan_name || "未关联计划")}
                  {row.plan_amount_minor && (
                    <p className="mt-1 text-xs text-slate-400">
                      计入{" "}
                      {formatMoney(
                        String(row.plan_currency),
                        row.plan_amount_minor,
                      )}
                    </p>
                  )}
                </td>
                <td className="max-w-xs text-xs">
                  {String(row.notes || "—")}
                  {voided && row.void_reason && (
                    <p className="mt-1 text-rose-600">
                      作废原因：{String(row.void_reason)}
                    </p>
                  )}
                </td>
                <td>
                  <Badge
                    variant="outline"
                    className={`status ${voided ? "amber" : "green"}`}
                  >
                    {voided ? "已作废" : "有效"}
                  </Badge>
                </td>
                {(canWrite || canRestore) && (
                  <td>
                    <div className="flex justify-end gap-1">
                      {!voided && canWrite && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="修改"
                            onClick={() => onEdit(direction, row)}
                          >
                            <Pencil size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="作废"
                            className="text-rose-600"
                            onClick={() => onVoid(row)}
                          >
                            <Archive size={15} />
                          </Button>
                        </>
                      )}
                      {voided && canRestore && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="恢复"
                          className="text-teal-700"
                          onClick={() => onRestore(row)}
                        >
                          <RotateCcw size={15} />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function OrderMaterialsPanel({
  title,
  notice,
  materials,
  files,
  uploadingMaterialId,
  canEdit,
  canRestore,
  canDownload,
  onAdd,
  onEdit,
  onDelete,
  onUpload,
  onReplace,
  onPreview,
  onVoidFile,
  onRestoreFile,
}: {
  title: string;
  notice?: { text: string; error: boolean };
  materials: Row[];
  files: Row[];
  uploadingMaterialId: string;
  canEdit: boolean;
  canRestore: boolean;
  canDownload: boolean;
  onAdd: () => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
  onUpload: (materialId: string, file?: File) => void;
  onReplace: (fileId: string, storedName: string, file?: File) => void;
  onPreview: (file: Row) => void;
  onVoidFile: (fileId: string, storedName: string, version: number) => void;
  onRestoreFile: (fileId: string, storedName: string, version: number) => void;
}) {
  return (
    <Panel title={title}>
      {notice?.text && <Notice value={notice} />}
      <OrderMaterialList
        materials={materials}
        files={files}
        uploadingMaterialId={uploadingMaterialId}
        canEdit={canEdit}
        canRestore={canRestore}
        canDownload={canDownload}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
        onUpload={onUpload}
        onReplace={onReplace}
        onPreview={onPreview}
        onVoidFile={onVoidFile}
        onRestoreFile={onRestoreFile}
      />
    </Panel>
  );
}
function PlanGroup({
  rows,
  canEdit,
  onMove,
  onEdit,
  onDelete,
}: {
  rows: Row[];
  canEdit: boolean;
  onMove: (row: Row, direction: "UP" | "DOWN") => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
}) {
  return (
    <article className="rounded-2xl border p-5">
      <h3 className="font-semibold">{planLabel[String(rows[0].plan_type)]}</h3>
      <div className="mt-4 space-y-3">
        {rows.map((row, index) => {
          const planned = Number(row.planned_amount_minor || 0);
          const allocated = Number(row.allocated_minor || 0);
          return (
            <div key={String(row.id)} className="rounded-xl bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-xs text-slate-500">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <b>{String(row.name)}</b>
                  <p className="mt-1 text-xs text-slate-400">
                    计划日期：{String(row.due_date || "未设置")}
                    {row.channel_name ? ` · ${row.channel_name}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <>
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => onMove(row, "UP")}
                        title="上移"
                        aria-label={`上移计划：${String(row.name)}`}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={index === rows.length - 1}
                        onClick={() => onMove(row, "DOWN")}
                        title="下移"
                        aria-label={`下移计划：${String(row.name)}`}
                      >
                        <ArrowDown size={15} />
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(row)}
                      title="修改"
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-rose-600"
                      onClick={() => onDelete(row)}
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span>
                  计划 {formatMoney(String(row.currency), planned)} · 已计入{" "}
                  {formatMoney(String(row.currency), allocated)}
                </span>
                <Badge
                  variant="outline"
                  className={`status ${allocated >= planned ? "green" : allocated > 0 ? "violet" : "amber"}`}
                >
                  {allocated >= planned
                    ? "已完成"
                    : allocated > 0
                      ? "部分完成"
                      : "待处理"}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
function Notice({ value }: { value: { text: string; error: boolean } }) {
  return (
    <p
      className={`mb-3 rounded-xl border px-3 py-2 text-sm ${value.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
    >
      {value.text}
    </p>
  );
}
function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function OrderMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 truncate font-medium text-slate-800 ${mono ? "font-mono text-sm" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
function ApplicantMeta({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-800">
        {String(value || "未填写")}
      </p>
    </div>
  );
}
function CashCalculationInput({
  id,
  label,
  value,
  auto,
  locked = false,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  auto: boolean;
  locked?: boolean;
  step: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {auto ? (
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
          >
            自动算出
          </Badge>
        ) : null}
      </div>
      <Input
        id={id}
        className={`mt-2 ${auto ? "border-emerald-200 bg-emerald-50/50" : ""}`}
        type="number"
        min={step}
        step={step}
        inputMode="decimal"
        readOnly={locked}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
function Choose({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: string[][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="mt-2 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export {
  ApplicantMeta,
  CashCalculationInput,
  CashEntryTable,
  Choose,
  ClosureItem,
  Field,
  Metric,
  Notice,
  OrderMaterialsPanel,
  OrderMeta,
  Panel,
  PlanGroup,
  formatFileSize,
};
