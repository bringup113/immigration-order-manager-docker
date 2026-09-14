import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";

export async function writeAudit(request: Request, user: ChatGPTUser, input: {
  action: string; entityType: string; entityId?: string | null; entityLabel?: string | null;
  result?: "SUCCESS" | "FAILURE"; summary: string; changes?: unknown;
}, db: AppDatabase = getDatabase()) {
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const normalized = key.toLowerCase();
      if (normalized.includes("password") || normalized.includes("token") || normalized.includes("secret")) return [key, "[已隐藏]"];
      if (normalized.includes("passport")) {
        const text = String(item || "");
        return [key, text.length > 4 ? `${text.slice(0, 2)}****${text.slice(-2)}` : "[已脱敏]"];
      }
      return [key, sanitize(item)];
    }));
  };
  await db.prepare(`INSERT INTO audit_logs
    (id,occurred_at,actor_user_id,actor_username_snapshot,action,entity_type,entity_id,entity_label,result,summary,changes_json,request_id,ip,user_agent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(newId("aud"), nowIso(), user.id, user.username, input.action, input.entityType,
      input.entityId || null, input.entityLabel || null, input.result || "SUCCESS", input.summary,
      input.changes === undefined ? null : JSON.stringify(sanitize(input.changes)), newId("req"),
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
