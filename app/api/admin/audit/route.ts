import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db/database";
import { requireApiUser } from "@/lib/api-auth";
import { writeAudit } from "@/lib/audit";
import { hasPermission } from "@/lib/docker-auth";
import { canAccessAllOrders } from "@/lib/order-access";

type FilterValue = string | number;

export async function GET(request: NextRequest) {
  const exportCsv = request.nextUrl.searchParams.get("format") === "csv";
  const auth = await requireApiUser(exportCsv ? "audit.export" : "audit.read");
  if (auth.response) return auth.response;

  const search = request.nextUrl.searchParams;
  const query = search.get("q")?.trim().slice(0, 100) || "";
  const actor = search.get("actor")?.trim().slice(0, 120) || "";
  const entityType = search.get("module")?.trim().slice(0, 60) || "";
  const action = search.get("action")?.trim().slice(0, 100) || "";
  const result = search.get("result") === "SUCCESS" || search.get("result") === "FAILURE" ? search.get("result")! : "";
  const from = search.get("from")?.trim().slice(0, 30) || "";
  const to = search.get("to")?.trim().slice(0, 30) || "";
  const page = Math.max(1, Number.parseInt(search.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(20, Number.parseInt(search.get("pageSize") || "50", 10) || 50));

  const conditions = ["TRUE"];
  const values: FilterValue[] = [];
  const where = (sql: string, value: FilterValue) => { conditions.push(sql); values.push(value); };

  if (!canAccessAllOrders(auth.user)) {
    conditions.push(`(
      actor_user_id=? OR
      (entity_type='ORDER' AND EXISTS (SELECT 1 FROM orders o WHERE o.order_no=audit_logs.entity_id AND o.owner_user_id=?)) OR
      (entity_type='TASK' AND EXISTS (SELECT 1 FROM order_tasks t JOIN orders o ON o.id=t.order_id WHERE t.id=audit_logs.entity_id AND o.owner_user_id=?)) OR
      (entity_type='MATERIAL_FILE' AND EXISTS (SELECT 1 FROM material_files f JOIN orders o ON o.id=f.order_id WHERE f.id=audit_logs.entity_id AND o.owner_user_id=?))
    )`);
    values.push(auth.user.id, auth.user.id, auth.user.id, auth.user.id);
  }

  if (actor) where("actor_username_snapshot=?", actor);
  if (entityType) where("entity_type=?", entityType);
  if (action) where("action=?", action);
  if (result) where("result=?", result);
  if (from) where("occurred_at>=?", from);
  if (to) where("occurred_at<?", to);
  if (query) {
    conditions.push(`lower(COALESCE(actor_username_snapshot,'')||' '||action||' '||entity_type||' '||COALESCE(entity_id,'')||' '||COALESCE(entity_label,'')||' '||summary||' '||COALESCE(changes_json,'')) LIKE ?`);
    values.push(`%${query.toLowerCase()}%`);
  }

  const db = getDatabase();
  const clause = `WHERE ${conditions.join(" AND ")}`;
  if (exportCsv) {
    const exported = await db.prepare(`SELECT occurred_at,actor_username_snapshot,action,entity_type,entity_id,entity_label,result,summary,changes_json,request_id,ip,user_agent
      FROM audit_logs ${clause} ORDER BY occurred_at DESC LIMIT 10000`).bind(...values).all();
    const csvValue = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["时间", "用户", "操作", "模块", "对象标识", "对象名称", "结果", "摘要", "变更内容", "请求标识", "来源地址", "设备信息"];
    const lines = [header.map(csvValue).join(","), ...exported.results.map((row) => [row.occurred_at, row.actor_username_snapshot, row.action, row.entity_type, row.entity_id, row.entity_label, row.result, row.summary, row.changes_json, row.request_id, row.ip, row.user_agent].map(csvValue).join(","))];
    await writeAudit(request, auth.user, { action: "AUDIT_EXPORT", entityType: "AUDIT", summary: `导出操作日志 ${exported.results.length} 条`, changes: { filters: { query, actor, entityType, action, result, from, to }, count: exported.results.length } });
    return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="migra-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Export-Limit": "10000",
    } });
  }
  const [count, rows, actors, actions] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS value FROM audit_logs ${clause}`).bind(...values).first<{ value: number }>(),
    db.prepare(`SELECT * FROM audit_logs ${clause} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, (page - 1) * pageSize).all(),
    db.prepare(`SELECT DISTINCT actor_username_snapshot AS value FROM audit_logs ${clause}
      AND actor_username_snapshot IS NOT NULL AND actor_username_snapshot<>'' ORDER BY actor_username_snapshot`).bind(...values).all(),
    db.prepare(`SELECT action,entity_type,COUNT(*) AS count FROM audit_logs ${clause}
      GROUP BY action,entity_type ORDER BY entity_type,action`).bind(...values).all(),
  ]);

  return NextResponse.json({
    rows: rows.results,
    total: Number(count?.value || 0),
    page,
    pageSize,
    actors: actors.results.map((row) => String((row as { value: unknown }).value)),
    actions: actions.results,
    canExport: hasPermission(auth.user, "audit.export"),
  });
}
