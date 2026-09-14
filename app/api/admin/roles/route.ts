import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { PERMISSION_GROUPS, validPermissions } from "@/lib/permissions";
import { FIELD_LIMITS, validateTextFields } from "@/lib/validation";

export async function GET() {
  const auth = await requireApiUser("roles.read");
  if (auth.response) return auth.response;
  const [roles, permissions] = await Promise.all([
    getDatabase().prepare(`SELECT r.*,COUNT(u.id) AS user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id GROUP BY r.id ORDER BY r.is_system DESC,r.created_at`).all(),
    getDatabase().prepare("SELECT role_id,permission FROM role_permissions ORDER BY permission").all(),
  ]);
  return NextResponse.json({ roles: roles.results.map((role) => ({ ...role, permissions: permissions.results.filter((item) => item.role_id === role.id).map((item) => item.permission) })), groups: PERMISSION_GROUPS });
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "roles.write");
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("提交内容格式不正确。");
  const action = String(body.action || "create");
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const orderScope = body.orderScope === "ALL" ? "ALL" : "OWN";
  const permissions = validPermissions(body.permissions);
  try { validateTextFields(body, [
    { key: "action", label: "操作类型", max: FIELD_LIMITS.code }, { key: "roleId", label: "角色编号", max: FIELD_LIMITS.code },
    { key: "name", label: "角色名称", max: FIELD_LIMITS.name, required: true }, { key: "description", label: "角色说明", max: FIELD_LIMITS.description },
  ]); } catch (error) { return jsonError(error instanceof Error ? error.message : "角色内容不正确。"); }
  if (!name || !permissions.length) return jsonError("请填写角色名称并至少选择一项权限。");
  if (auth.user.roleCode !== "OWNER" && permissions.some((permission) => !auth.user.permissions.includes("*") && !auth.user.permissions.includes(permission))) {
    return jsonError("不能为角色授予当前账号自身没有的权限。", 403);
  }
  if (auth.user.roleCode !== "OWNER" && auth.user.orderScope !== "ALL" && orderScope === "ALL") return jsonError("不能授予高于当前账号的数据范围。", 403);
  const rootDb = getDatabase();
  const now = nowIso();
  try {
    const response = await rootDb.transaction(async (db) => {
    if (action === "create") {
      const id = newId("rol");
      const code = `CUSTOM_${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
      await db.batch([
        db.prepare("INSERT INTO roles (id,code,name,description,is_system,active,order_scope,created_at,updated_at) VALUES (?,?,?,?,0,1,?,?,?)").bind(id, code, name, description || null, orderScope, now, now),
        ...permissions.map((permission) => db.prepare("INSERT INTO role_permissions (role_id,permission) VALUES (?,?)").bind(id, permission)),
      ]);
      await writeAudit(request, auth.user, { action: "ROLE_CREATE", entityType: "ROLE", entityId: id, entityLabel: name, summary: `新建自定义角色 ${name}`, changes: { before: null, after: { name, description, orderScope, permissions } } }, db);
      return NextResponse.json({ id }, { status: 201 });
    }
    const roleId = String(body.roleId || "");
    const role = await db.prepare("SELECT * FROM roles WHERE id=?").bind(roleId).first();
    if (!role) return jsonError("角色不存在。", 404);
    if (Number(role.is_system) === 1) return jsonError("内置角色不能修改或删除。", 403);
    if (action === "update") {
      await db.batch([
        db.prepare("UPDATE roles SET name=?,description=?,order_scope=?,active=1,updated_at=? WHERE id=?").bind(name, description || null, orderScope, now, roleId),
        db.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(roleId),
        ...permissions.map((permission) => db.prepare("INSERT INTO role_permissions (role_id,permission) VALUES (?,?)").bind(roleId, permission)),
        db.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id IN (SELECT id FROM users WHERE role_id=?) AND revoked_at IS NULL").bind(now, roleId),
      ]);
      await writeAudit(request, auth.user, { action: "ROLE_UPDATE", entityType: "ROLE", entityId: roleId, entityLabel: name, summary: `修改自定义角色 ${name}`, changes: { before: role, after: { name, description, orderScope, permissions } } }, db);
      return NextResponse.json({ ok: true });
    }
    if (action === "deactivate") {
      const usage = await db.prepare("SELECT COUNT(*) AS value FROM users WHERE role_id=? AND active=1").bind(roleId).first();
      if (Number(usage?.value || 0) > 0) return jsonError("该角色仍有启用中的用户，不能停用。");
      await db.prepare("UPDATE roles SET active=0,updated_at=? WHERE id=?").bind(now, roleId).run();
      await writeAudit(request, auth.user, { action: "ROLE_DISABLE", entityType: "ROLE", entityId: roleId, entityLabel: String(role.name), summary: `停用自定义角色 ${role.name}`, changes: { before: { active: role.active }, after: { active: 0 } } }, db);
      return NextResponse.json({ ok: true });
    }
    return jsonError("不支持该角色操作。");
    });
    if (!response.ok) await writeAuditBestEffort(request, auth.user, { action: `ROLE_${action.toUpperCase()}`, entityType: "ROLE", entityId: String(body.roleId || "") || null, result: "FAILURE", summary: "尝试角色管理操作", changes: body });
    return response;
  } catch (error) {
    await writeAuditBestEffort(request, auth.user, { action: `ROLE_${action.toUpperCase()}`, entityType: "ROLE", entityId: String(body.roleId || "") || null, result: "FAILURE", summary: "尝试角色管理操作", changes: body });
    if (String(error).toLowerCase().includes("unique")) return jsonError("角色名称已经存在。", 409);
    console.error(error);
    return jsonError("角色保存失败。", 500);
  }
}
