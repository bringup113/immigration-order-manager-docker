type OrderActionTarget = {
  table: string;
  idField: string;
};

type OrderActionPolicy = {
  permission: string;
  label: string;
  target?: OrderActionTarget;
  entityType?: "APPLICANT" | "TASK" | "CASH_ENTRY";
  entityIdField?: string;
  entityLabelField?: string;
  redactRawMrz?: boolean;
};

const target = (table: string, idField: string): OrderActionTarget => ({
  table,
  idField,
});

export const ORDER_ACTION_POLICIES = {
  assignOwner: { permission: "orders.assign", label: "分配订单负责人" },
  saveTask: {
    permission: "tasks.write",
    label: "保存订单待办",
    target: target("order_tasks", "taskId"),
    entityType: "TASK",
    entityIdField: "taskId",
    entityLabelField: "title",
  },
  toggleTask: {
    permission: "tasks.write",
    label: "更新待办状态",
    target: target("order_tasks", "taskId"),
    entityType: "TASK",
    entityIdField: "taskId",
  },
  deleteTask: {
    permission: "tasks.write",
    label: "删除订单待办",
    target: target("order_tasks", "taskId"),
    entityType: "TASK",
    entityIdField: "taskId",
  },
  progress: { permission: "orders.write", label: "新增跟进记录" },
  completeFollowUp: {
    permission: "orders.write",
    label: "完成跟进事项",
    target: target("order_progress", "progressId"),
  },
  status: { permission: "orders.write", label: "修改订单状态" },
  closeOrder: { permission: "orders.write", label: "正式结案" },
  reopenOrder: { permission: "orders.override", label: "重新开启订单" },
  updateNotes: { permission: "orders.write", label: "修改订单备注" },
  updateSignedAt: { permission: "orders.write", label: "修改签订日期" },
  updateApplicant: {
    permission: "applicants.write",
    label: "修改申请人",
    target: target("order_applicants", "applicantId"),
  },
  addApplicant: { permission: "applicants.write", label: "添加附属申请人" },
  deleteApplicant: {
    permission: "applicants.write",
    label: "删除附属申请人",
    target: target("order_applicants", "applicantId"),
  },
  confirmMrz: {
    permission: "applicants.mrz",
    label: "确认护照 MRZ 识别结果",
    target: target("order_applicants", "applicantId"),
    entityType: "APPLICANT",
    entityIdField: "applicantId",
    redactRawMrz: true,
  },
  step: {
    permission: "orders.write",
    label: "修改流程状态",
    target: target("order_steps", "stepId"),
  },
  addStep: { permission: "orders.write", label: "新增订单流程" },
  updateStep: {
    permission: "orders.write",
    label: "修改订单流程",
    target: target("order_steps", "stepId"),
  },
  deleteStep: {
    permission: "orders.write",
    label: "删除订单流程",
    target: target("order_steps", "stepId"),
  },
  moveStep: {
    permission: "orders.write",
    label: "调整流程顺序",
    target: target("order_steps", "stepId"),
  },
  addMaterial: { permission: "materials.write", label: "新增订单材料" },
  updateMaterial: {
    permission: "materials.write",
    label: "修改订单材料",
    target: target("order_materials", "materialId"),
  },
  deleteMaterial: {
    permission: "materials.write",
    label: "删除订单材料",
    target: target("order_materials", "materialId"),
  },
  plan: { permission: "finance.write", label: "新增订单计划" },
  updatePlan: {
    permission: "finance.write",
    label: "修改订单计划",
    target: target("order_plans", "planId"),
  },
  deletePlan: {
    permission: "finance.write",
    label: "删除订单计划",
    target: target("order_plans", "planId"),
  },
  movePlan: {
    permission: "finance.write",
    label: "调整订单计划顺序",
    target: target("order_plans", "planId"),
  },
  saveCashEntry: {
    permission: "finance.write",
    label: "保存收付款记录",
    target: target("order_cash_entries", "entryId"),
    entityType: "CASH_ENTRY",
    entityIdField: "entryId",
    entityLabelField: "description",
  },
  voidCashEntry: {
    permission: "finance.write",
    label: "作废收付款记录",
    target: target("order_cash_entries", "entryId"),
    entityType: "CASH_ENTRY",
    entityIdField: "entryId",
    entityLabelField: "description",
  },
  restoreCashEntry: {
    permission: "finance.restore",
    label: "恢复收付款记录",
    target: target("order_cash_entries", "entryId"),
    entityType: "CASH_ENTRY",
    entityIdField: "entryId",
    entityLabelField: "description",
  },
} as const satisfies Record<string, OrderActionPolicy>;

export type OrderAction = keyof typeof ORDER_ACTION_POLICIES;

export function getOrderActionPolicy(action: string): OrderActionPolicy {
  return (
    ORDER_ACTION_POLICIES[action as OrderAction] || {
      permission: "orders.write",
      label: "更新订单",
    }
  );
}

export function orderActionAuditCode(
  action: string,
  values: { taskId?: string; taskStatus?: string } = {},
) {
  if (action === "confirmMrz") return "APPLICANT_MRZ_CONFIRM";
  if (action === "saveTask")
    return values.taskId ? "TASK_UPDATE" : "TASK_CREATE";
  if (action === "toggleTask")
    return values.taskStatus === "COMPLETED" ? "TASK_COMPLETE" : "TASK_REOPEN";
  if (action === "deleteTask") return "TASK_DELETE";
  if (action === "voidCashEntry") return "CASH_ENTRY_VOID";
  if (action === "restoreCashEntry") return "CASH_ENTRY_RESTORE";
  if (action === "closeOrder") return "ORDER_CLOSE";
  if (action === "reopenOrder") return "ORDER_REOPEN";
  return `ORDER_${action.toUpperCase()}`;
}
