import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";
import { RATE_SCALE } from "@/db/defaults";
import { toMinor } from "@/lib/amount";
import {
  calculateCashValues,
  type CashCalculatedField,
} from "@/lib/cash-calculation";
import {
  CASH_DIRECTIONS,
  DomainError,
  isOneOf,
  PLAN_TYPES,
  rateForCurrency,
  requireActiveCurrency,
  textValue,
  toBaseMinor,
  type JsonRecord,
} from "@/lib/domain";
import { dateField, FIELD_LIMITS, validateTextFields } from "@/lib/validation";

export async function addOrderPlan(
  orderId: string,
  body: JsonRecord,
  db: AppDatabase = getDatabase(),
) {
  validateTextFields(body, [
    {
      key: "name",
      label: "阶段名称",
      max: FIELD_LIMITS.name,
      required: true,
    },
    { key: "notes", label: "备注", max: FIELD_LIMITS.notes },
  ]);
  const planType = textValue(body, "planType");
  const name = textValue(body, "name");
  const currency = textValue(body, "currency") || "USD";
  const amountMinor = toMinor(body.amount);
  if (!isOneOf(planType, PLAN_TYPES) || !name || amountMinor <= 0)
    throw new DomainError("请完整填写阶段名称和金额。");
  const rateScaled = await rateForCurrency(db, currency);
  if (!rateScaled) throw new DomainError(`没有可用的 ${currency} 汇率。`);
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(sequence),0)+1 AS value FROM order_plans WHERE order_id=? AND plan_type=?",
    )
    .bind(orderId, planType)
    .first();
  await db
    .prepare(
      "INSERT INTO order_plans (id,order_id,template_id,plan_type,sequence,name,currency,planned_amount_minor,budget_rate_scaled,planned_base_minor,due_date,channel_id,notes) VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      newId("pln"),
      orderId,
      planType,
      Number(next?.value ?? 1),
      name,
      currency,
      amountMinor,
      rateScaled,
      toBaseMinor(amountMinor, rateScaled),
      dateField(body, "dueDate", "计划日期"),
      textValue(body, "channelId") || null,
      textValue(body, "notes") || null,
    )
    .run();
}

export async function updateOrderPlan(
  orderId: string,
  body: JsonRecord,
  db: AppDatabase = getDatabase(),
) {
  validateTextFields(body, [
    {
      key: "planId",
      label: "收付款计划",
      max: FIELD_LIMITS.code,
      required: true,
    },
    { key: "name", label: "计划名称", max: FIELD_LIMITS.name, required: true },
    { key: "notes", label: "备注", max: FIELD_LIMITS.notes },
  ]);
  const planId = textValue(body, "planId");
  const existing = planId
    ? await db
        .prepare("SELECT * FROM order_plans WHERE id=? AND order_id=?")
        .bind(planId, orderId)
        .first()
    : null;
  if (!existing) throw new DomainError("收付款计划不存在。", 404);
  const planType = textValue(body, "planType");
  const name = textValue(body, "name");
  const currency = textValue(body, "currency").toUpperCase();
  const amountMinor = toMinor(body.amount);
  if (!isOneOf(planType, PLAN_TYPES) || !name || amountMinor <= 0)
    throw new DomainError("请完整填写计划类型、名称和大于 0 的金额。");
  const dueDate = dateField(body, "dueDate", "计划日期");
  const linked = await db
    .prepare(
      "SELECT COUNT(*) AS value FROM order_cash_entries WHERE order_plan_id=?",
    )
    .bind(planId)
    .first();
  if (
    Number(linked?.value ?? 0) > 0 &&
    (planType !== existing.plan_type || currency !== existing.currency)
  ) {
    throw new DomainError(
      "这条计划已有收付款记录，不能再修改类型或币种；名称、金额和日期仍可修改。",
    );
  }
  const rateScaled =
    currency === existing.currency
      ? Number(existing.budget_rate_scaled)
      : await rateForCurrency(db, currency);
  if (!rateScaled) throw new DomainError(`没有可用的 ${currency} 汇率。`);
  let sequence = Number(existing.sequence);
  if (planType !== existing.plan_type) {
    const next = await db
      .prepare(
        "SELECT COALESCE(MAX(sequence),0)+1 AS value FROM order_plans WHERE order_id=? AND plan_type=?",
      )
      .bind(orderId, planType)
      .first();
    sequence = Number(next?.value ?? 1);
  }
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        "UPDATE order_plans SET plan_type=?,sequence=?,name=?,currency=?,planned_amount_minor=?,budget_rate_scaled=?,planned_base_minor=?,due_date=?,notes=? WHERE id=? AND order_id=?",
      )
      .bind(
        planType,
        sequence,
        name,
        currency,
        amountMinor,
        rateScaled,
        toBaseMinor(amountMinor, rateScaled),
        dueDate || null,
        textValue(body, "notes") || null,
        planId,
        orderId,
      ),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
}

