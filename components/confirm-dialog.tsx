"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  destructive?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonValue?: string;
  onReasonChange?: (value: string) => void;
  error?: ReactNode;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "确认", pendingLabel = "正在处理…", pending = false,
  destructive = true, reasonLabel, reasonPlaceholder, reasonValue = "", onReasonChange, error, onConfirm,
}: ConfirmDialogProps) {
  const requiresReason = Boolean(reasonLabel);
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}><DialogContent>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {requiresReason && <div><Label htmlFor="confirmation-reason">{reasonLabel}</Label><Textarea id="confirmation-reason" autoFocus className="mt-2" value={reasonValue} onChange={(event) => onReasonChange?.(event.target.value)} placeholder={reasonPlaceholder}/></div>}
    {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button className={destructive ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-[#0f766e] text-white hover:bg-[#0d665f]"} disabled={pending || (requiresReason && !reasonValue.trim())} onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
