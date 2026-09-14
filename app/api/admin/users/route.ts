import { NextRequest, NextResponse } from "next/server";
import { getDatabase, newId, nowIso } from "@/db/database";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { hashPassword, normalizeUsername, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validPasswordLength, type AppUser } from "@/lib/docker-auth";
import { FIELD_LIMITS, validateTextFields } from "@/lib/validation";

async function roleCanBeAssignedBy(actor: AppUser, role: Record<string, unknown>) {
  const code = String(role.code);
  if (actor.roleCode === "OWNER") return true;
  if (code === "OWNER" || code === "ADMIN") return false;
  if (actor.orderScope !== "ALL" && String(role.order_scope) === "ALL") return false;
  const permissions = await getDatabase().prepare("SELECT permission FROM role_permissions WHERE role_id=?").bind(role.id).all<{ permission: string }>();
  return permissions.results.every((item) => actor.permissions.includes("*") || actor.permissions.includes(item.permission));
}

export async function GET() {
  const auth = await requireApiUser("users.read");
  if (auth.response) return auth.response;
  const result = await getDatabase().prepare(`SELECT u.id,u.username,u.display_name,u.active,u.must_change_password,u.last_login_at,u.created_at,
    r.id AS role_id,r.code AS role_code,r.name AS role_name
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY r.code='OWNER' DESC,u.created_at`).all();
  return NextResponse.json(result.results);
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "users.write");
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("提交内容格式不正确。");
  const action = String(body.action || "create");
  const rootDb = getDatabase();
  const now = nowIso();
  try {
    const response = await rootDb.transaction(async (db) => {
    validateTextFields(body, [
      { key: "action", label: "操作类型", max: FIELD_LIMITS.code }, { key: "userId", label: "用户编号", max: FIELD_LIMITS.code },
      { key: "username", label: "用户名", max: 40 }, { key: "displayName", label: "显示姓名", max: FIELD_LIMITS.name },
      { key: "roleId", label: "角色编号", max: FIELD_LIMITS.code },
    ]);
    if (action === "create") {
      const username = String(body.username || "").trim();
      const displayName = String(body.displayName || "").trim();
      const password = String(body.password || "");
      const roleId = String(body.roleId || "");
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username) || !displayName || !validPasswordLength(password)) return jsonError(`用户名需为 3–40 位字母、数字或 ._-，密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 位。`);
      const role = await db.prepare("SELECT id,code,name,order_scope FROM roles WHERE id=? AND active=1").bind(roleId).first();
      if (!role || !await roleCanBeAssignedBy(auth.user, role)) return jsonError("不能分配高于当前账号权限的角色。", 403);
      const id = newId("usr");
      await db.prepare(`INSERT INTO users
        (id,username,username_normalized,display_name,password_hash,role_id,active,must_change_password,failed_attempts,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,1,0,?,?)`)
        .bind(id, username, normalizeUsername(username), displayName, await hashPassword(password), roleId, now, now).run();
      await writeAudit(request, auth.user, { action: "USER_CREATE", entityType: "USER", entityId: id, entityLabel: username, summary: `新建用户 ${username}`, changes: { before: null, after: { username, displayName, role: role.name } } }, db);
      return NextResponse.json({ id }, { status: 201 });
    }
    const userId = String(body.userId || "");
    const target = await db.prepare(`SELECT u.*,r.code AS role_code,r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`).bind(userId).first();
    if (!target) return jsonError("用户不存在。", 404);
    if (String(target.role_code) === "OWNER" && auth.user.roleCode !== "OWNER") return jsonError("只有系统所有者可以管理所有者账号。", 403);
    if (auth.user.roleCode !== "OWNER" && String(target.role_code) === "ADMIN") return jsonError("管理员不能管理其他管理员。", 403);
    if (action === "update") {
      const username = String(body.username || "").trim();
      const displayName = String(body.displayName || "").trim();
      const roleId = String(body.roleId || "");
      const role = await db.prepare("SELECT id,code,name,order_scope FROM roles WHERE id=? AND active=1").bind(roleId).first();
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return jsonError("用户名需为 3–40 位字母、数字或 ._-。");
      if (!displayName || !role) return jsonError("姓名或角色不正确。");
      if (!await roleCanBeAssignedBy(auth.user, role)) return jsonError("不能分配高于当前账号权限的角色。", 403);
      if (String(target.role_code) === "OWNER" && String(role.code) !== "OWNER") {
        const owners = await db.prepare("SELECT COUNT(*) AS value FROM users WHERE role_id='role_owner' AND active=1").first();
        if (Number(owners?.value || 0) <= 1) return jsonError("请先指定另一名系统所有者，再调整当前所有者角色。", 409);
      }
      await db.prepare("UPDATE users SET username=?,username_normalized=?,display_name=?,role_id=?,updated_at=? WHERE id=?")
        .bind(username, normalizeUsername(username), displayName, roleId, now, userId).run();
      await writeAudit(request, auth.user, { action: "USER_UPDATE", entityType: "USER", entityId: userId, entityLabel: username, summary: `修改用户 ${target.username}`, changes: { before: { username: target.username, displayName: target.display_name, role: target.role_name }, after: { username, displayName, role: role.name } } }, db);
      return NextResponse.json({ ok: true });
    }
    if (action === "toggle") {
      if (userId === auth.user.id) return jsonError("不能停用当前登录账号。");
      const active = body.active === true ? 1 : 0;
      if (String(target.role_code) === "OWNER" && active === 0) {
        const owners = await db.prepare("SELECT COUNT(*) AS value FROM users WHERE role_id='role_owner' AND active=1").first();
        if (Number(owners?.value || 0) <= 1) return jsonError("系统至少需要保留一个启用中的所有者。");
      }
      await db.batch([
        db.prepare("UPDATE users SET active=?,updated_at=? WHERE id=?").bind(active, now, userId),
        ...(active ? [] : [db.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, userId)]),
      ]);
      await writeAudit(request, auth.user, { action: active ? "USER_ENABLE" : "USER_DISABLE", entityType: "USER", entityId: userId, entityLabel: String(target.username), summary: `${active ? "启用" : "停用"}用户 ${target.username}`, changes: { before: { active: target.active }, after: { active } } }, db);
      return NextResponse.json({ ok: true });
    }
    if (action === "resetPassword") {
      const password = String(body.password || "");
      if (!validPasswordLength(password)) return jsonError(`临时密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
      await db.batch([
        db.prepare("UPDATE users SET password_hash=?,must_change_password=1,password_changed_at=?,updated_at=? WHERE id=?").bind(await hashPassword(password), now, now, userId),
        db.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, userId),
      ]);
      await writeAudit(request, auth.user, { action: "USER_PASSWORD_RESET", entityType: "USER", entityId: userId, entityLabel: String(target.username), summary: `重置用户 ${target.username} 的密码` }, db);
      return NextResponse.json({ ok: true });
    }
    if (action === "revokeSessions") {
      await db.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, userId).run();
      await writeAudit(request, auth.user, { action: "USER_SESSIONS_REVOKE", entityType: "USER", entityId: userId, entityLabel: String(target.username), summary: `注销用户 ${target.username} 的全部会话` }, db);
      return NextResponse.json({ ok: true });
    }
    return jsonError("不支持该用户操作。");
    });
    if (!response.ok) await writeAuditBestEffort(request, auth.user, { action: `USER_${action.toUpperCase()}`, entityType: "USER", entityId: String(body.userId || "") || null, result: "FAILURE", summary: "尝试用户管理操作", changes: body });
    return response;
  } catch (error) {
    await writeAuditBestEffort(request, auth.user, { action: `USER_${action.toUpperCase()}`, entityType: "USER", entityId: String(body.userId || "") || null, result: "FAILURE", summary: "尝试用户管理操作", changes: body });
    if (String(error).toLowerCase().includes("unique")) return jsonError("用户名已经存在。", 409);
    console.error(error);
    return jsonError("用户保存失败。", 500);
  }
}
