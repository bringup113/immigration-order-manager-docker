import { createHash } from "node:crypto";

export function queryIdentifier(sql: string) {
  const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}
