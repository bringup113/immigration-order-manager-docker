import { NextRequest, NextResponse } from "next/server";
import { getDatabase, nowIso } from "@/db/database";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { jsonError, requireMutationUser } from "@/lib/api-auth";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validPasswordLength, verifyPassword } from "@/lib/docker-auth";

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body.newPassword || !validPasswordLength(body.newPassword)) {
    return jsonError(`请填写当前密码，新密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
  }
  const currentPassword = body.currentPassword;
  const newPassword = body.newPassword;
  const db = getDatabase();
  const row = await db.prepare("SELECT password_hash FROM users WHERE id=?").bind(auth.user.id).first();
  if (!row || !await verifyPassword(currentPassword, String(row.password_hash))) return jsonError("当前密码不正确。", 403);
  const now = nowIso();
  try {
    await db.transaction(async (tx) => {
      await tx.batch([
        tx.prepare("UPDATE users SET password_hash=?,must_change_password=0,password_changed_at=?,updated_at=? WHERE id=?").bind(await hashPassword(newPassword), now, now, auth.user.id),
        tx.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, auth.user.id),
      ]);
      await writeAudit(request, auth.user, { action: "AUTH_PASSWORD_CHANGE", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, summary: "修改了自己的登录密码" }, tx);
    });
  } catch (error) {
    console.error(error);
    await writeAuditBestEffort(request, auth.user, { action: "AUTH_PASSWORD_CHANGE", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, result: "FAILURE", summary: "尝试修改自己的登录密码" });
    return jsonError("密码修改失败，请稍后重试。", 500);
  }
  const response = NextResponse.json({ ok: true, relogin: true });
  response.cookies.delete("migra_session");
  return response;
}
