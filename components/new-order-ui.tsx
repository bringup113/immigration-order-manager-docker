"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  describeMrzChecksum,
  type PassportMrzCapture,
} from "@/lib/passport-mrz";

export function NewOrderSection({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FormHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-slate-50 p-5 text-sm text-slate-500">
      {children}
    </div>
  );
}

export function MrzChecksumHint({ capture }: { capture: PassportMrzCapture }) {
  const entries = Object.entries(capture.checksums);
  const validCount = entries.filter(([, valid]) => valid).length;
  const formatText = capture.format
    ? `（${capture.format}${capture.format === "TD3" ? " 护照" : ""}）`
    : "";

  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label="查看 MRZ 校验位详情"
            className="inline-flex shrink-0 cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {capture.valid ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">
              MRZ 校验位{formatText}：{validCount}/{entries.length} 项通过
            </p>
            {capture.format === "TD3" && entries.length !== 5 && (
              <p className="text-amber-700">
                标准护照 TD3 应有 5 个校验位；当前识别结果可能不完整。
              </p>
            )}
            {entries.length ? (
              <div className="grid gap-1">
                {entries.map(([key, valid]) => (
                  <div
                    key={key}
                    className={valid ? "text-emerald-700" : "text-rose-700"}
                  >
                    {valid ? "✓" : "✕"} {describeMrzChecksum(key)}：
                    {valid ? "通过" : "未通过"}
                  </div>
                ))}
              </div>
            ) : (
              <p>未返回可用的校验位明细。</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MrzReviewDetails({ capture }: { capture: PassportMrzCapture }) {
  const entries = Object.entries(capture.checksums);

  return (
    <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer select-none font-medium text-slate-700">
        查看原始 MRZ 与校验明细
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-slate-500">
          解析格式：{capture.format || "未知"}
          {capture.format === "TD3" ? "（护照）" : ""}
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-5 text-slate-100">
          {capture.rawMrz}
        </pre>
        <div className="grid gap-1 sm:grid-cols-2">
          {entries.map(([key, valid]) => (
            <div
              key={key}
              className={valid ? "text-emerald-700" : "text-rose-700"}
            >
              {valid ? "✓" : "✕"} {describeMrzChecksum(key)}
              {valid ? "通过" : "未通过"}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
