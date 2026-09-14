import type { AppDatabase } from "@/db/driver";
import { newId, nowIso } from "@/db/database";
import { DomainError } from "@/lib/domain";

export type ClosureCheck = {
  incompleteRequiredSteps: number;
  missingRequiredMaterials: number;
  openTasks: number;
  openFollowUps: number;
  receivableBaseMinor: number;
  payableBaseMinor: number;
  receivedBaseMinor: number;
  paidBaseMinor: number;
};

export async function getOrderClosureCheck(db: AppDatabase, orderId: string): Promise<ClosureCheck> {
  const [steps, materials, tasks, followUps, finance] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS value FROM order_steps WHERE order_id=? AND required=1 AND status NOT IN ('COMPLETED','SKIPPED')").bind(orderId).first(),
    db.prepare("SELECT COUNT(*) AS value FROM order_materials m WHERE m.order_id=? AND m.required=1 AND NOT EXISTS (SELECT 1 FROM material_files f WHERE f.material_id=m.id AND f.status='ACTIVE')").bind(orderId).first(),
    db.prepare("SELECT COUNT(*) AS value FROM order_tasks WHERE order_id=? AND status='OPEN'").bind(orderId).first(),
    db.prepare("SELECT COUNT(*) AS value FROM order_progress WHERE order_id=? AND follow_up_done=0 AND follow_up_date IS NOT NULL").bind(orderId).first(),
    db.prepare(`SELECT
      COALESCE((SELECT SUM(planned_base_minor) FROM order_plans WHERE order_id=? AND plan_type='RECEIVABLE'),0) AS receivable_base_minor,
      COALESCE((SELECT SUM(planned_base_minor) FROM order_plans WHERE order_id=? AND plan_type='PAYABLE'),0) AS payable_base_minor,
      COALESCE((SELECT SUM(base_amount_minor) FROM order_cash_entries WHERE order_id=? AND direction='RECEIPT' AND status='ACTIVE'),0) AS received_base_minor,
      COALESCE((SELECT SUM(base_amount_minor) FROM order_cash_entries WHERE order_id=? AND direction='PAYMENT' AND status='ACTIVE'),0) AS paid_base_minor`).bind(orderId, orderId, orderId, orderId).first(),
  ]);
  return {
    incompleteRequiredSteps: Number(steps?.value ?? 0),
    missingRequiredMaterials: Number(materials?.value ?? 0),
    openTasks: Number(tasks?.value ?? 0),
    openFollowUps: Number(followUps?.value ?? 0),
    receivableBaseMinor: Number(finance?.receivable_base_minor ?? 0),
    payableBaseMinor: Number(finance?.payable_base_minor ?? 0),
    receivedBaseMinor: Number(finance?.received_base_minor ?? 0),
    paidBaseMinor: Number(finance?.paid_base_minor ?? 0),
  };
}

export async function closeOrder(db: AppDatabase, orderId: string, input: { closedOn: string; result: string; notes: string; reason: string; actorUserId: string; canOverride: boolean }) {
  const order = await db.prepare("SELECT status FROM orders WHERE id=? FOR UPDATE").bind(orderId).first();
  if (!order) throw new DomainError("订单不存在。", 404);
  if (order.status === "COMPLETED") throw new DomainError("订单已经结案。请先重新开启后再操作。");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.closedOn)) throw new DomainError("请填写正确的结案日期。");
  if (!input.result.trim()) throw new DomainError("请填写结案结果。");
  const check = await getOrderClosureCheck(db, orderId);
  if (check.incompleteRequiredSteps > 0) {
    if (!input.canOverride) throw new DomainError("仍有必办流程未完成，需要“强制调整订单流程”权限才能结案。", 403);
    if (!input.reason.trim()) throw new DomainError("强制结案必须填写原因。");
  }
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE orders SET status='COMPLETED',status_reason=?,status_changed_at=?,closed_on=?,closure_result=?,closure_notes=?,closed_at=?,closed_by=?,version=version+1,updated_at=? WHERE id=?")
      .bind(input.reason.trim() || null, now, input.closedOn, input.result.trim(), input.notes.trim() || null, now, input.actorUserId, now, orderId),
    db.prepare("UPDATE order_steps SET status='PENDING',started_at=NULL,completed_at=NULL,skip_reason=NULL,version=version+1,updated_at=? WHERE order_id=? AND status='IN_PROGRESS'").bind(now, orderId),
    db.prepare("INSERT INTO order_closure_events (id,order_id,action,closed_on,result,notes,reason,actor_user_id,created_at) VALUES (?,?,'CLOSE',?,?,?,?,?,?)")
      .bind(newId("cle"), orderId, input.closedOn, input.result.trim(), input.notes.trim() || null, input.reason.trim() || null, input.actorUserId, now),
  ]);
  return check;
}

export async function reopenOrder(db: AppDatabase, orderId: string, reason: string, actorUserId: string) {
  const order = await db.prepare("SELECT status,closed_on,closure_result,closure_notes FROM orders WHERE id=? FOR UPDATE").bind(orderId).first();
  if (!order) throw new DomainError("订单不存在。", 404);
  if (order.status !== "COMPLETED") throw new DomainError("只有已结案订单才能重新开启。");
  if (!reason.trim()) throw new DomainError("重新开启订单必须填写原因。");
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE orders SET status='ACTIVE',status_reason=?,status_changed_at=?,closed_on=NULL,closure_result=NULL,closure_notes=NULL,closed_at=NULL,closed_by=NULL,version=version+1,updated_at=? WHERE id=?")
      .bind(reason.trim(), now, now, orderId),
    db.prepare("INSERT INTO order_closure_events (id,order_id,action,closed_on,result,notes,reason,actor_user_id,created_at) VALUES (?,?,'REOPEN',?,?,?,?,?,?)")
      .bind(newId("cle"), orderId, order.closed_on, order.closure_result, order.closure_notes, reason.trim(), actorUserId, now),
  ]);
}
