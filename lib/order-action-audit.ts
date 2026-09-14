import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { AppDatabase } from "@/db/driver";
import { getOrderActionPolicy } from "@/lib/order-action-policy";
import { orderScopeFilter } from "@/lib/order-access";
import { textValue, type JsonRecord } from "@/lib/domain";

export async function readOrderActionSnapshot(
  db: AppDatabase,
  orderNo: string,
  body: JsonRecord,
  user: ChatGPTUser,
  enforceScope = true,
) {
  const scope = enforceScope
    ? orderScopeFilter(user, "o")
    : { sql: "TRUE", values: [] as unknown[] };
  const order = await db
    .prepare(
      `SELECT o.id,o.order_no,o.owner_user_id,o.status,o.status_reason,o.signed_at,o.notes,o.closed_on,o.closure_result,o.closure_notes,o.closed_at,o.closed_by,o.version FROM orders o WHERE o.order_no=? AND ${scope.sql}`,
    )
    .bind(orderNo, ...scope.values)
    .first();
  if (!order) return null;

  const action = textValue(body, "action");
  const target = getOrderActionPolicy(action).target;
  const targetId = target ? textValue(body, target.idField) : "";
  const targetRow =
    target && targetId
      ? await db
          .prepare(`SELECT * FROM ${target.table} WHERE id=? AND order_id=?`)
          .bind(targetId, order.id)
          .first()
      : null;
  return { order, target: targetRow };
}
