"use client";

import { useState } from "react";
import { CheckCircle2, MessageSquarePlus } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Row } from "@/components/order-detail-ui";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMobileOrderMutation } from "@/hooks/use-mobile-order-mutation";

type ProgressForm = {
  title: string;
  progressDate: string;
  details: string;
  nextAction: string;
  followUpDate: string;
};

function localDateKey() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function blankProgress(): ProgressForm {
  return { title: "", progressDate: localDateKey(), details: "", nextAction: "", followUpDate: "" };
}

export function MobileWorkflowActions({
  orderNo, order, steps, readPending, onReload,
}: {
  orderNo: string;
  order: Row;
  steps: Row[];
  readPending: boolean;
  onReload: () => void;
}) {
  const currentStep = steps.find((item) => item.status === "IN_PROGRESS");
  const [confirmStep, setConfirmStep] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [discardProgress, setDiscardProgress] = useState(false);
  const [form, setForm] = useState<ProgressForm>(blankProgress);
  const { pending, disabled, needsRefresh, uncertain, error, notice, submit, clearFeedback, acknowledge } =
    useMobileOrderMutation(orderNo, Number(order.version), readPending, onReload);
  const pairIsValid = Boolean(form.nextAction.trim()) === Boolean(form.followUpDate);
  const progressDirty = Boolean(form.title || form.details || form.nextAction || form.followUpDate || form.progressDate !== localDateKey());

  function openProgress() {
    setForm(blankProgress());
    clearFeedback();
    setProgressOpen(true);
  }

  function closeProgress() {
    if (pending) return;
    if (progressDirty) setDiscardProgress(true);
    else setProgressOpen(false);
  }

  return <section aria-label="办理操作"
    className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 mx-auto max-w-[520px] border-t border-slate-200 bg-white/95 px-4 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
    <div className={`grid gap-2 ${order.status === "ACTIVE" && currentStep ? "grid-cols-2" : "grid-cols-1"}`}>
      {order.status === "ACTIVE" && currentStep && <button disabled={disabled} onClick={() => { clearFeedback(); setConfirmStep(true); }}
        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-teal-700 px-2 text-sm font-semibold text-white disabled:opacity-50">
        <CheckCircle2 size={16} /> 完成步骤
      </button>}
      <button disabled={disabled} onClick={openProgress}
        className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-teal-600 px-2 text-sm font-semibold text-teal-700 disabled:opacity-50">
        <MessageSquarePlus size={16} /> 新增跟进
      </button>
    </div>
    {needsRefresh && <p role="status" className="mt-3 text-xs text-slate-500">正在确认最新订单状态…</p>}
    {notice && <p role="status" className="mt-3 text-xs text-teal-700">{notice}</p>}
    {error && !progressOpen && !confirmStep && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
    {uncertain && !readPending && !progressOpen && <button onClick={acknowledge} className="mt-2 text-xs font-semibold text-teal-700">已核对订单，继续操作</button>}

    <ConfirmDialog
      open={confirmStep}
      onOpenChange={setConfirmStep}
      title="完成当前步骤"
      description={<>确认完成“{String(currentStep?.name || "")}”吗？如有下一步待开始，系统会自动将其设为进行中。</>}
      confirmLabel="确认完成"
      pendingLabel="正在完成…"
      pending={disabled}
      destructive={false}
      error={error}
      onConfirm={() => {
        if (currentStep) void submit({ action: "step", stepId: currentStep.id, status: "COMPLETED" }, {
          successMessage: "步骤已完成。", onSuccess: () => setConfirmStep(false), onConflict: () => setConfirmStep(false),
        });
      }}
    />

    <Dialog open={progressOpen} onOpenChange={(open) => { if (open) setProgressOpen(true); else closeProgress(); }}>
      <DialogContent className="!left-0 !top-0 !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-y-auto !rounded-none px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <DialogHeader>
          <DialogTitle>新增跟进</DialogTitle>
          <DialogDescription>记录本次沟通或事件。填写新的下一步及日期后，上一条未完成的跟进事项会结束。</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (form.title.trim() && pairIsValid) void submit({ action: "progress", ...form }, {
            successMessage: "跟进已保存。", onSuccess: () => { setProgressOpen(false); setForm(blankProgress()); },
          });
        }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="mobile-progress-date">记录日期</Label><Input id="mobile-progress-date" type="date" required value={form.progressDate} onChange={(event) => setForm({ ...form, progressDate: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="mobile-progress-title">本次跟进内容</Label><Textarea id="mobile-progress-title" required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：已电话联系客户，确认补交材料时间" /></div>
          <div className="space-y-2"><Label htmlFor="mobile-progress-details">详细说明（可选）</Label><Textarea id="mobile-progress-details" maxLength={8000} value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="mobile-progress-next">下一步事项（可选）</Label><Input id="mobile-progress-next" maxLength={200} value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="mobile-progress-follow-date">跟进日期（与下一步同时填写）</Label><Input id="mobile-progress-follow-date" type="date" value={form.followUpDate} onChange={(event) => setForm({ ...form, followUpDate: event.target.value })} /></div>
          {!pairIsValid && <p role="alert" className="text-xs text-rose-700">下一步事项和跟进日期需要同时填写。</p>}
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {uncertain && !readPending && <button type="button" onClick={acknowledge} className="text-xs font-semibold text-teal-700">已核对订单，继续操作</button>}
          <DialogFooter>
            <button type="button" disabled={pending} onClick={closeProgress} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm disabled:opacity-50">取消</button>
            <button type="submit" disabled={disabled || !form.title.trim() || !pairIsValid} className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "正在保存…" : "保存跟进"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={discardProgress} onOpenChange={setDiscardProgress}
      title="放弃未保存的跟进？" description="当前填写内容尚未保存，关闭后将无法恢复。"
      confirmLabel="放弃并关闭" destructive pending={false}
      onConfirm={() => { setDiscardProgress(false); setProgressOpen(false); setForm(blankProgress()); }} />
  </section>;
}
