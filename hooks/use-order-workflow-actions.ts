import { useState } from "react";
import type { Row } from "@/components/order-detail-ui";
import type {
  OrderDetailConfirmation,
  OrderDetailData,
  OrderDetailDialog,
  ProgressDraft,
  StepDraft,
  TaskDraft,
} from "@/components/order-detail-types";

type UseOrderWorkflowActionsOptions = {
  data: OrderDetailData | null;
  permissions: string[];
  today: () => string;
  act: (payload: unknown) => Promise<void>;
  run: (payload: unknown, close?: boolean) => Promise<void>;
  setDialog: (dialog: OrderDetailDialog) => void;
  setMessage: (message: string) => void;
  askConfirmation: (confirmation: OrderDetailConfirmation) => void;
};

export function useOrderWorkflowActions({
  data,
  permissions,
  today,
  act,
  run,
  setDialog,
  setMessage,
  askConfirmation,
}: UseOrderWorkflowActionsOptions) {
  const [editingStepId, setEditingStepId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState("");
  const [progress, setProgress] = useState<ProgressDraft>({
    title: "",
    progressDate: today(),
    details: "",
    nextAction: "",
    followUpDate: "",
    pinned: false,
  });
  const [step, setStep] = useState<StepDraft>({
    name: "",
    dueDate: "",
    required: true,
    notes: "",
  });
  const [task, setTask] = useState<TaskDraft>({
    title: "",
    dueDate: today(),
    priority: "MEDIUM",
    ownerUserId: "",
    relatedType: "",
    relatedId: "",
  });

  const can = (permission: string) =>
    permissions.includes("*") || permissions.includes(permission);

  function openProgress() {
    setProgress({
      title: "",
      progressDate: today(),
      details: "",
      nextAction: "",
      followUpDate: "",
      pinned: false,
    });
    setMessage("");
    setDialog("progress");
  }

  async function saveProgress() {
    try {
      await act({ action: "progress", ...progress });
      setDialog(null);
      setProgress({
        title: "",
        progressDate: today(),
        details: "",
        nextAction: "",
        followUpDate: "",
        pinned: false,
      });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  }

  function openStep(row?: Row) {
    setEditingStepId(row ? String(row.id) : "");
    setStep(
      row
        ? {
            name: String(row.name),
            dueDate: String(row.due_date || ""),
            required: Boolean(row.required),
            notes: String(row.notes || ""),
          }
        : { name: "", dueDate: "", required: true, notes: "" },
    );
    setMessage("");
    setDialog("step");
  }

  async function saveStep() {
    try {
      await act({
        action: editingStepId ? "updateStep" : "addStep",
        stepId: editingStepId || undefined,
        ...step,
      });
      setDialog(null);
      setEditingStepId("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "流程保存失败");
    }
  }

  function removeStep(row: Row) {
    askConfirmation({
      title: "删除办理流程",
      description: `确定删除“${String(row.name)}”吗？删除后无法恢复。`,
      confirmLabel: "确认删除",
      pendingLabel: "正在删除…",
      onConfirm: async () => {
        await act({ action: "deleteStep", stepId: row.id });
      },
    });
  }

  function updateStepStatus(row: Row, status: string) {
    if (status === "SKIPPED" && Boolean(row.required)) {
      if (!can("orders.override")) {
        setMessage("必办流程不能直接跳过。");
        return;
      }
      askConfirmation({
        title: "强制跳过必办流程",
        description: `“${String(row.name)}”被设为必办流程。跳过后流程会继续推进，请填写原因后确认。`,
        confirmLabel: "确认跳过",
        pendingLabel: "正在更新…",
        reasonLabel: "跳过原因",
        reasonPlaceholder: "请填写强制跳过该流程的原因",
        onConfirm: async (reason) => {
          await act({ action: "step", stepId: row.id, status, reason });
        },
      });
      return;
    }
    void run({ action: "step", stepId: row.id, status });
  }

  function openTask(row?: Row) {
    setEditingTaskId(row ? String(row.id) : "");
    setTask(
      row
        ? {
            title: String(row.title),
            dueDate: String(row.due_date),
            priority: String(row.priority),
            ownerUserId: String(row.owner_user_id),
            relatedType: String(row.related_type || ""),
            relatedId: String(row.related_id || ""),
          }
        : {
            title: "",
            dueDate: today(),
            priority: "MEDIUM",
            ownerUserId: String(data?.order.owner_user_id || ""),
            relatedType: "",
            relatedId: "",
          },
    );
    setMessage("");
    setDialog("task");
  }

  async function saveTask() {
    try {
      await act({
        action: "saveTask",
        taskId: editingTaskId || undefined,
        ...task,
      });
      setDialog(null);
      setEditingTaskId("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "待办保存失败");
    }
  }

  function removeTask(row: Row) {
    askConfirmation({
      title: "删除订单待办",
      description: `确定删除“${String(row.title)}”吗？删除后无法恢复。`,
      confirmLabel: "确认删除",
      pendingLabel: "正在删除…",
      onConfirm: async () => {
        await act({ action: "deleteTask", taskId: row.id });
      },
    });
  }

  const taskRelatedItems = [
    ["NONE", "不关联具体资料"],
    ...(data?.steps || []).map((row) => [
      `STEP:${String(row.id)}`,
      `流程：${String(row.name)}`,
    ]),
    ...(data?.applicants || []).map((row) => [
      `APPLICANT:${String(row.id)}`,
      `申请人：${String(row.name)}`,
    ]),
    ...(data?.materials || []).map((row) => [
      `MATERIAL:${String(row.id)}`,
      `材料：${String(row.name)}`,
    ]),
    ...(data?.plans || []).map((row) => [
      `PLAN:${String(row.id)}`,
      `计划：${String(row.name)}`,
    ]),
  ];

  return {
    editingStepId,
    setEditingStepId,
    editingTaskId,
    setEditingTaskId,
    progress,
    setProgress,
    step,
    setStep,
    task,
    setTask,
    taskRelatedItems,
    openProgress,
    saveProgress,
    openStep,
    saveStep,
    removeStep,
    updateStepStatus,
    moveStep: (row: Row, direction: "UP" | "DOWN") =>
      void run({ action: "moveStep", stepId: row.id, direction }),
    openTask,
    saveTask,
    removeTask,
    toggleTask: (row: Row, status: "OPEN" | "COMPLETED") =>
      void run({ action: "toggleTask", taskId: row.id, status }),
    completeFollowUp: (row: Row) =>
      void run({ action: "completeFollowUp", progressId: row.id }),
  };
}
