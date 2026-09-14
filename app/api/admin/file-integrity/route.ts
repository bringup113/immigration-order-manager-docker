import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { writeAuditBestEffort } from "@/lib/audit";
import { checkFileIntegrity } from "@/lib/file-integrity";

export const dynamic = "force-dynamic";
let activeCheck: ReturnType<typeof checkFileIntegrity> | undefined;

export async function GET(request: Request) {
  const auth = await requireApiUser("materials.write");
  if (auth.response) return auth.response;
  try {
    activeCheck ??= checkFileIntegrity().finally(()=>{activeCheck=undefined;});
    const report = await activeCheck;
    await writeAuditBestEffort(request, auth.user, { action: "FILE_INTEGRITY_CHECK", entityType: "SYSTEM", entityId: "material_files", entityLabel: "订单材料文件", summary: "检查订单材料文件一致性", changes: report.summary });
    return NextResponse.json(report);
  } catch (error) {
    console.error(error);
    await writeAuditBestEffort(request, auth.user, { action: "FILE_INTEGRITY_CHECK", entityType: "SYSTEM", entityId: "material_files", result: "FAILURE", summary: "尝试检查订单材料文件一致性" });
    return NextResponse.json({ error: "文件一致性检查失败，请查看容器日志。" }, { status: 500 });
  }
}
