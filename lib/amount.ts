export function toMinor(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  const minor = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(minor) ? minor : 0;
}
export function fromMinor(value: unknown) { return Number(value ?? 0) / 100; }
export function formatMoney(currency: string, minor: unknown) {
  return `${currency} ${fromMinor(minor).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
