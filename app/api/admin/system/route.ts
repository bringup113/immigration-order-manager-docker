import { NextResponse } from "next/server";
import { authorizeApiUser } from "@/lib/api-auth";
import { systemHealth } from "@/lib/system-health";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = authorizeApiUser(await getChatGPTUser(false), "audit.read");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await systemHealth(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "运行状态读取失败，请查看容器日志。" },
      { status: 503 },
    );
  }
}
