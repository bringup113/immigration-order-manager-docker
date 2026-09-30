export type MrzDateKind = "birth" | "expiry";

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

export function mrzDateToIso(
  value: unknown,
  kind: MrzDateKind,
  today = new Date(),
) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (!/^\d{6}$/.test(text)) return "";

  const shortYear = Number(text.slice(0, 2));
  const month = Number(text.slice(2, 4));
  const day = Number(text.slice(4, 6));
  const currentYear = today.getUTCFullYear();
  const year =
    kind === "birth"
      ? 2000 + shortYear <= currentYear
        ? 2000 + shortYear
        : 1900 + shortYear
      : 2000 + shortYear <= currentYear + 20
        ? 2000 + shortYear
        : 1900 + shortYear;

  if (!validDate(year, month, day)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
