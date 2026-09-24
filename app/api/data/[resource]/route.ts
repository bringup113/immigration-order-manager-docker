import { listOrders } from "@/lib/order-list";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { mutationTransaction } from "@/lib/api-transaction";
import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db/database";
import { DomainError, nextOrderNumber, textValue } from "@/lib/domain";
import {
  authorizeApiUser,
  jsonError,
  requireApiUser,
  requireMutationUser,
} from "@/lib/api-auth";
import { createOrder } from "@/lib/order-service";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { hasPermission } from "@/lib/docker-auth";
import type { AppDatabase } from "@/db/driver";
import { FIELD_LIMITS, validateTextFields } from "@/lib/validation";
import { orderScopeFilter } from "@/lib/order-access";
import { getDataResourcePolicy } from "@/lib/data-resource-policy";
import { readGlobalSearch } from "@/lib/global-search-query";
import { readDashboard, type ReminderRange } from "@/lib/dashboard-query";
import { readOrderCatalogs } from "@/lib/order-catalog-query";
import {
  createProjectResource,
  mutateAgent,
  mutateChannel,
  mutateCurrency,
} from "@/lib/data-resource-mutations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ resource: string }> };
type JsonRecord = Record<string, unknown>;

function responseForError(error: unknown) {
  if (error instanceof DomainError)
    return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("保存失败，请检查填写内容后重试。", 500);
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { resource } = await context.params;
  const policy = getDataResourcePolicy(resource);
  const auth = await requireApiUser(policy?.readPermission);
  if (auth.response) return auth.response;
  const db = getDatabase();
  const orderScope = orderScopeFilter(auth.user, "o");

  if (resource === "order-number") {
    const projectId =
      request.nextUrl.searchParams.get("projectId")?.trim() || "";
    const signedAt = request.nextUrl.searchParams.get("signedAt")?.trim() || "";
    const project = projectId
      ? await db
          .prepare("SELECT code FROM projects WHERE id=? AND status='ACTIVE'")
          .bind(projectId)
          .first()
      : null;
    if (!project) return jsonError("请选择启用中的项目。", 404);
    try {
      return NextResponse.json({
        orderNo: await nextOrderNumber(db, String(project.code), signedAt),
      });
    } catch (error) {
      return responseForError(error);
    }
  }

  if (resource === "search") {
    return NextResponse.json(
      await readGlobalSearch(db, auth.user, request.nextUrl.searchParams),
    );
  }

  if (resource === "agents") {
    const result = await db
      .prepare(
        `SELECT c.*,COUNT(o.id) AS order_count FROM agents c LEFT JOIN orders o ON o.agent_id=c.id AND ${orderScope.sql} GROUP BY c.id ORDER BY c.system_managed DESC,c.created_at DESC`,
      )
      .bind(...orderScope.values)
      .all();
    return NextResponse.json(result.results);
  }
  if (resource === "channels") {
    const result = await db
      .prepare(
        `SELECT c.*,
      (SELECT COUNT(*) FROM project_channels pc WHERE pc.channel_id=c.id) AS project_count,
      (SELECT COUNT(DISTINCT op.order_id) FROM order_plans op JOIN orders o ON o.id=op.order_id WHERE op.channel_id=c.id AND ${orderScope.sql}) AS order_count
      FROM channels c ORDER BY c.created_at DESC`,
      )
      .bind(...orderScope.values)
      .all();
    return NextResponse.json(result.results);
  }
  if (resource === "rates") {
    const result = await db
      .prepare(
        "SELECT *,rate_per_usd_scaled/100000000.0 AS rate_per_usd FROM exchange_rates ORDER BY CASE WHEN currency='USD' THEN 0 ELSE 1 END,currency",
      )
      .all();
    return NextResponse.json(result.results);
  }
  if (resource === "currencies") {
    const result = await db
      .prepare(
        "SELECT currency,name,rate_per_usd_scaled,rate_per_usd_scaled/100000000.0 AS rate_per_usd FROM exchange_rates WHERE active=1 ORDER BY CASE WHEN currency='USD' THEN 0 ELSE 1 END,currency",
      )
      .all();
    return NextResponse.json(result.results);
  }
  if (resource === "projects") {
    const result = await db
      .prepare(
        `SELECT p.*,
      (SELECT c.name FROM project_channels pc JOIN channels c ON c.id=pc.channel_id WHERE pc.project_id=p.id AND pc.is_default=1 LIMIT 1) AS channel_name,
      (SELECT COUNT(*) FROM orders o WHERE o.project_id=p.id AND ${orderScope.sql}) AS order_count,
      (SELECT COUNT(*) FROM project_step_templates s WHERE s.project_id=p.id) AS step_count,
      (SELECT COUNT(*) FROM project_plan_templates t WHERE t.project_id=p.id AND t.plan_type='RECEIVABLE') AS receipt_stages,
      (SELECT COUNT(*) FROM project_plan_templates t WHERE t.project_id=p.id AND t.plan_type='PAYABLE') AS payment_stages
      FROM projects p ORDER BY p.created_at DESC`,
      )
      .bind(...orderScope.values)
      .all();
    return NextResponse.json(result.results);
  }
  if (resource === "orders")
    return NextResponse.json(
      await listOrders(auth.user, request.nextUrl.searchParams),
    );
  if (resource === "catalogs") {
    const result = await readOrderCatalogs(
      db,
      auth.user,
      request.nextUrl.searchParams,
    );
    if (!result.ok) return jsonError(result.error, result.status);
    return NextResponse.json(result.data);
  }
  if (resource === "dashboard") {
    const requestedRange = request.nextUrl.searchParams.get("range");
    const range: ReminderRange | undefined = requestedRange === "all" || requestedRange === "overdue" || requestedRange === "today" || requestedRange === "week" ? requestedRange : undefined;
    const reminderPage = Math.min(100000, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1));
    const reminderPageSize = Math.min(30, Math.max(5, Number.parseInt(request.nextUrl.searchParams.get("pageSize") || "30", 10) || 30));
    const mobileSurface = request.nextUrl.searchParams.get("surface") === "mobile";
    return NextResponse.json(await readDashboard(db, auth.user, range, reminderPage, reminderPageSize, mobileSurface));
  }
  return jsonError("没有找到该数据模块。", 404);
}

