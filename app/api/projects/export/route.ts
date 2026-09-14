import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, jsonError } from "@/lib/api-auth";
import { writeAudit } from "@/lib/audit";
import { DomainError } from "@/lib/domain";
import { exportProjectPackage } from "@/lib/project-package";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireApiUser("projects.export");
  if (auth.response) return auth.response;
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim() || undefined;
  if (projectId && projectId.length > 80) return jsonError("项目编号格式不正确。");
  try {
    const bundle = await exportProjectPackage(projectId);
    const counts = {
      projects: bundle.projects.length,
      steps: bundle.projects.reduce((sum, item) => sum + item.steps.length, 0),
      plans: bundle.projects.reduce((sum, item) => sum + item.plans.length, 0),
      materials: bundle.projects.reduce((sum, item) => sum + item.materials.length, 0),
      channels: bundle.channels.length,
      currencies: bundle.currencies.length,
    };
    await writeAudit(request, auth.user, { action: "PROJECT_PACKAGE_EXPORT", entityType: "PROJECT", entityId: projectId || null,
      entityLabel: projectId ? bundle.projects[0].name : "全部项目", summary: `导出项目包 ${bundle.projects.length} 个项目`, changes: counts });
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const suffix = projectId ? `-${bundle.projects[0].code}` : "-ALL";
    return new NextResponse(JSON.stringify(bundle, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="MIGRA-projects${suffix}-${date}.json"`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    if (error instanceof DomainError) return jsonError(error.message, error.status);
    console.error(error);
    return jsonError("项目包导出失败。", 500);
  }
}
