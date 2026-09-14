import { z } from "zod";
import { isCalendarDate } from "@/lib/calendar-date";
import { DomainError, type JsonRecord } from "@/lib/domain";

export const FIELD_LIMITS = {
  code: 64,
  shortName: 120,
  name: 200,
  email: 254,
  phone: 40,
  country: 120,
  passport: 64,
  description: 1_000,
  notes: 4_000,
  progressDetails: 8_000,
} as const;

export type TextFieldRule = {
  key: string;
  label: string;
  max: number;
  required?: boolean;
};

const calendarDateSchema = z.string().refine(isCalendarDate);

export function dateField(body: JsonRecord, key: string, label: string, required = false) {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new DomainError(`请填写${label}。`);
    return null;
  }
  if (typeof value !== "string") throw new DomainError(`${label}格式不正确。`);
  const normalized = value.trim();
  if (!calendarDateSchema.safeParse(normalized).success) throw new DomainError(`${label}格式不正确。`);
  return normalized;
}

export function validateTextFields(body: JsonRecord, rules: readonly TextFieldRule[]) {
  for (const rule of rules) {
    const raw = body[rule.key];
    if (raw === undefined || raw === null || raw === "") {
      if (rule.required) throw new DomainError(`请填写${rule.label}。`);
      continue;
    }
    if (typeof raw !== "string") throw new DomainError(`${rule.label}格式不正确。`);
    const result = z.string().trim().max(rule.max).safeParse(raw);
    if (!result.success) throw new DomainError(`${rule.label}不能超过 ${rule.max} 个字符。`);
    if (rule.required && !result.data) throw new DomainError(`请填写${rule.label}。`);
  }
}

export function recordArray(value: unknown, label: string, maxItems: number) {
  const result = z.array(z.record(z.unknown())).max(maxItems).safeParse(value ?? []);
  if (!result.success) throw new DomainError(`${label}格式不正确，最多允许 ${maxItems} 项。`);
  return result.data as JsonRecord[];
}

export function boundedInteger(value: unknown, label: string, options: { min?: number; max: number }) {
  const result = z.coerce.number().int().min(options.min ?? 0).max(options.max).safeParse(value);
  if (!result.success) throw new DomainError(`${label}必须是 ${options.min ?? 0} 至 ${options.max} 之间的整数。`);
  return result.data;
}