export async function deleteOrderPlan(
  orderId: string,
  planId: string,
  db: AppDatabase = getDatabase(),
) {
  const existing = planId
    ? await db
        .prepare("SELECT id FROM order_plans WHERE id=? AND order_id=?")
        .bind(planId, orderId)
        .first()
    : null;
  if (!existing) throw new DomainError("收付款计划不存在。", 404);
  const linked = await db
    .prepare(
      "SELECT COUNT(*) AS value FROM order_cash_entries WHERE order_plan_id=?",
    )
    .bind(planId)
    .first();
  if (Number(linked?.value ?? 0) > 0)
    throw new DomainError(
      "这条计划已有收付款历史，不能删除；仍可修改名称、金额和日期。",
    );
  await db.batch([
    db
      .prepare("DELETE FROM order_plans WHERE id=? AND order_id=?")
      .bind(planId, orderId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(nowIso(), orderId),
  ]);
}

export async function moveOrderPlan(
  orderId: string,
  planId: string,
  direction: string,
  db: AppDatabase = getDatabase(),
) {
  if (!planId || !["UP", "DOWN"].includes(direction))
    throw new DomainError("收付款计划排序操作不正确。");
  const current = await db
    .prepare(
      "SELECT id,plan_type,sequence FROM order_plans WHERE id=? AND order_id=?",
    )
    .bind(planId, orderId)
    .first();
  if (!current) throw new DomainError("收付款计划不存在。", 404);
  const target =
    direction === "UP"
      ? await db
          .prepare(
            "SELECT id,sequence FROM order_plans WHERE order_id=? AND plan_type=? AND sequence<? ORDER BY sequence DESC LIMIT 1",
          )
          .bind(orderId, current.plan_type, current.sequence)
          .first()
      : await db
          .prepare(
            "SELECT id,sequence FROM order_plans WHERE order_id=? AND plan_type=? AND sequence>? ORDER BY sequence LIMIT 1",
          )
          .bind(orderId, current.plan_type, current.sequence)
          .first();
  if (!target) return;
  await db.batch([
    db
      .prepare("UPDATE order_plans SET sequence=? WHERE id=? AND order_id=?")
      .bind(target.sequence, current.id, orderId),
    db
      .prepare("UPDATE order_plans SET sequence=? WHERE id=? AND order_id=?")
      .bind(current.sequence, target.id, orderId),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(nowIso(), orderId),
  ]);
}

export async function saveCashEntry(
  orderId: string,
  body: JsonRecord,
  db: AppDatabase = getDatabase(),
) {
  validateTextFields(body, [
    { key: "entryId", label: "收付款记录", max: FIELD_LIMITS.code },
    {
      key: "description",
      label: "收付款说明",
      max: FIELD_LIMITS.name,
      required: true,
    },
    { key: "notes", label: "备注", max: FIELD_LIMITS.notes },
  ]);
  const entryId = textValue(body, "entryId");
  if (
    entryId &&
    !(await db
      .prepare(
        "SELECT id FROM order_cash_entries WHERE id=? AND order_id=? AND status='ACTIVE'",
      )
      .bind(entryId, orderId)
      .first())
  )
    throw new DomainError("有效的收付款记录不存在。", 404);
  const direction = textValue(body, "direction");
  const entryDate = dateField(body, "entryDate", "收付款日期", true)!;
  const description = textValue(body, "description");
  const currency = await requireActiveCurrency(db, body.currency);
  const calculatedField = textValue(
    body,
    "calculatedField",
  ) as CashCalculatedField;
  if (!isOneOf(direction, CASH_DIRECTIONS))
    throw new DomainError("收付款方向不正确。");
  if (!description) throw new DomainError("请填写收付款说明。");
  if (
    !(["amount", "ratePerUsd", "baseAmount"] as string[]).includes(
      calculatedField,
    )
  )
    throw new DomainError("请选择由系统自动计算的金额或汇率。");
  const calculated = calculateCashValues({
    amount: body.amount,
    ratePerUsd: body.ratePerUsd,
    baseAmount: body.baseAmount,
    calculatedField,
  });
  if (!calculated)
    throw new DomainError(
      "原币金额、USD 金额和汇率中，请填写两项大于 0 的数值。",
    );
  const { amountMinor, baseAmountMinor, rateScaled } = calculated;
  if (currency === "USD" && rateScaled !== RATE_SCALE)
    throw new DomainError("USD 汇率必须为 1。");
  if (currency === "USD" && amountMinor !== baseAmountMinor)
    throw new DomainError("USD 原币金额必须与本位币金额一致。");

  const planId = textValue(body, "orderPlanId");
  let planCurrency: string | null = null;
  let planAmountMinor: number | null = null;
  if (planId) {
    const plan = await db
      .prepare(
        "SELECT id,plan_type,currency,budget_rate_scaled FROM order_plans WHERE id=? AND order_id=?",
      )
      .bind(planId, orderId)
      .first();
    if (!plan) throw new DomainError("所选收付款计划不存在。", 404);
    const expectedType = direction === "RECEIPT" ? "RECEIVABLE" : "PAYABLE";
    if (plan.plan_type !== expectedType)
      throw new DomainError("收款只能关联应收计划，付款只能关联应付计划。");
    planCurrency = String(plan.currency);
    planAmountMinor =
      currency === planCurrency
        ? amountMinor
        : Math.round(
            (baseAmountMinor * Number(plan.budget_rate_scaled)) / RATE_SCALE,
          );
    if (planAmountMinor <= 0)
      throw new DomainError("折算后的计划币种金额必须大于 0。");
  }

  const now = nowIso();
  if (entryId) {
    await db.batch([
      db
        .prepare(
          "UPDATE order_cash_entries SET order_plan_id=?,direction=?,entry_date=?,description=?,currency=?,amount_minor=?,rate_scaled=?,base_amount_minor=?,plan_currency=?,plan_amount_minor=?,notes=?,updated_at=? WHERE id=? AND order_id=? AND status='ACTIVE'",
        )
        .bind(
          planId || null,
          direction,
          entryDate,
          description,
          currency,
          amountMinor,
          rateScaled,
          baseAmountMinor,
          planCurrency,
          planAmountMinor,
          textValue(body, "notes") || null,
          now,
          entryId,
          orderId,
        ),
      db
        .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
        .bind(now, orderId),
    ]);
    return entryId;
  }
  const id = newId("pay");
  await db.batch([
    db
      .prepare(
        "INSERT INTO order_cash_entries (id,order_id,order_plan_id,direction,entry_date,description,currency,amount_minor,rate_scaled,base_amount_minor,plan_currency,plan_amount_minor,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        orderId,
        planId || null,
        direction,
        entryDate,
        description,
        currency,
        amountMinor,
        rateScaled,
        baseAmountMinor,
        planCurrency,
        planAmountMinor,
        textValue(body, "notes") || null,
        now,
        now,
      ),
    db
      .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
      .bind(now, orderId),
  ]);
  return id;
}

export async function voidCashEntry(
  orderId: string,
  entryId: string,
  reason: string,
  userId: string,
  db: AppDatabase = getDatabase(),
) {
  if (!reason.trim()) throw new DomainError("作废收付款记录时必须填写原因。");
  const now = nowIso();
  const result = await db
    .prepare(
      "UPDATE order_cash_entries SET status='VOIDED',void_reason=?,voided_at=?,voided_by=?,version=version+1,updated_at=? WHERE id=? AND order_id=? AND status='ACTIVE'",
    )
    .bind(reason.trim(), now, userId, now, entryId, orderId)
    .run();
  if (!result.meta?.changes)
    throw new DomainError("有效的收付款记录不存在。", 404);
  await db
    .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
    .bind(now, orderId)
    .run();
}

export async function restoreCashEntry(
  orderId: string,
  entryId: string,
  reason: string,
  db: AppDatabase = getDatabase(),
) {
  if (!reason.trim()) throw new DomainError("恢复收付款记录时必须填写原因。");
  const now = nowIso();
  const result = await db
    .prepare(
      "UPDATE order_cash_entries SET status='ACTIVE',void_reason=NULL,voided_at=NULL,voided_by=NULL,version=version+1,updated_at=? WHERE id=? AND order_id=? AND status='VOIDED'",
    )
    .bind(now, entryId, orderId)
    .run();
  if (!result.meta?.changes)
    throw new DomainError("已作废的收付款记录不存在。", 404);
  await db
    .prepare("UPDATE orders SET version=version+1,updated_at=? WHERE id=?")
    .bind(now, orderId)
    .run();
}
