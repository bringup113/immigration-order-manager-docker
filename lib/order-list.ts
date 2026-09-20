import { getDatabase } from "@/db/database";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { hasPermission } from "@/lib/docker-auth";
import { orderScopeFilter } from "@/lib/order-access";
import { likePattern, searchTerms } from "@/lib/order-search";
import { orderSortSql } from "@/lib/order-sort";

export async function listOrders(user: ChatGPTUser, params: URLSearchParams) {
  const db = getDatabase();
  const sortSql = orderSortSql(params.get("sort"));
  const scope = orderScopeFilter(user, "o");
  const page = Math.min(100000, Math.max(1, parseInt(params.get("page") || "1", 10) || 1));
  const pageSize = Math.min(100, Math.max(1, parseInt(params.get("pageSize") || "30", 10) || 30));
  const values: unknown[] = [...scope.values];
  const filters = [scope.sql];
  if (params.get("owner")) { filters.push("o.owner_user_id=?"); values.push(params.get("owner")); }
  if (params.get("status")) { filters.push("o.status=?"); values.push(params.get("status")); }
  const domains = ["search_order_blob", ...(hasPermission(user, "finance.read") ? ["search_finance_blob"] : []), ...(hasPermission(user, "materials.read") ? ["search_material_blob"] : []), ...(hasPermission(user, "tasks.read") ? ["search_task_blob"] : [])];
  for (const term of searchTerms((params.get("q") || "").slice(0,160))) {
    filters.push(`EXISTS (SELECT 1 FROM order_search_index i WHERE i.order_id=o.id AND (${domains.map((field) => `i.${field} LIKE ?`).join(" OR ")}))`);
    values.push(...domains.map(() => likePattern(term)));
  }
  const finance = hasPermission(user, "finance.read");

const countRow = await db
  .prepare(`SELECT COUNT(*) AS total FROM orders o WHERE ${filters.join(" AND ")}`)
  .bind(...values)
  .first();

const total = Number(countRow?.total || 0);
const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const rows = await db.prepare(`WITH page AS MATERIALIZED (
      SELECT o.* FROM orders o WHERE ${filters.join(" AND ")} ORDER BY ${sortSql} LIMIT ? OFFSET ?
    ) SELECT o.id,o.order_no,o.status,o.owner_user_id,o.created_at,c.name AS agent_name,
      u.display_name AS owner_name,u.username AS owner_username,o.project_name_snapshot AS project_name,o.country_snapshot AS country,
      (SELECT name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' LIMIT 1) AS main_applicant,
      step.name AS current_step,step.status AS current_step_status,step.due_date AS current_step_due_date,
      stats.in_progress_steps,stats.completed_steps,stats.total_steps,
      follow.title AS pending_follow_up,follow.follow_up_date AS pending_follow_up_date
      ${finance ? `,plans.receivable_base_minor,plans.payable_base_minor,cash.received_base_minor,cash.paid_base_minor` : ""}
      FROM page o JOIN agents c ON c.id=o.agent_id JOIN users u ON u.id=o.owner_user_id
      LEFT JOIN LATERAL (SELECT s.name,s.status,s.due_date FROM order_steps s WHERE s.order_id=o.id AND s.status IN ('IN_PROGRESS','PENDING') ORDER BY CASE s.status WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,s.sequence LIMIT 1) step ON TRUE
      LEFT JOIN LATERAL (SELECT COUNT(*) FILTER(WHERE status='IN_PROGRESS') AS in_progress_steps,COUNT(*) FILTER(WHERE status='COMPLETED') AS completed_steps,COUNT(*) AS total_steps FROM order_steps WHERE order_id=o.id) stats ON TRUE
      LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(g.next_action,''),g.title) AS title,g.follow_up_date FROM order_progress g WHERE g.order_id=o.id AND g.follow_up_done=0 AND g.follow_up_date IS NOT NULL ORDER BY g.follow_up_date,g.created_at DESC LIMIT 1) follow ON TRUE
      ${finance ? `LEFT JOIN LATERAL (SELECT COALESCE(SUM(planned_base_minor) FILTER(WHERE plan_type='RECEIVABLE'),0) AS receivable_base_minor,COALESCE(SUM(planned_base_minor) FILTER(WHERE plan_type='PAYABLE'),0) AS payable_base_minor FROM order_plans WHERE order_id=o.id) plans ON TRUE
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(base_amount_minor) FILTER(WHERE direction='RECEIPT'),0) AS received_base_minor,COALESCE(SUM(base_amount_minor) FILTER(WHERE direction='PAYMENT'),0) AS paid_base_minor FROM order_cash_entries WHERE order_id=o.id AND status='ACTIVE') cash ON TRUE` : ""}
      ORDER BY ${sortSql}`).bind(...values,pageSize+1,(page-1)*pageSize).all();
  const owners = await db.prepare(`SELECT u.id,u.display_name AS name,u.username FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.owner_user_id=u.id AND ${scope.sql}) ORDER BY u.display_name,u.id`).bind(...scope.values).all();
  return { rows: rows.results.slice(0,pageSize),page,pageSize,total,totalPages,hasMore: rows.results.length>pageSize,owners: owners.results };
}
