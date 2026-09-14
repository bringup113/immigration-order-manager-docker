import { NextResponse } from "next/server";
import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import { hasPermission, writeSecurityAudit } from "@/lib/docker-auth";

export async function requireApiUser(permission?: string) {
  return authorizeApiUser(await getChatGPTUser(), permission);
}

export function authorizeApiUser(user: ChatGPTUser | null, permission?: string) {
  if (!user) return { user: null, response: NextResponse.json({ error: "请先登录后再操作。" }, { status: 401 }) };
  if (permission && user.mustChangePassword) {
    return { user: null, response: NextResponse.json({ error: "首次登录必须先修改密码。", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 }) };
  }
  if (permission && user.mfaRequired) {
    return { user: null, response: NextResponse.json({ error: "公网运行要求所有者和管理员先启用双重验证。", code: "MFA_SETUP_REQUIRED" }, { status: 403 }) };
  }
  if (permission && !hasPermission(user, permission)) return { user: null, response: NextResponse.json({ error: "当前账号没有执行该操作的权限。" }, { status: 403 }) };
  return { user, response: null };
}

export function isAllowedMutationOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const configuredOrigin = process.env.APP_ORIGIN?.trim();
    if (configuredOrigin) return new URL(origin).origin === new URL(configuredOrigin).origin;
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
    return Boolean(host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

export async function requireMutationUser(request: Request, permission?: string) {
  if (!isAllowedMutationOrigin(request)) {
    const currentUser = await getChatGPTUser().catch(() => null);
    await writeSecurityAudit({ actorUserId: currentUser?.id || null, actorUsername: currentUser?.username || null, action: "SECURITY_ORIGIN_REJECT", result: "FAILURE", summary: "拒绝跨站写入请求", ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined, userAgent: request.headers.get("user-agent") || undefined }).catch(() => undefined);
    return { user: null, response: NextResponse.json({ error: "已拒绝来自其他网站的写入请求。" }, { status: 403 }) };
  }
  return requireApiUser(permission);
}
export function jsonError(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
