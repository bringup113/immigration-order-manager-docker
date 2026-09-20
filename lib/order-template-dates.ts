/** Calendar dates use UTC arithmetic to avoid daylight-saving/timezone shifts. */
export function dateAfter(date: string, days: number | null): string {
  if (!date || days === null) return "";
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function rebaseTemplateDates<T extends {
  dueDate: string;
  dueDays?: number | null;
  dueDateMode?: "template" | "manual";
}>(rows: T[], signedAt: string): T[] {
  return rows.map(row => row.dueDateMode === "template"
    ? {...row, dueDate: dateAfter(signedAt, row.dueDays ?? null)}
    : row);
}
