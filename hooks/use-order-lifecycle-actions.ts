import { useCallback, useRef, useState } from "react";
import { orderStatusLabel, type Row } from "@/components/order-detail-ui";
import type {
  ClosureDraft,
  OrderDetailConfirmation,
  OrderDetailData,
  OrderDetailDialog,
} from "@/components/order-detail-types";

type UseOrderLifecycleActionsOptions = {
  data: OrderDetailData | null;
  today: () => string;
  act: (payload: unknown) => Promise<void>;
  run: (payload: unknown, close?: boolean) => Promise<void>;
  setDialog: (dialog: OrderDetailDialog) => void;
  setMessage: (message: string) => void;
  askConfirmation: (confirmation: OrderDetailConfirmation) => void;
};

export function useOrderLifecycleActions({
  data,
  today,
  act,
  run,
  setDialog,
  setMessage,
  askConfirmation,
}: UseOrderLifecycleActionsOptions) {
  const [orderNotes, setOrderNotes] = useState("");
  const [notesNotice, setNotesNotice] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [signedDateNotice, setSignedDateNotice] = useState("");
  const [closure, setClosure] = useState<ClosureDraft>({
    closedOn: today(),
    result: "办理完成",
    notes: "",
    reason: "",
  });
  const savedDrafts = useRef<{ notes: string; date: string } | null>(null);

  const syncOrderDrafts = useCallback((order: Row) => {
    const previous = savedDrafts.current;
    const nextDrafts = {
      notes: String(order.notes || ""),
      date: String(order.signed_at || ""),
    };
    setOrderNotes((current) =>
      !previous || current === previous.notes ? nextDrafts.notes : current,
    );
    setSignedAt((current) =>
      !previous || current === previous.date ? nextDrafts.date : current,
    );
    savedDrafts.current = nextDrafts;
  }, []);

  function changeOrderNotes(value: string) {
    setOrderNotes(value);
    setNotesNotice("");
  }

  function changeSignedAt(value: string) {
    setSignedAt(value);
    setSignedDateNotice("");
  }

  async function saveOrderNotes() {
    setNotesNotice("");
    try {
      await act({ action: "updateNotes", notes: orderNotes });
      setNotesNotice("订单备注已保存。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "备注保存失败");
    }
  }

  async function saveSignedAt() {
    setSignedDateNotice("");
    try {
      await act({ action: "updateSignedAt", signedAt });
      setSignedDateNotice("签订日期已保存。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "签订日期保存失败");
    }
  }

  function updateOrderStatus(status: string) {
    const current = String(data?.order.status || "");
    const requiresReason =
      ["PAUSED", "CANCELLED", "REFUNDED"].includes(status) ||
      (status === "ACTIVE" &&
        ["PAUSED", "CANCELLED", "REFUNDED"].includes(current));
    if (requiresReason) {
      askConfirmation({
        title: `确认将订单改为“${orderStatusLabel[status] || status}”`,
        description: "此状态变更会影响订单当前的办理状态，请填写原因后确认。",
        confirmLabel: "确认修改",
        pendingLabel: "正在修改…",
        destructive: ["CANCELLED", "REFUNDED"].includes(status),
        reasonLabel: "变更原因",
        reasonPlaceholder: "请填写本次订单状态变更原因",
        onConfirm: async (reason) => {
          await act({ action: "status", status, reason });
        },
      });
      return;
    }
    void run({ action: "status", status });
  }

  function openClosure() {
    setClosure({
      closedOn: today(),
      result: "办理完成",
      notes: "",
      reason: "",
    });
    setMessage("");
    setDialog("close");
  }

  async function saveClosure() {
    try {
      await act({
        action: "closeOrder",
        closedOn: closure.closedOn,
        closureResult: closure.result,
        closureNotes: closure.notes,
        reason: closure.reason,
      });
      setDialog(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "结案失败");
    }
  }

  function reopenClosedOrder() {
    askConfirmation({
      title: "重新开启订单",
      description:
        "订单将恢复为办理中，并自动启动下一项待办流程。原结案记录仍会保留在历史中。",
      confirmLabel: "确认重新开启",
      pendingLabel: "正在重新开启…",
      destructive: false,
      reasonLabel: "重新开启原因",
      reasonPlaceholder: "请填写重新开启订单的原因",
      onConfirm: async (reason) => {
        await act({ action: "reopenOrder", reason });
      },
    });
  }

  return {
    orderNotes,
    notesNotice,
    signedAt,
    signedDateNotice,
    closure,
    setClosure,
    syncOrderDrafts,
    changeOrderNotes,
    changeSignedAt,
    saveOrderNotes,
    saveSignedAt,
    updateOrderStatus,
    openClosure,
    saveClosure,
    reopenClosedOrder,
  };
}
