import { NextResponse } from "next/server";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getDatabase } from "@/db/database";
import { orderScopeFilter } from "@/lib/order-access";
import { hasPermission } from "@/lib/docker-auth";
import { jsonError } from "@/lib/api-auth";
import { getOrderClosureCheck } from "@/lib/order-closure";

export async function readOrderDetail(
  user: ChatGPTUser,
  orderNo: string,
  params: URLSearchParams,
) {
  const db = getDatabase();
  const scope = orderScopeFilter(user, "o");
  const order = await db
    .prepare(
      `SELECT o.*,c.name AS agent_name,u.display_name AS owner_name,u.username AS owner_username
    FROM orders o JOIN agents c ON c.id=o.agent_id JOIN users u ON u.id=o.owner_user_id
    WHERE o.order_no=? AND ${scope.sql}`,
    )
    .bind(orderNo, ...scope.values)
    .first();
  if (!order) return jsonError("订单不存在。", 404);
  const id = String(order.id);
  const section = params.get("section") || "all";
  const overview = section === "overview";
  const workflow = section === "all" || section === "workflow";
  const finance = section === "all" || section === "finance";
  const files =
    section === "all" || section === "people" || section === "common";
  const closure = overview || section === "all" || params.get("closure") === "1";
  const historyPage = Math.max(
    1,
    Math.min(100000, parseInt(params.get("historyPage") || "1", 10) || 1),
  );
  const cashPage = Math.max(
    1,
    Math.min(100000, parseInt(params.get("cashPage") || "1", 10) || 1),
  );
  const canReadFinance = hasPermission(user, "finance.read");
  const canWriteFinance = hasPermission(user, "finance.write");
  const canReadMaterials = hasPermission(user, "materials.read");
  const [
    applicants,
    mrzRecords,
    steps,
    plans,
    materials,
    materialFiles,
    progress,
    cashEntries,
    totals,
    tasks,
    assignableUsers,
    availableCurrencies,
    closureCheck,
    closureHistory,
  ] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM order_applicants WHERE order_id=? ORDER BY sequence",
      )
      .bind(id)
      .all(),
    db
      .prepare(
        `SELECT DISTINCT ON (r.applicant_id) r.id,r.applicant_id,r.material_file_id,r.checksums_json,r.overall_status,r.created_at,r.confirmed_at,u.display_name AS confirmed_by_name
      FROM applicant_mrz_records r JOIN users u ON u.id=r.confirmed_by WHERE r.order_id=? ORDER BY r.applicant_id,r.created_at DESC`,
      )
      .bind(id)
      .all(),
    db
      .prepare("SELECT * FROM order_steps WHERE order_id=? ORDER BY sequence")
      .bind(id)
      .all(),
    canReadFinance
      ? db
          .prepare(
            `SELECT op.*,c.name AS channel_name,
      allocation.allocated_minor,allocation.allocated_base_minor,allocation.entry_count
      FROM order_plans op LEFT JOIN channels c ON c.id=op.channel_id
      LEFT JOIN LATERAL (SELECT COALESCE(SUM(e.plan_amount_minor),0) AS allocated_minor,
        COALESCE(SUM(e.base_amount_minor),0) AS allocated_base_minor,COUNT(*) AS entry_count
        FROM order_cash_entries e WHERE e.order_plan_id=op.id AND e.status='ACTIVE') allocation ON TRUE
      WHERE op.order_id=? ORDER BY CASE op.plan_type WHEN 'RECEIVABLE' THEN 1 ELSE 2 END,op.sequence`,
          )
          .bind(id)
          .all()
      : Promise.resolve({ results: [] }),
    canReadMaterials
      ? db
          .prepare(
            "SELECT m.*,a.name AS applicant_name FROM order_materials m LEFT JOIN order_applicants a ON a.id=m.applicant_id WHERE m.order_id=? ORDER BY m.applicant_id,m.sequence",
          )
          .bind(id)
          .all()
      : Promise.resolve({ results: [] }),
    canReadMaterials && files
      ? db
          .prepare(
            "SELECT id,order_id,material_id,stored_name,relative_path,mime_type,size_bytes,sha256,uploaded_at,status,superseded_by_id,status_reason,status_changed_at,version FROM material_files WHERE order_id=? ORDER BY material_id,status='ACTIVE' DESC,uploaded_at DESC",
          )
          .bind(id)
          .all()
      : Promise.resolve({ results: [] }),
    workflow
      ? db
          .prepare(
            "SELECT * FROM order_progress WHERE order_id=? ORDER BY pinned DESC,progress_date DESC,created_at DESC,id DESC LIMIT 51 OFFSET ?",
          )
          .bind(id, (historyPage - 1) * 50)
          .all()
      : overview
        ? db.prepare("SELECT * FROM order_progress WHERE order_id=? AND follow_up_date IS NOT NULL AND follow_up_done=0 ORDER BY follow_up_date,created_at DESC,id DESC LIMIT 1").bind(id).all()
        : Promise.resolve({ results: [] }),
    canReadFinance && finance
      ? db
          .prepare(
            `SELECT e.*,e.rate_scaled/100000000.0 AS rate_per_usd,op.name AS plan_name
      FROM order_cash_entries e LEFT JOIN order_plans op ON op.id=e.order_plan_id
      WHERE e.order_id=? ${params.get("cashStatus") === "active" ? "AND e.status='ACTIVE'" : ""} ORDER BY e.entry_date DESC,e.created_at DESC,e.id DESC LIMIT 51 OFFSET ?`,
          )
          .bind(id, (cashPage - 1) * 50)
          .all()
      : Promise.resolve({ results: [] }),
    canReadFinance
      ? db
          .prepare(
            `SELECT
      COALESCE(SUM(CASE WHEN direction='RECEIPT' THEN base_amount_minor ELSE 0 END),0) AS received_base_minor,
      COALESCE(SUM(CASE WHEN direction='PAYMENT' THEN base_amount_minor ELSE 0 END),0) AS paid_base_minor
      FROM order_cash_entries WHERE order_id=? AND status='ACTIVE'`,
          )
          .bind(id)
          .first()
      : Promise.resolve(null),
    hasPermission(user, "tasks.read")
      ? db
          .prepare(
            `SELECT t.*,u.display_name AS owner_name,u.username AS owner_username
      FROM order_tasks t JOIN users u ON u.id=t.owner_user_id WHERE t.order_id=?
      ORDER BY t.status='COMPLETED',t.due_date,CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,t.created_at`,
          )
          .bind(id)
          .all()
      : Promise.resolve({ results: [] }),
    hasPermission(user, "orders.assign") || hasPermission(user, "tasks.write")
      ? db
          .prepare(
            "SELECT id,display_name,username FROM users WHERE active=1 ORDER BY display_name,username",
          )
          .all()
      : Promise.resolve({ results: [] }),
    canWriteFinance && finance
      ? db.prepare("SELECT currency,name,rate_per_usd_scaled,rate_per_usd_scaled/100000000.0 AS rate_per_usd FROM exchange_rates WHERE active=1 ORDER BY CASE WHEN currency='USD' THEN 0 ELSE 1 END,currency").all()
      : Promise.resolve({ results: [] }),
    closure ? getOrderClosureCheck(db, id) : Promise.resolve(null),
    closure && !overview
      ? db
          .prepare(
            `SELECT e.*,u.display_name AS actor_name,u.username AS actor_username
      FROM order_closure_events e JOIN users u ON u.id=e.actor_user_id
      WHERE e.order_id=? ORDER BY e.created_at DESC LIMIT 20`,
          )
          .bind(id)
          .all()
      : Promise.resolve({ results: [] }),
  ]);
  const receivedBaseMinor = Number(totals?.received_base_minor ?? 0);
  const paidBaseMinor = Number(totals?.paid_base_minor ?? 0);
  const visibleClosureCheck = closureCheck
    ? {
        incompleteRequiredSteps: closureCheck.incompleteRequiredSteps,
        ...(!overview || canReadMaterials ? { missingRequiredMaterials: closureCheck.missingRequiredMaterials } : {}),
        ...(!overview || hasPermission(user, "tasks.read") ? { openTasks: closureCheck.openTasks } : {}),
        openFollowUps: closureCheck.openFollowUps,
        ...(canReadFinance
          ? {
              receivableBaseMinor: closureCheck.receivableBaseMinor,
              payableBaseMinor: closureCheck.payableBaseMinor,
              receivedBaseMinor: closureCheck.receivedBaseMinor,
              paidBaseMinor: closureCheck.paidBaseMinor,
            }
          : {}),
      }
    : {};
  return NextResponse.json({
    order,
    applicants: applicants.results,
    mrzRecords: mrzRecords.results,
    steps: steps.results,
    plans: plans.results,
    materials: materials.results,
    materialFiles: materialFiles.results,
    progress: progress.results.slice(0, 50),
    historyPage,
    historyHasMore: progress.results.length > 50,
    cashEntries: cashEntries.results.slice(0, 50),
    cashPage,
    cashHasMore: cashEntries.results.length > 50,
    tasks: tasks.results,
    assignableUsers: assignableUsers.results,
    ...(canWriteFinance && finance ? { availableCurrencies: availableCurrencies.results } : {}),
    closureCheck: visibleClosureCheck,
    closureHistory: closureHistory.results,
    ...(canReadFinance
      ? {
          receivedBaseMinor,
          paidBaseMinor,
          balanceBaseMinor: receivedBaseMinor - paidBaseMinor,
        }
      : {}),
  });
}
