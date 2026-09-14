import { newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { DomainError, isOneOf, textValue, type JsonRecord } from "@/lib/domain";
import { dateField, FIELD_LIMITS, validateTextFields } from "@/lib/validation";

const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const TASK_STATUSES = ["OPEN", "COMPLETED"] as const;
const RELATED_TABLES = {
  STEP: "order_steps",
  APPLICANT: "order_applicants",
  MATERIAL: "order_materials",
  PLAN: "order_plans",
} as const;

async function validateOwner(db: AppDatabase, ownerUserId: string) {
  const owner = ownerUserId ? await db.prepare("SELECT id FROM users WHERE id=? AND active=1").bind(ownerUserId).first() : null;
  if (!owner) throw new DomainError("待办负责人不存在或已停用。", 404);
}

async function validateRelatedObject(db: AppDatabase, orderId: string, relatedType: string, relatedId: string) {
  if (!relatedType && !relatedId) return;
  if (!(relatedType in RELATED_TABLES) || !relatedId) throw new DomainError("待办关联对象不正确。");
  const table = RELATED_TABLES[relatedType as keyof typeof RELATED_TABLES];
  if (!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND order_id=?`).bind(relatedId, orderId).first()) throw new DomainError("待办关联对象不存在。", 404);
}

export async function saveOrderTask(db: AppDatabase, orderId: string, body: JsonRecord, defaultOwnerUserId: string) {
  validateTextFields(body, [
    { key: "taskId", label: "待办编号", max: FIELD_LIMITS.code },
    { key: "title", label: "待办标题", max: FIELD_LIMITS.name, required: true },
    { key: "ownerUserId", label: "待办负责人", max: FIELD_LIMITS.code },
    { key: "relatedType", label: "关联类型", max: FIELD_LIMITS.code },
    { key: "relatedId", label: "关联对象", max: FIELD_LIMITS.code },
  ]);
  const taskId = textValue(body, "taskId");
  const title = textValue(body, "title");
  const dueDate = dateField(body, "dueDate", "截止日期", true)!;
  const priority = textValue(body, "priority") || "MEDIUM";
  const ownerUserId = textValue(body, "ownerUserId") || defaultOwnerUserId;
  const relatedType = textValue(body, "relatedType");
  const relatedId = textValue(body, "relatedId");
  if (!isOneOf(priority, TASK_PRIORITIES)) throw new DomainError("待办优先级不正确。");
  await validateOwner(db, ownerUserId);
  await validateRelatedObject(db, orderId, relatedType, relatedId);
  const now = nowIso();
  if (taskId) {
    const current = await db.prepare("SELECT id FROM order_tasks WHERE id=? AND order_id=? FOR UPDATE").bind(taskId, orderId).first();
    if (!current) throw new DomainError("待办事项不存在。", 404);
    await db.prepare("UPDATE order_tasks SET title=?,due_date=?,priority=?,owner_user_id=?,related_type=?,related_id=?,version=version+1,updated_at=? WHERE id=? AND order_id=?")
      .bind(title, dueDate, priority, ownerUserId, relatedType || null, relatedId || null, now, taskId, orderId).run();
    return taskId;
  }
  const id = newId("tsk");
  await db.prepare("INSERT INTO order_tasks (id,order_id,title,due_date,priority,status,owner_user_id,related_type,related_id,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,'OPEN',?,?,?,NULL,?,?)")
    .bind(id, orderId, title, dueDate, priority, ownerUserId, relatedType || null, relatedId || null, now, now).run();
  return id;
}

export async function changeOrderTaskStatus(db: AppDatabase, orderId: string, taskId: string, status: string) {
  if (!isOneOf(status, TASK_STATUSES)) throw new DomainError("待办状态不正确。");
  const task = taskId ? await db.prepare("SELECT id FROM order_tasks WHERE id=? AND order_id=? FOR UPDATE").bind(taskId, orderId).first() : null;
  if (!task) throw new DomainError("待办事项不存在。", 404);
  const now = nowIso();
  await db.prepare("UPDATE order_tasks SET status=?,completed_at=?,version=version+1,updated_at=? WHERE id=? AND order_id=?")
    .bind(status, status === "COMPLETED" ? now : null, now, taskId, orderId).run();
}

export async function deleteOrderTask(db: AppDatabase, orderId: string, taskId: string) {
  const result = taskId ? await db.prepare("DELETE FROM order_tasks WHERE id=? AND order_id=?").bind(taskId, orderId).run() : null;
  if (!result?.meta?.changes) throw new DomainError("待办事项不存在。", 404);
}
