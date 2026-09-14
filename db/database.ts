import { getPlatformDatabase } from "./platform-postgres";
import type { AppDatabase } from "./driver";

export function getDatabase(): AppDatabase {
  return getPlatformDatabase();
}

export function nowIso() { return new Date().toISOString(); }
export function newId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }
