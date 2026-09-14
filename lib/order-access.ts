import type { AppDatabase } from "@/db/driver";
import type { AppUser } from "@/lib/docker-auth";

export type OrderScope = "ALL" | "OWN";

export function canAccessAllOrders(user: AppUser) {
  return user.roleCode === "OWNER" || user.orderScope === "ALL";
}

export function orderScopeFilter(user: AppUser, alias = "o") {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("订单查询别名不正确。");
  return canAccessAllOrders(user)
    ? { sql: "TRUE", values: [] as unknown[] }
    : { sql: `${alias}.owner_user_id=?`, values: [user.id] as unknown[] };
}

export async function accessibleOrderByNumber(db: AppDatabase, user: AppUser, orderNo: string, forUpdate = false) {
  const scope = orderScopeFilter(user, "o");
  return db.prepare(`SELECT o.* FROM orders o WHERE o.order_no=? AND ${scope.sql}${forUpdate ? " FOR UPDATE" : ""}`)
    .bind(orderNo, ...scope.values).first();
}

export async function accessibleOrderById(db: AppDatabase, user: AppUser, orderId: string, forUpdate = false) {
  const scope = orderScopeFilter(user, "o");
  return db.prepare(`SELECT o.* FROM orders o WHERE o.id=? AND ${scope.sql}${forUpdate ? " FOR UPDATE" : ""}`)
    .bind(orderId, ...scope.values).first();
}
