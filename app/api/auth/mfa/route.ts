import { NextRequest, NextResponse } from "next/server";
import { getDatabase, nowIso } from "@/db/database";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { decryptMfaSecret, encryptMfaSecret, generateMfaSecret, generateRecoveryCodes, privilegedMfaPolicyEnabled, recoveryCodeHashes, verifyPassword, verifyTotp, verifyUserMfa } from "@/lib/docker-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const row = await getDatabase().prepare("SELECT mfa_secret_ciphertext,mfa_enabled_at FROM users WHERE id=?").bind(auth.user.id).first();
  return NextResponse.json({ enabled: Boolean(row?.mfa_secret_ciphertext), enabledAt: row?.mfa_enabled_at || null, required: auth.user.mfaRequired });
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  if (auth.user.mustChangePassword) return jsonError("请先修改初始密码，再设置双重验证。", 409);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return jsonError("提交内容格式不正确。");
  const action = String(body.action || "");
  const db = getDatabase();
  try {
  const row = await db.prepare("SELECT password_hash,mfa_secret_ciphertext,mfa_pending_secret_ciphertext,mfa_recovery_hashes FROM users WHERE id=?").bind(auth.user.id).first();
  if (!row) return jsonError("用户不存在。", 404);
  const now = nowIso();

  if (action === "begin") {
    const secret = generateMfaSecret();
    await db.transaction(async (tx) => {
      await tx.prepare("UPDATE users SET mfa_pending_secret_ciphertext=?,updated_at=? WHERE id=?").bind(await encryptMfaSecret(secret), now, auth.user.id).run();
      await writeAudit(request, auth.user, { action: "AUTH_MFA_SETUP_BEGIN", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, summary: "开始设置双重验证" }, tx);
    });
    const label = encodeURIComponent(`MIGRA:${auth.user.username}`);
    return NextResponse.json({ secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=MIGRA&algorithm=SHA1&digits=6&period=30` });
  }

  if (action === "enable") {
    if (!row.mfa_pending_secret_ciphertext) return jsonError("请先生成双重验证密钥。", 409);
    const secret = await decryptMfaSecret(String(row.mfa_pending_secret_ciphertext));
    if (!await verifyTotp(secret, String(body.code || ""))) return jsonError("验证码不正确，请确认手机时间准确后重试。", 403);
    const recoveryCodes = generateRecoveryCodes();
    await db.transaction(async (tx) => {
      await tx.prepare("UPDATE users SET mfa_secret_ciphertext=mfa_pending_secret_ciphertext,mfa_pending_secret_ciphertext=NULL,mfa_recovery_hashes=?,mfa_enabled_at=?,updated_at=? WHERE id=?")
        .bind(JSON.stringify(await recoveryCodeHashes(recoveryCodes)), now, now, auth.user.id).run();
      await writeAudit(request, auth.user, { action: "AUTH_MFA_ENABLE", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, summary: "启用双重验证" }, tx);
    });
    return NextResponse.json({ ok: true, recoveryCodes });
  }

  if (action === "disable" || action === "recoveryCodes") {
    if (action === "disable" && privilegedMfaPolicyEnabled() && (auth.user.roleCode === "OWNER" || auth.user.roleCode === "ADMIN")) {
      return jsonError("公网运行时，系统所有者和管理员不能关闭双重验证。", 409);
    }
    const password = String(body.password || "");
    const code = String(body.code || "");
    if (!password || !code || !await verifyPassword(password, String(row.password_hash))) return jsonError("当前密码或双重验证码不正确。", 403);
    if (!row.mfa_secret_ciphertext || !await verifyUserMfa(auth.user.id, String(row.mfa_secret_ciphertext), row.mfa_recovery_hashes ? String(row.mfa_recovery_hashes) : null, code)) return jsonError("当前密码或双重验证码不正确。", 403);
    if (action === "disable") {
      await db.transaction(async (tx) => {
        await tx.prepare("UPDATE users SET mfa_secret_ciphertext=NULL,mfa_pending_secret_ciphertext=NULL,mfa_recovery_hashes=NULL,mfa_enabled_at=NULL,updated_at=? WHERE id=?").bind(now, auth.user.id).run();
        await writeAudit(request, auth.user, { action: "AUTH_MFA_DISABLE", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, summary: "关闭双重验证" }, tx);
      });
      return NextResponse.json({ ok: true });
    }
    const recoveryCodes = generateRecoveryCodes();
    await db.transaction(async (tx) => {
      await tx.prepare("UPDATE users SET mfa_recovery_hashes=?,updated_at=? WHERE id=?").bind(JSON.stringify(await recoveryCodeHashes(recoveryCodes)), now, auth.user.id).run();
      await writeAudit(request, auth.user, { action: "AUTH_MFA_RECOVERY_REGENERATE", entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, summary: "重新生成双重验证恢复码" }, tx);
    });
    return NextResponse.json({ ok: true, recoveryCodes });
  }

  return jsonError("不支持该双重验证操作。");
  } catch (error) {
    console.error(error);
    await writeAuditBestEffort(request, auth.user, { action: `AUTH_MFA_${action.toUpperCase() || "UPDATE"}`, entityType: "USER", entityId: auth.user.id, entityLabel: auth.user.username, result: "FAILURE", summary: "尝试修改双重验证设置" });
    return jsonError("双重验证设置失败，请稍后重试。", 500);
  }
}
