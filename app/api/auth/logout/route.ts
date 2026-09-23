import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { writeAudit } from "@/lib/audit";
import { dockerSessionCookieName, isDockerDeployment, revokeDockerSession } from "@/lib/docker-auth";
import { isAllowedMutationOrigin } from "@/lib/api-auth";
import { getDatabase } from "@/db/database";
import { safeReturnPath } from "@/lib/safe-return-path";

async function logout(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("return_to"));
  if (!isDockerDeployment()) {
    return NextResponse.redirect(new URL(`/signout-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`, request.url));
  }
  const user = await getChatGPTUser();
  await getDatabase().transaction(async (db) => {
    await revokeDockerSession(request.cookies.get(dockerSessionCookieName())?.value, db);
    if (user) await writeAudit(request, user, { action: "AUTH_LOGOUT", entityType: "AUTH", entityId: user.id, entityLabel: user.username, summary: "退出系统" }, db);
  });
  const response = new NextResponse(null, { status: 303, headers: { Location: `/api/auth/login?return_to=${encodeURIComponent(returnTo)}` } });
  response.cookies.delete(dockerSessionCookieName());
  return response;
}

export async function POST(request: NextRequest) {
  if (!isAllowedMutationOrigin(request)) return NextResponse.json({ error: "已拒绝来自其他网站的退出请求。" }, { status: 403 });
  return logout(request);
}

export async function GET(request: NextRequest) {
  if (!isDockerDeployment()) return logout(request);
  return NextResponse.json({ error: "请使用页面中的退出按钮。" }, { status: 405, headers: { Allow: "POST" } });
}
