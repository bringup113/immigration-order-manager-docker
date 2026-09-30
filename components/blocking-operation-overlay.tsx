"use client";

import { Check, Circle, LoaderCircle } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import type { PassportScanProgress, PassportScanStage } from "@/lib/passport-mrz";

export type BlockingOperationProgress = PassportScanProgress;

const labels: Record<PassportScanStage, { title: string; detail: string }> = {
  archiving: { title: "正在保存原始文件…", detail: "将原始材料安全保存到订单目录" },
  pdf_parsing: { title: "正在解析 PDF…", detail: "读取护照资料页并转换为识别图片" },
  image_preparing: { title: "正在优化图片…", detail: "生成适合 MRZ 识别和传输的图片副本" },
  uploading: { title: "正在上传…", detail: "将文件安全传输到服务器" },
  receiving: { title: "服务器正在接收…", detail: "等待应用服务器完整接收文件" },
  validating: { title: "正在校验文件…", detail: "检查文件格式、大小并准备识别" },
  forwarding: { title: "正在转交 MRZ 服务…", detail: "通过内部网络发送到识别容器" },
  queued: { title: "等待识别…", detail: "识别服务正在按顺序处理任务" },
  recognizing: { title: "正在识别…", detail: "读取图片并进行 MRZ 模型推理" },
};

const stepOrder: PassportScanStage[] = [
  "archiving",
  "pdf_parsing",
  "image_preparing",
  "uploading",
  "receiving",
  "validating",
  "forwarding",
  "queued",
  "recognizing",
];

export function BlockingOperationOverlay({
  progress,
}: {
  progress: BlockingOperationProgress | null;
}) {
  if (!progress) return null;
  return <BlockingOperationContent progress={progress} />;
}

function BlockingOperationContent({ progress }: { progress: BlockingOperationProgress }) {
  const stage = progress.stage;
  const [timing, setTiming] = useState({ stage, total: 0, current: 0 });
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTiming((value) => ({
        stage,
        total: value.total + 1,
        current: value.stage === stage ? value.current + 1 : 1,
      }));
    }, 100);
    return () => window.clearInterval(timer);
  }, [stage]);
  const elapsedTenths = timing.total;
  const stageElapsedTenths = timing.stage === stage ? timing.current : 0;
  const steps = useMemo(() => {
    if (progress.visibleStages?.length) {
      return progress.visibleStages.filter((item) => item !== "queued" || progress.stage === "queued");
    }
    if (progress.uploadOnly) return [progress.stage] as PassportScanStage[];
    const includePdf = progress.stage === "pdf_parsing" || Boolean(progress.page);
    const includeQueue = progress.stage === "queued";
    return stepOrder.filter((item) =>
      (item !== "archiving" || progress.stage === "archiving") &&
      (item !== "pdf_parsing" || includePdf) &&
      (item !== "image_preparing" || progress.includeUpload !== false) &&
      (item !== "uploading" || progress.includeUpload !== false) &&
      (item !== "receiving" || progress.includeUpload !== false) &&
      (item !== "queued" || includeQueue));
  }, [progress]);
  const currentIndex = stepOrder.indexOf(stage);
  const current = labels[stage];
  const title = stage === "uploading" && progress?.uploadPercent !== undefined
    ? `正在上传… ${progress.uploadPercent}%`
    : current?.title;
  const pageText = progress?.page
    ? `第 ${progress.page}/${progress.totalPages || progress.page} 页`
    : "";

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-slate-950/35 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          aria-busy="true"
          className="fixed left-1/2 top-1/2 z-[101] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white px-6 py-6 text-slate-800 shadow-2xl focus:outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="flex items-start gap-3">
            <LoaderCircle aria-hidden="true" className="mt-0.5 shrink-0 animate-spin text-teal-700" size={26} />
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">
                {current?.detail}{pageText ? ` · ${pageText}` : ""}
              </DialogPrimitive.Description>
            </div>
            <span className="ml-auto shrink-0 text-right text-xs tabular-nums text-slate-400">
              <span className="block">本步骤 {(stageElapsedTenths / 10).toFixed(1)} 秒</span>
              <span className="mt-0.5 block">总计 {(elapsedTenths / 10).toFixed(1)} 秒</span>
            </span>
          </div>
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            {steps.map((item) => {
              const index = stepOrder.indexOf(item);
              const active = item === stage;
              const done = index < currentIndex || (stage === "recognizing" && item === "queued");
              return <div key={item} className={`flex items-center gap-2 text-xs ${active ? "font-semibold text-teal-800" : done ? "text-slate-500" : "text-slate-300"}`}>
                {done ? <Check size={14} aria-hidden="true" /> : active ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
                <span>{labels[item].title.replace("正在", "").replace("…", "")}</span>
                {item === "queued" && progress?.waiting !== undefined && <span>（前方 {progress.waiting} 个任务）</span>}
              </div>;
            })}
          </div>
          {stageElapsedTenths >= 100 && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            当前步骤耗时较长，任务仍在继续，请勿关闭页面。
          </p>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
