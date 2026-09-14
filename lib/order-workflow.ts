import type { AppDatabase } from "@/db/driver";
import { newId, nowIso } from "@/db/database";
import {
  DomainError,
  isOneOf,
  ORDER_STATUSES,
  STEP_STATUSES,
  textValue,
  type JsonRecord,
} from "@/lib/domain";
import { dateField } from "@/lib/validation";

type WorkflowOptions = { reason?: string | null; canOverride?: boolean };

async function startNextPending(
  db: AppDatabase,
  orderId: string,
  afterSequence?: number,
) {
  const now = nowIso();
  const candidate =
    afterSequence === undefined
      ? await db
          .prepare(
            "SELECT id FROM order_steps WHERE order_id=? AND status='PENDING' ORDER BY sequence,id LIMIT 1",
          )
          .bind(orderId)
          .first()
      : await db
          .prepare(
            "SELECT id FROM order_steps WHERE order_id=? AND status='PENDING' AND sequence>? ORDER BY sequence,id LIMIT 1",
          )
          .bind(orderId, afterSequence)
          .first();
  if (!candidate) return;
  await db
    .prepare(
      "UPDATE order_steps SET status='IN_PROGRESS',started_at=COALESCE(started_at,?),completed_at=NULL,skip_reason=NULL,version=version+1,updated_at=? WHERE id=?",
    )
    .bind(now, now, candidate.id)
    .run();
}

export async function ensureActiveOrderHasCurrentStep(
  db: AppDatabase,
  orderId: string,
) {
  const order = await db
    .prepare("SELECT status FROM orders WHERE id=? FOR UPDATE")
    .bind(orderId)
    .first();
  if (!order || order.status !== "ACTIVE") return;
  const current = await db
    .prepare(
      "SELECT id FROM order_steps WHERE order_id=? AND status='IN_PROGRESS' LIMIT 1",
    )
    .bind(orderId)
    .first();
  if (!current) await startNextPending(db, orderId);
}

export async function changeOrderStatus(
  db: AppDatabase,
  orderId: string,
  nextStatus: string,
  options: WorkflowOptions = {},
) {
  if (!isOneOf(nextStatus, ORDER_STATUSES))
    throw new DomainError("订单状态不正确。");
  const order = await db
    .prepare("SELECT status FROM orders WHERE id=? FOR UPDATE")
    .bind(orderId)
    .first();
  if (!order) throw new DomainError("订单不存在。", 404);
  const previousStatus = String(order.status);
  if (nextStatus === "COMPLETED")
    throw new DomainError("请使用“正式结案”操作完成订单。");
  if (previousStatus === "COMPLETED")
    throw new DomainError("已结案订单请使用“重新开启”操作。");
  const reason = options.reason?.trim() || null;
  const requiresReason =
    ["PAUSED", "CANCELLED", "REFUNDED"].includes(nextStatus) ||
    (nextStatus === "ACTIVE" &&
      ["PAUSED", "CANCELLED", "REFUNDED"].includes(previousStatus));
  if (requiresReason && !reason)
    throw new DomainError("请填写本次状态变更原因。");
  if (nextStatus === "ACTIVE" && previousStatus === "DRAFT") {
    const incomplete = await db
      .prepare(
        `SELECT COUNT(*) AS value FROM order_applicants a WHERE a.order_id=? AND
      (btrim(a.name)='' OR btrim(a.passport_no)='' OR COALESCE(btrim(a.nationality),'')='' OR a.birth_date IS NULL OR a.passport_expiry IS NULL
       OR NOT EXISTS (SELECT 1 FROM order_materials m JOIN material_files f ON f.material_id=m.id AND f.status='ACTIVE'
         WHERE m.order_id=a.order_id AND m.applicant_id=a.id AND m.system_code='PASSPORT_BIO_PAGE'))`,
      )
      .bind(orderId)
      .first();
    if (Number(incomplete?.value || 0) > 0)
      throw new DomainError(
        "所有申请人都必须完成身份资料并上传护照首页，才能开始办理。",
      );
  }
  const now = nowIso();
  await db
    .prepare(
      "UPDATE orders SET status=?,status_reason=?,status_changed_at=?,version=version+1,updated_at=? WHERE id=?",
    )
    .bind(nextStatus, reason, now, now, orderId)
    .run();
  if (nextStatus === "ACTIVE")
    await ensureActiveOrderHasCurrentStep(db, orderId);
  else
    await db
      .prepare(
        "UPDATE order_steps SET status='PENDING',started_at=NULL,completed_at=NULL,skip_reason=NULL,version=version+1,updated_at=? WHERE order_id=? AND status='IN_PROGRESS'",
      )
      .bind(now, orderId)
      .run();
}

