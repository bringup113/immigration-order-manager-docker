import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/db/database";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { jsonError, requireApiUser, requireMutationUser } from "@/lib/api-auth";
import { dockerSessionCookieName, listDockerSessions, revokeDockerSessionById, revokeOtherDockerSessions } from "@/lib/docker-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser();
  if (auth.response) return auth.response;
  const sessions = await listDockerSessions(auth.user.id, request.cookies.get(dockerSessionCookieName())?.value);
  return NextResponse.json({ sessions });
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { action?: string; sessionId?: string } | null;
  const action = body?.action || "";
  const sessionId = body?.sessionId || "";
  if (!["revokeOthers", "revokeOne"].includes(action)) return jsonError("不支持该会话操作。");
  if (action === "revokeOne" && !/^[A-Za-z0-9_-]{1,120}$/.test(sessionId)) return jsonError("会话编号不正确。");
  const token = request.cookies.get(dockerSessionCookieName())?.value;
  try {
    const count = await getDatabase().transaction(async (db) => {
      const result = action === "revokeOthers"
        ? await revokeOtherDockerSessions(auth.user.id, token, db)
        : await revokeDockerSessionById(auth.user.id, sessionId, token, db);
      const changed = Number(result.meta?.changes || 0);
      await writeAudit(request, auth.user, {
        action: action === "revokeOthers" ? "AUTH_SESSION_REVOKE_OTHERS" : "AUTH_SESSION_REVOKE",
        entityType: "AUTH",
        entityId: action === "revokeOne" ? sessionId : auth.user.id,
        entityLabel: auth.user.username,
        summary: action === "revokeOthers" ? `退出其他设备，共注销 ${changed} 个会话` : "注销一个登录设备",
        changes: { revokedSessions: changed },
      }, db);
      return changed;
    });
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    console.error(error);
    await writeAuditBestEffort(request, auth.user, {
      action: action === "revokeOthers" ? "AUTH_SESSION_REVOKE_OTHERS" : "AUTH_SESSION_REVOKE",
      entityType: "AUTH",
      entityId: sessionId || auth.user.id,
      result: "FAILURE",
      summary: "尝试注销登录设备",
    });
    return jsonError("注销设备失败，请稍后重试。", 500);
  }
}
