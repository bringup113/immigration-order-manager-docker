import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";

const materialFileSummary: Record<string, string> = {
  MATERIAL_FILE_UPLOAD: "上传材料文件",
  MATERIAL_FILE_REPLACE: "替换材料文件",
  MATERIAL_FILE_VOID: "作废材料文件",
  MATERIAL_FILE_RESTORE: "恢复材料文件",
  MATERIAL_FILE_PREVIEW: "预览材料文件",
  MATERIAL_FILE_DOWNLOAD: "下载材料文件",
  MATERIAL_FILE_DELETE: "删除材料文件",
};

function sanitize(value: unknown, hideFileFields = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, hideFileFields));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const normalized = key.toLowerCase().replaceAll("_", "");
    if (normalized.includes("password") || normalized.includes("token") || normalized.includes("secret"))
      return [key, "[已隐藏]"];
    if (hideFileFields && ["originalname", "storedname", "relativepath", "sha256"].includes(normalized))
      return [key, "[已隐藏]"];
    if (normalized.includes("passport")) {
      const text = String(item || "");
      return [key, text.length > 4 ? `${text.slice(0, 2)}****${text.slice(-2)}` : "[已脱敏]"];
    }
    return [key, sanitize(item, hideFileFields)];
  }));
}

export async function writeAudit(request: Request, user: ChatGPTUser, input: {
  action: string; entityType: string; entityId?: string | null; entityLabel?: string | null;
  result?: "SUCCESS" | "FAILURE"; summary: string; changes?: unknown;
}, db: AppDatabase = getDatabase()) {
  const materialFile = input.entityType === "MATERIAL_FILE";
  const entityLabel = materialFile ? "[文件名称已隐藏]" : input.entityLabel || null;
  const summary = materialFile
    ? materialFileSummary[input.action] || "材料文件操作"
    : input.summary;
  await db.prepare(`INSERT INTO audit_logs
    (id,occurred_at,actor_user_id,actor_username_snapshot,action,entity_type,entity_id,entity_label,result,summary,changes_json,request_id,ip,user_agent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(newId("aud"), nowIso(), user.id, user.username, input.action, input.entityType,
      input.entityId || null, entityLabel, input.result || "SUCCESS", summary,
      input.changes === undefined ? null : JSON.stringify(sanitize(input.changes, materialFile)), newId("req"),
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      request.headers.get("user-agent") || null).run();
}

export async function writeAuditBestEffort(request: Request, user: ChatGPTUser, input: Parameters<typeof writeAudit>[2]) {
  try {
    await writeAudit(request, user, input);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "audit_write_failed",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId || null,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