export async function changeOrderStepStatus(
  db: AppDatabase,
  orderId: string,
  stepId: string,
  nextStatus: string,
  options: WorkflowOptions = {},
) {
  if (!stepId || !isOneOf(nextStatus, STEP_STATUSES))
    throw new DomainError("流程步骤或状态不正确。");
  const order = await db
    .prepare("SELECT status FROM orders WHERE id=? FOR UPDATE")
    .bind(orderId)
    .first();
  if (!order) throw new DomainError("订单不存在。", 404);
  if (nextStatus === "IN_PROGRESS" && order.status !== "ACTIVE")
    throw new DomainError(
      "只有办理中的订单才能设置当前流程，请先重新开启订单。",
    );
  const steps = await db
    .prepare(
      "SELECT id,sequence,required,status FROM order_steps WHERE order_id=? ORDER BY sequence,id FOR UPDATE",
    )
    .bind(orderId)
    .all();
  const current = steps.results.find((step) => step.id === stepId);
  if (!current) throw new DomainError("流程步骤不存在。", 404);
  const previousStatus = String(current.status);
  const reason = options.reason?.trim() || null;
  if (nextStatus === "SKIPPED" && Number(current.required) === 1) {
    if (!options.canOverride)
      throw new DomainError(
        "必办流程不能直接跳过，需要“强制调整订单流程”权限。",
        403,
      );
    if (!reason) throw new DomainError("强制跳过必办流程时必须填写原因。");
  }
  const now = nowIso();
  if (nextStatus === "IN_PROGRESS") {
    await db
      .prepare(
        "UPDATE order_steps SET status='PENDING',started_at=NULL,completed_at=NULL,skip_reason=NULL,version=version+1,updated_at=? WHERE order_id=? AND status='IN_PROGRESS' AND id<>?",
      )
      .bind(now, orderId, stepId)
      .run();
  }
  await db
    .prepare(
      `UPDATE order_steps SET status=?,
    started_at=CASE WHEN ?='IN_PROGRESS' THEN COALESCE(started_at,?) WHEN ?='PENDING' THEN NULL ELSE started_at END,
    completed_at=CASE WHEN ?='COMPLETED' THEN ? WHEN ? IN ('PENDING','IN_PROGRESS','SKIPPED') THEN NULL ELSE completed_at END,
    skip_reason=CASE WHEN ?='SKIPPED' THEN ? ELSE NULL END,version=version+1,updated_at=? WHERE id=? AND order_id=?`,
    )
    .bind(
      nextStatus,
      nextStatus,
      now,
      nextStatus,
      nextStatus,
      now,
      nextStatus,
      nextStatus,
      reason,
      now,
      stepId,
      orderId,
    )
    .run();
  if (
    ["COMPLETED", "SKIPPED"].includes(nextStatus) &&
    previousStatus === "IN_PROGRESS"
  ) {
    await startNextPending(db, orderId, Number(current.sequence));
  }
  await db
    .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
    .bind(now, orderId)
    .run();
}

