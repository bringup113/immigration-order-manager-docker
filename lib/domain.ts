import type { AppDatabase } from "@/db/driver";
import { RATE_SCALE } from "@/db/defaults";
import { isCalendarDate } from "@/lib/calendar-date";

export type JsonRecord = Record<string, unknown>;

export const ORDER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "REFUNDED"] as const;
export const STEP_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"] as const;
export const PLAN_TYPES = ["RECEIVABLE", "PAYABLE"] as const;
export const CASH_DIRECTIONS = ["RECEIPT", "PAYMENT"] as const;
export const MATERIAL_SCOPES = ["COMMON", "MAIN", "ALL", "DEPENDENT"] as const;

export function textValue(body: JsonRecord, key: string) {
  return String(body[key] ?? "").trim();
}

export function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 36_500 ? number : null;
}

export function isOneOf<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value as T[number]);
}

export function rateToScaled(value: unknown) {
  const rate = Number(value);
  const scaled = Math.round(rate * RATE_SCALE);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isSafeInteger(scaled)) return null;
  return scaled;
}

export function rateFromScaled(value: unknown) {
  return Number(value ?? RATE_SCALE) / RATE_SCALE;
}

export function toBaseMinor(amountMinor: number, rateScaled: number) {
  return Math.round((amountMinor * RATE_SCALE) / rateScaled);
}

export async function rateForCurrency(db: AppDatabase, currency: string) {
  const row = await db.prepare("SELECT rate_per_usd_scaled FROM exchange_rates WHERE currency=? AND active=1").bind(currency).first();
  return row ? Number(row.rate_per_usd_scaled) : null;
}

export function normalizeCurrency(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function requireActiveCurrency(db: AppDatabase, value: unknown) {
  const currency = normalizeCurrency(value);
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError("请选择有效的三位币种代码。");
  if (!await rateForCurrency(db, currency)) throw new DomainError(`币种 ${currency} 不存在或已停用，请先在系统设置中维护。`);
  return currency;
}

export function addDays(date: string, days: number | null) {
  if (days === null) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function generatedCode(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

export async function nextOrderNumber(db: AppDatabase, projectCode: string, signedAt: string) {
  if (!isCalendarDate(signedAt)) throw new DomainError("签约日期不正确。");
  const prefix = `${projectCode.trim().toUpperCase()}-${signedAt.replaceAll("-", "")}`;
  const existing = await db.prepare("SELECT order_no FROM orders WHERE order_no LIKE ?").bind(`${prefix}%`).all<{ order_no: string }>();
  const maximum = existing.results.reduce((max, row) => {
    if (!row.order_no.startsWith(prefix)) return max;
    const suffix = row.order_no.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return `${prefix}${String(maximum + 1).padStart(2, "0")}`;
}

export async function reserveOrderNumber(db: AppDatabase, projectCode: string, signedAt: string) {
  if (!isCalendarDate(signedAt)) throw new DomainError("签约日期不正确。");
  const prefix = `${projectCode.trim().toUpperCase()}-${signedAt.replaceAll("-", "")}`;
  const row = await db.prepare(`INSERT INTO order_number_counters (prefix,last_sequence,updated_at)
    VALUES (?,COALESCE((SELECT MAX(CASE WHEN substring(order_no FROM ?) ~ '^[0-9]+$' THEN CAST(substring(order_no FROM ?) AS INTEGER) END) FROM orders WHERE order_no LIKE ?),0)+1,?)
    ON CONFLICT(prefix) DO UPDATE SET last_sequence=order_number_counters.last_sequence+1,updated_at=excluded.updated_at
    RETURNING last_sequence`)
    .bind(prefix, prefix.length + 1, prefix.length + 1, `${prefix}%`, new Date().toISOString()).first();
  return `${prefix}${String(Number(row?.last_sequence || 1)).padStart(2, "0")}`;
}

export class DomainError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