async function handlePost(
  context: RouteContext,
  body: JsonRecord,
  user: ChatGPTUser,
  db: AppDatabase = getDatabase(),
) {
  const { resource } = await context.params;
  const policy = getDataResourcePolicy(resource);
  const auth = authorizeApiUser(user, policy?.writePermission);
  if (auth.response) return auth.response;
  try {
    validateTextFields(body, [
      { key: "action", label: "操作类型", max: FIELD_LIMITS.code },
      { key: "id", label: "记录编号", max: FIELD_LIMITS.code },
      { key: "name", label: "名称", max: FIELD_LIMITS.name },
      { key: "code", label: "项目简称", max: FIELD_LIMITS.code },
      { key: "contactName", label: "联系人", max: FIELD_LIMITS.name },
      { key: "phone", label: "联系电话", max: FIELD_LIMITS.phone },
      { key: "email", label: "电子邮箱", max: FIELD_LIMITS.email },
      { key: "country", label: "国家或地区", max: FIELD_LIMITS.country },
      { key: "countryRegion", label: "国家或地区", max: FIELD_LIMITS.country },
      { key: "notes", label: "备注", max: FIELD_LIMITS.notes },
    ]);
    if (resource === "agents") {
      const result = await mutateAgent(db, body);
      return NextResponse.json(result.body, { status: result.status });
    }
    if (resource === "channels") {
      const result = await mutateChannel(db, body);
      return NextResponse.json(result.body, { status: result.status });
    }
    if (resource === "projects") {
      const result = await createProjectResource(db, body);
      return NextResponse.json(result.body, { status: result.status });
    }
    if (resource === "rates") {
      const result = await mutateCurrency(db, body);
      return NextResponse.json(result.body, { status: result.status });
    }
    if (resource === "orders") {
      const requestedOwnerId = textValue(body, "ownerUserId") || auth.user.id;
      if (
        requestedOwnerId !== auth.user.id &&
        !hasPermission(auth.user, "orders.assign")
      )
        throw new DomainError("当前账号不能分配订单负责人。", 403);
      const owner = await db
        .prepare("SELECT id FROM users WHERE id=? AND active=1")
        .bind(requestedOwnerId)
        .first();
      if (!owner) throw new DomainError("订单负责人不存在或已停用。");
      return NextResponse.json(await createOrder(body, requestedOwnerId, db), {
        status: 201,
      });
    }
    return jsonError("该模块暂时不支持新增。", 404);
  } catch (error) {
    return responseForError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const { resource } = await context.params;
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  const action = String(body.action || "CREATE").toUpperCase();
  const actionCode = `${resource.toUpperCase()}_${action}`;
  const policy = getDataResourcePolicy(resource);
  const entityType = policy?.entityType || "DATA";
  const summary = policy?.summary || "修改数据";
  try {
    const response = await mutationTransaction(async (db) => {
      const sourceId = String(body.id || body.currency || "");
      const snapshot = policy?.snapshot;
      const before =
        snapshot && sourceId
          ? await db
              .prepare(
                `SELECT * FROM ${snapshot.table} WHERE ${snapshot.key}=?`,
              )
              .bind(sourceId)
              .first()
          : null;
      const result = await handlePost(context, body, auth.user, db);
      if (!result.ok || !auth.user) return result;
      const responseData = (await result
        .clone()
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const entityId =
        String(responseData.id || responseData.orderNo || sourceId) || null;
      const after =
        snapshot && entityId
          ? await db
              .prepare(
                `SELECT * FROM ${snapshot.table} WHERE ${snapshot.key}=?`,
              )
              .bind(entityId)
              .first()
          : null;
      await writeAudit(
        request,
        auth.user,
        {
          action: actionCode,
          entityType,
          entityId,
          entityLabel:
            String(responseData.orderNo || body.name || body.currency || "") ||
            null,
          summary,
          changes: { before, after, submitted: body },
        },
        db,
      );
      return result;
    });
    if (!response.ok && auth.user)
      await writeAuditBestEffort(request, auth.user, {
        action: actionCode,
        entityType,
        result: "FAILURE",
        summary: `尝试${summary}`,
        changes: { submitted: body },
      });
    return response;
  } catch (error) {
    if (auth.user)
      await writeAuditBestEffort(request, auth.user, {
        action: actionCode,
        entityType,
        result: "FAILURE",
        summary: `尝试${summary}`,
        changes: { submitted: body },
      });
    return responseForError(error);
  }
}
