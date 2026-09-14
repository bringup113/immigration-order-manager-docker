import { ClosureItem, Field, type Row } from "@/components/order-detail-ui";
import type {
  ClosureDraft,
  OrderDetailDialog,
} from "@/components/order-detail-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/amount";

type Props = {
  activeDialog: OrderDetailDialog;
  closureCheck: Row;
  closure: ClosureDraft;
  onClosureChange: (value: ClosureDraft) => void;
  canReadFinance: boolean;
  canOverride: boolean;
  loading: boolean;
  message: string;
  onClose: () => void;
  onSave: () => Promise<void>;
};

export function OrderDetailClosureDialog({
  activeDialog,
  closureCheck,
  closure,
  onClosureChange,
  canReadFinance,
  canOverride,
  loading,
  message,
  onClose,
  onSave,
}: Props) {
  const incompleteRequiredSteps = Number(
    closureCheck.incompleteRequiredSteps || 0,
  );

  return (
    <Dialog
      open={activeDialog === "close"}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>正式结案</DialogTitle>
          <DialogDescription>
            系统会保存结案信息和完整日志。除未完成的必办流程外，其余项目只作提醒，不会阻止结案。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <ClosureItem
            label="未完成必办流程"
            value={incompleteRequiredSteps}
            blocking
          />
          <ClosureItem
            label="缺少必需材料"
            value={Number(closureCheck.missingRequiredMaterials || 0)}
          />
          <ClosureItem
            label="未完成待办"
            value={Number(closureCheck.openTasks || 0)}
          />
          <ClosureItem
            label="未完成跟进"
            value={Number(closureCheck.openFollowUps || 0)}
          />
        </div>
        {canReadFinance && (
          <div className="rounded-xl border bg-slate-50 p-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <span>
                计划应收：
                <b>{formatMoney("USD", closureCheck.receivableBaseMinor)}</b>
              </span>
              <span>
                实际已收：
                <b>{formatMoney("USD", closureCheck.receivedBaseMinor)}</b>
              </span>
              <span>
                计划应付：
                <b>{formatMoney("USD", closureCheck.payableBaseMinor)}</b>
              </span>
              <span>
                实际已付：
                <b>{formatMoney("USD", closureCheck.paidBaseMinor)}</b>
              </span>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="结案日期">
            <Input
              className="mt-2"
              type="date"
              value={closure.closedOn}
              onChange={(event) =>
                onClosureChange({ ...closure, closedOn: event.target.value })
              }
            />
          </Field>
          <Field label="结案结果">
            <Input
              className="mt-2"
              value={closure.result}
              onChange={(event) =>
                onClosureChange({ ...closure, result: event.target.value })
              }
              placeholder="例如：顺利获批"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="结案备注（可选）">
              <Textarea
                className="mt-2"
                value={closure.notes}
                onChange={(event) =>
                  onClosureChange({ ...closure, notes: event.target.value })
                }
              />
            </Field>
          </div>
          {incompleteRequiredSteps > 0 && canOverride && (
            <div className="sm:col-span-2">
              <Field label="强制结案原因">
                <Textarea
                  className="mt-2"
                  value={closure.reason}
                  onChange={(event) =>
                    onClosureChange({ ...closure, reason: event.target.value })
                  }
                  placeholder="说明为何在必办流程未完成时结案"
                />
              </Field>
            </div>
          )}
        </div>
        {incompleteRequiredSteps > 0 && !canOverride && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            当前仍有必办流程未完成，你没有强制结案权限。
          </p>
        )}
        {message && <p className="text-sm text-rose-700">{message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            className="bg-[#0f766e]"
            disabled={
              loading ||
              !closure.closedOn ||
              !closure.result.trim() ||
              (incompleteRequiredSteps > 0 &&
                (!canOverride || !closure.reason.trim()))
            }
            onClick={() => void onSave()}
          >
            确认结案
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
