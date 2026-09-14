import type { Row } from "@/components/order-detail-ui";
import { Choose, Field } from "@/components/order-detail-ui";
import type {
  OrderDetailDialog,
  ProgressDraft,
  StepDraft,
  TaskDraft,
} from "@/components/order-detail-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const taskPriorityLabel: Record<string, string> = {
  LOW: "低",
  MEDIUM: "普通",
  HIGH: "高",
};

type Props = {
  activeDialog: OrderDetailDialog;
  message: string;
  progress: ProgressDraft;
  onProgressChange: (value: ProgressDraft) => void;
  onCloseProgress: () => void;
  onSaveProgress: () => Promise<void>;
  editingStepId: string;
  step: StepDraft;
  onStepChange: (value: StepDraft) => void;
  onCloseStep: () => void;
  onSaveStep: () => Promise<void>;
  editingTaskId: string;
  task: TaskDraft;
  onTaskChange: (value: TaskDraft) => void;
  assignableUsers: Row[];
  taskRelatedItems: string[][];
  onCloseTask: () => void;
  onSaveTask: () => Promise<void>;
};

export function OrderDetailWorkflowDialogs({
  activeDialog,
  message,
  progress,
  onProgressChange,
  onCloseProgress,
  onSaveProgress,
  editingStepId,
  step,
  onStepChange,
  onCloseStep,
  onSaveStep,
  editingTaskId,
  task,
  onTaskChange,
  assignableUsers,
  taskRelatedItems,
  onCloseTask,
  onSaveTask,
}: Props) {
  return (
    <>
      <Dialog
        open={activeDialog === "progress"}
        onOpenChange={(open) => !open && onCloseProgress()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录跟进</DialogTitle>
            <DialogDescription>
              记录本次沟通或事件。填写新的待跟进事项时，上一条未完成事项会自动归档。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="日期">
              <Input
                type="date"
                className="mt-2"
                value={progress.progressDate}
                onChange={(event) =>
                  onProgressChange({
                    ...progress,
                    progressDate: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="本次跟进内容">
              <Textarea
                className="mt-2"
                value={progress.title}
                onChange={(event) =>
                  onProgressChange({ ...progress, title: event.target.value })
                }
              />
            </Field>
            <Field label="详细说明">
              <Textarea
                className="mt-2"
                value={progress.details}
                onChange={(event) =>
                  onProgressChange({
                    ...progress,
                    details: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="下一步事项（可选）">
              <Input
                className="mt-2"
                value={progress.nextAction}
                onChange={(event) =>
                  onProgressChange({
                    ...progress,
                    nextAction: event.target.value,
                  })
                }
              />
            </Field>
            <Field label="跟进日期（与下一步同时填写）">
              <Input
                type="date"
                className="mt-2"
                value={progress.followUpDate}
                onChange={(event) =>
                  onProgressChange({
                    ...progress,
                    followUpDate: event.target.value,
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={progress.pinned}
                onCheckedChange={(checked) =>
                  onProgressChange({
                    ...progress,
                    pinned: Boolean(checked),
                  })
                }
              />{" "}
              在详情时间线置顶
            </label>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseProgress}>
              取消
            </Button>
            <Button
              disabled={
                !progress.title.trim() ||
                Boolean(progress.nextAction.trim()) !==
                  Boolean(progress.followUpDate)
              }
              onClick={() => void onSaveProgress()}
              className="bg-[#0f766e]"
            >
              保存跟进
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === "step"}
        onOpenChange={(open) => !open && onCloseStep()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStepId ? "修改订单步骤" : "新增订单步骤"}
            </DialogTitle>
            <DialogDescription>
              只调整当前订单，不会影响项目模板。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="步骤名称">
              <Input
                className="mt-2"
                value={step.name}
                onChange={(event) =>
                  onStepChange({ ...step, name: event.target.value })
                }
              />
            </Field>
            <Field label="预计日期">
              <Input
                type="date"
                className="mt-2"
                value={step.dueDate}
                onChange={(event) =>
                  onStepChange({ ...step, dueDate: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={step.required}
                onCheckedChange={(checked) =>
                  onStepChange({ ...step, required: Boolean(checked) })
                }
              />{" "}
              必办步骤
            </label>
            <Field label="备注">
              <Textarea
                className="mt-2"
                value={step.notes}
                onChange={(event) =>
                  onStepChange({ ...step, notes: event.target.value })
                }
              />
            </Field>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseStep}>
              取消
            </Button>
            <Button
              disabled={!step.name.trim()}
              onClick={() => void onSaveStep()}
              className="bg-[#0f766e]"
            >
              保存步骤
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === "task"}
        onOpenChange={(open) => !open && onCloseTask()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTaskId ? "修改订单待办" : "新增订单待办"}
            </DialogTitle>
            <DialogDescription>
              待办只属于当前订单，可同时存在多个未完成事项。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="待办标题">
                <Input
                  className="mt-2"
                  value={task.title}
                  onChange={(event) =>
                    onTaskChange({ ...task, title: event.target.value })
                  }
                  placeholder="例如：催申请人补交无犯罪证明"
                />
              </Field>
            </div>
            <Field label="截止日期">
              <Input
                className="mt-2"
                type="date"
                value={task.dueDate}
                onChange={(event) =>
                  onTaskChange({ ...task, dueDate: event.target.value })
                }
              />
            </Field>
            <Field label="优先级">
              <Choose
                value={task.priority}
                onChange={(priority) => onTaskChange({ ...task, priority })}
                items={Object.entries(taskPriorityLabel).map(([key, label]) => [
                  key,
                  label,
                ])}
              />
            </Field>
            <Field label="负责人">
              <Choose
                value={task.ownerUserId}
                onChange={(ownerUserId) =>
                  onTaskChange({ ...task, ownerUserId })
                }
                items={assignableUsers.map((user) => [
                  String(user.id),
                  `${String(user.display_name)} · ${String(user.username)}`,
                ])}
              />
            </Field>
            <Field label="关联资料（可选）">
              <Choose
                value={
                  task.relatedType && task.relatedId
                    ? `${task.relatedType}:${task.relatedId}`
                    : "NONE"
                }
                onChange={(value) => {
                  const [relatedType = "", relatedId = ""] =
                    value === "NONE" ? [] : value.split(":", 2);
                  onTaskChange({ ...task, relatedType, relatedId });
                }}
                items={taskRelatedItems}
              />
            </Field>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseTask}>
              取消
            </Button>
            <Button
              disabled={
                !task.title.trim() || !task.dueDate || !task.ownerUserId
              }
              onClick={() => void onSaveTask()}
              className="bg-[#0f766e]"
            >
              保存待办
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