export async function addOrderStep(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
) {
  const name = textValue(body, "name");
  if (!name) throw new DomainError("请填写流程步骤名称。");
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(sequence),0)+1 AS value FROM order_steps WHERE order_id=?",
    )
    .bind(orderId)
    .first();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        "INSERT INTO order_steps (id,order_id,template_id,name,sequence,required,status,due_date,started_at,completed_at,notes,created_at,updated_at) VALUES (?,?,NULL,?,?,?,'PENDING',?,NULL,NULL,?,?,?)",
      )
      .bind(
        newId("stp"),
        orderId,
        name,
        Number(next?.value ?? 1),
        body.required === false ? 0 : 1,
        dateField(body, "dueDate", "预计日期"),
        textValue(body, "notes") || null,
        now,
        now,
      ),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
  await ensureActiveOrderHasCurrentStep(db, orderId);
}

export async function updateOrderStep(
  db: AppDatabase,
  orderId: string,
  body: JsonRecord,
) {
  const stepId = textValue(body, "stepId");
  const name = textValue(body, "name");
  const dueDate = dateField(body, "dueDate", "预计日期") || "";
  if (!stepId || !name) throw new DomainError("请填写流程步骤名称。");
  const now = nowIso();
  const updated = await db
    .prepare(
      "UPDATE order_steps SET name=?,required=?,due_date=?,notes=?,version=version+1,updated_at=? WHERE id=? AND order_id=?",
    )
    .bind(
      name,
      body.required === false ? 0 : 1,
      dueDate || null,
      textValue(body, "notes") || null,
      now,
      stepId,
      orderId,
    )
    .run();
  if (!updated.meta?.changes) throw new DomainError("流程步骤不存在。", 404);
  await db
    .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
    .bind(now, orderId)
    .run();
}

export async function deleteOrderStep(
  db: AppDatabase,
  orderId: string,
  stepId: string,
) {
  const existing = stepId
    ? await db
        .prepare(
          "SELECT id,status FROM order_steps WHERE id=? AND order_id=? FOR UPDATE",
        )
        .bind(stepId, orderId)
        .first()
    : null;
  if (!existing) throw new DomainError("流程步骤不存在。", 404);
  await db
    .prepare("DELETE FROM order_steps WHERE id=? AND order_id=?")
    .bind(stepId, orderId)
    .run();
  if (existing.status === "IN_PROGRESS") await startNextPending(db, orderId);
  const now = nowIso();
  await db
    .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
    .bind(now, orderId)
    .run();
}

export async function moveOrderStep(
  db: AppDatabase,
  orderId: string,
  stepId: string,
  direction: string,
) {
  if (!stepId || !["UP", "DOWN"].includes(direction))
    throw new DomainError("流程排序操作不正确。");
  const current = await db
    .prepare(
      "SELECT id,sequence FROM order_steps WHERE id=? AND order_id=? FOR UPDATE",
    )
    .bind(stepId, orderId)
    .first();
  if (!current) throw new DomainError("流程步骤不存在。", 404);
  const target =
    direction === "UP"
      ? await db
          .prepare(
            "SELECT id,sequence FROM order_steps WHERE order_id=? AND sequence<? ORDER BY sequence DESC,id LIMIT 1 FOR UPDATE",
          )
          .bind(orderId, current.sequence)
          .first()
      : await db
          .prepare(
            "SELECT id,sequence FROM order_steps WHERE order_id=? AND sequence>? ORDER BY sequence,id LIMIT 1 FOR UPDATE",
          )
          .bind(orderId, current.sequence)
          .first();
  if (!target) return;
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        "UPDATE order_steps SET sequence=?,version=version+1,updated_at=? WHERE id=? AND order_id=?",
      )
      .bind(target.sequence, now, current.id, orderId),
    db
      .prepare(
        "UPDATE order_steps SET sequence=?,version=version+1,updated_at=? WHERE id=? AND order_id=?",
      )
      .bind(current.sequence, now, target.id, orderId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
}
