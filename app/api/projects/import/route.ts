import { NextRequest, NextResponse } from "next/server";
import { requireMutationUser, jsonError } from "@/lib/api-auth";
import { writeAudit, writeAuditBestEffort } from "@/lib/audit";
import { DomainError } from "@/lib/domain";
import { importProjectPackage, parseProjectPackage, previewProjectPackage, PROJECT_PACKAGE_MAX_BYTES, type ProjectConflictAction } from "@/lib/project-package";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof DomainError) return jsonError(error.message, error.status);
  console.error(error);
  return jsonError("项目包导入失败，请检查文件后重试。", 500);
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationUser(request, "projects.import");
  if (auth.response) return auth.response;
  const contentLength = Number(request.headers.get("content-length") || 0);
  const requestLimit = PROJECT_PACKAGE_MAX_BYTES + 128 * 1024;
  if (contentLength > requestLimit) return jsonError("项目包不能超过 5 MB。", 413);
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > requestLimit) return jsonError("项目包不能超过 5 MB。", 413);
  const body = (() => { try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; } })();
  const mode = String(body?.mode || "preview");
  try {
    if (!body || !["preview", "commit"].includes(mode)) throw new DomainError("导入请求格式不正确。");
    const bundle = parseProjectPackage(body.package);
    if (mode === "preview") return NextResponse.json(await previewProjectPackage(bundle));

    const rawConflicts = body.conflicts && typeof body.conflicts === "object" && !Array.isArray(body.conflicts) ? body.conflicts as Record<string, unknown> : {};
    const rawCopyCodes = body.copyCodes && typeof body.copyCodes === "object" && !Array.isArray(body.copyCodes) ? body.copyCodes as Record<string, unknown> : {};
    const conflicts = Object.fromEntries(Object.entries(rawConflicts).map(([key, value]) => [key, String(value)])) as Record<string, ProjectConflictAction>;
    const copyCodes = Object.fromEntries(Object.entries(rawCopyCodes).map(([key, value]) => [key, String(value)]));
    const result = await importProjectPackage(bundle, conflicts, copyCodes, async ({ preview, imported }, tx) => {
      for (const item of imported) {
        const project = preview.projects.find((row) => row.code === item.sourceCode)!;
        await writeAudit(request, auth.user, { action: "PROJECT_PACKAGE_IMPORT", entityType: "PROJECT", entityId: item.projectId,
          entityLabel: item.targetCode, summary: `${item.action === "CREATE" ? "导入新项目" : item.action === "COPY" ? "导入为项目副本" : "覆盖项目模板"} ${item.targetCode}`,
          changes: { sourceCode: item.sourceCode, targetCode: item.targetCode, strategy: item.action, counts: project.counts,
            createdChannels: preview.dependencies.missingChannels, createdCurrencies: preview.dependencies.missingCurrencies,
            packageVersion: bundle.formatVersion, exportedAt: bundle.exportedAt } }, tx);
      }
    });
    return NextResponse.json({ ok: true, imported: result.imported });
  } catch (error) {
    await writeAuditBestEffort(request, auth.user, { action: "PROJECT_PACKAGE_IMPORT", entityType: "PROJECT", result: "FAILURE",
      summary: mode === "preview" ? "项目包预检失败" : "项目包导入失败",
      changes: { mode, format: body?.package && typeof body.package === "object" ? String((body.package as Record<string, unknown>).format || "") : "" } });
    return errorResponse(error);
  }
}
