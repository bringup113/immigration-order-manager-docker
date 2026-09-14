import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { AppDatabase } from "@/db/driver";
import { hasPermission } from "@/lib/docker-auth";
import { orderScopeFilter } from "@/lib/order-access";

export async function readDashboard(db: AppDatabase, user: ChatGPTUser) {
  const sevenDays = "CURRENT_DATE + 7";
  const orderScope = orderScopeFilter(user, "o");
  const canReadOrders = hasPermission(user, "orders.read");
  const canReadFinance = hasPermission(user, "finance.read");
  const canReadMaterials = hasPermission(user, "materials.read");
  const canReadTasks = hasPermission(user, "tasks.read");
  const [orders, outstanding, balance, reminders, trend, recentOrders] =
    await Promise.all([
      canReadOrders
        ? db
            .prepare(
              `SELECT COUNT(*) AS value FROM orders o WHERE o.status IN ('ACTIVE','PAUSED') AND ${orderScope.sql}`,
            )
            .bind(...orderScope.values)
            .first()
        : Promise.resolve(null),
      canReadFinance
        ? db
            .prepare(
              `WITH plans AS MATERIALIZED (
      SELECT op.id,op.plan_type,op.planned_base_minor FROM order_plans op JOIN orders o ON o.id=op.order_id
      WHERE o.status IN ('DRAFT','ACTIVE','PAUSED') AND ${orderScope.sql}
    ), allocations AS (
      SELECT e.order_plan_id,e.direction,SUM(e.base_amount_minor) AS total FROM order_cash_entries e JOIN plans p ON p.id=e.order_plan_id
      WHERE e.status='ACTIVE' GROUP BY e.order_plan_id,e.direction
    ) SELECT COALESCE(SUM(GREATEST(0,p.planned_base_minor-COALESCE(a.total,0))) FILTER(WHERE p.plan_type='RECEIVABLE'),0) AS receivable,
      COALESCE(SUM(GREATEST(0,p.planned_base_minor-COALESCE(a.total,0))) FILTER(WHERE p.plan_type='PAYABLE'),0) AS payable
      FROM plans p LEFT JOIN allocations a ON a.order_plan_id=p.id AND a.direction=CASE p.plan_type WHEN 'RECEIVABLE' THEN 'RECEIPT' ELSE 'PAYMENT' END`,
            )
            .bind(...orderScope.values)
            .first()
        : Promise.resolve(null),
      canReadFinance
        ? db
            .prepare(
              `SELECT COALESCE(SUM(CASE WHEN e.direction='RECEIPT' THEN e.base_amount_minor ELSE -e.base_amount_minor END),0) AS value FROM order_cash_entries e JOIN orders o ON o.id=e.order_id WHERE e.status='ACTIVE' AND ${orderScope.sql}`,
            )
            .bind(...orderScope.values)
            .first()
        : Promise.resolve(null),
      db
        .prepare(
          `SELECT * FROM (
      SELECT CASE op.plan_type WHEN 'RECEIVABLE' THEN '收款计划' ELSE '付款计划' END AS source,
        CASE op.plan_type WHEN 'RECEIVABLE' THEN 'RECEIPT' ELSE 'PAYMENT' END AS reminder_type,
        op.due_date,o.order_no,op.name AS title,o.project_name_snapshot AS project_name,
        (SELECT a.name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1) AS main_applicant
        FROM order_plans op JOIN orders o ON o.id=op.order_id WHERE ${canReadFinance} AND ${orderScope.sql} AND op.due_date IS NOT NULL AND o.status IN ('ACTIVE','PAUSED') AND op.due_date<=${sevenDays}
      UNION ALL SELECT '办理流程','STEP',s.due_date,o.order_no,s.name,o.project_name_snapshot,
        (SELECT a.name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1)
        FROM order_steps s JOIN orders o ON o.id=s.order_id WHERE ${canReadOrders} AND ${orderScope.sql} AND s.due_date IS NOT NULL AND s.status IN ('PENDING','IN_PROGRESS') AND o.status IN ('ACTIVE','PAUSED') AND s.due_date<=${sevenDays}
      UNION ALL SELECT '待跟进','FOLLOW_UP',g.follow_up_date,o.order_no,COALESCE(NULLIF(g.next_action,''),g.title),o.project_name_snapshot,
        (SELECT a.name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1)
        FROM order_progress g JOIN orders o ON o.id=g.order_id WHERE ${canReadOrders} AND ${orderScope.sql} AND g.follow_up_date IS NOT NULL AND g.follow_up_done=0 AND o.status IN ('ACTIVE','PAUSED') AND g.follow_up_date<=${sevenDays}
      UNION ALL SELECT '材料收集','MATERIAL',m.expected_date,o.order_no,m.name,o.project_name_snapshot,
        (SELECT a.name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1)
        FROM order_materials m JOIN orders o ON o.id=m.order_id WHERE ${canReadMaterials} AND ${orderScope.sql} AND m.expected_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM material_files f WHERE f.material_id=m.id AND f.status='ACTIVE') AND o.status IN ('ACTIVE','PAUSED') AND m.expected_date<=${sevenDays}
      UNION ALL SELECT '订单待办','TASK',t.due_date,o.order_no,t.title,o.project_name_snapshot,
        (SELECT a.name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1)
        FROM order_tasks t JOIN orders o ON o.id=t.order_id WHERE ${canReadTasks} AND ${orderScope.sql} AND t.status='OPEN' AND o.status IN ('ACTIVE','PAUSED') AND t.due_date<=${sevenDays}
    ) scoped_reminders ORDER BY due_date,order_no LIMIT 30`,
        )
        .bind(...Array.from({ length: 5 }, () => orderScope.values).flat())
        .all(),
      canReadFinance
        ? db
            .prepare(
              `SELECT to_char(entry_date,'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN direction='RECEIPT' THEN base_amount_minor ELSE 0 END),0) AS income_minor,
      COALESCE(SUM(CASE WHEN direction='PAYMENT' THEN base_amount_minor ELSE 0 END),0) AS expense_minor
      FROM order_cash_entries e JOIN orders o ON o.id=e.order_id WHERE e.status='ACTIVE' AND ${orderScope.sql} GROUP BY to_char(entry_date,'YYYY-MM') ORDER BY month DESC LIMIT 6`,
            )
            .bind(...orderScope.values)
            .all()
        : Promise.resolve({ results: [] }),
      canReadOrders
        ? db
            .prepare(
              `SELECT o.order_no,c.name AS agent_name,o.project_name_snapshot AS project_name,o.status,o.signed_at,
      (SELECT name FROM order_applicants a WHERE a.order_id=o.id AND a.applicant_type='MAIN' ORDER BY a.sequence LIMIT 1) AS main_applicant,
      (SELECT title FROM order_progress g WHERE g.order_id=o.id ORDER BY g.progress_date DESC,g.created_at DESC LIMIT 1) AS latest_progress
      FROM orders o JOIN agents c ON c.id=o.agent_id WHERE ${orderScope.sql} ORDER BY o.updated_at DESC LIMIT 5`,
            )
            .bind(...orderScope.values)
            .all()
        : Promise.resolve({ results: [] }),
    ]);

  const allowedReminders = reminders.results.filter((row) => {
    const type = String(row.reminder_type);
    if (type === "RECEIPT" || type === "PAYMENT") return canReadFinance;
    if (type === "MATERIAL") return canReadMaterials;
    if (type === "TASK") return canReadTasks;
    return canReadOrders;
  });

  return {
    activeOrders: Number(orders?.value ?? 0),
    receivableMinor: Math.round(Number(outstanding?.receivable ?? 0)),
    payableMinor: Math.round(Number(outstanding?.payable ?? 0)),
    balanceMinor: Math.round(Number(balance?.value ?? 0)),
    reminders: allowedReminders,
    trend: trend.results.reverse(),
    recentOrders: recentOrders.results,
    access: {
      orders: canReadOrders,
      finance: canReadFinance,
      materials: canReadMaterials,
      tasks: canReadTasks,
      ordersWrite: hasPermission(user, "orders.write"),
    },
  };
}
