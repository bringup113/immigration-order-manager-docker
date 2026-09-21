export const CASH_RATE_SCALE = 100_000_000;

export type CashCalculatedField = "amount" | "ratePerUsd" | "baseAmount";

type CashInputs = {
  amount?: unknown;
  ratePerUsd?: unknown;
  baseAmount?: unknown;
  calculatedField: CashCalculatedField;
};

function positiveMinor(value: unknown) {
  const number = Number(value);
  const minor = Math.round(number * 100);
  return Number.isFinite(number) && number > 0 && Number.isSafeInteger(minor) ? minor : null;
}

function positiveRate(value: unknown) {
  const number = Number(value);
  const scaled = Math.round(number * CASH_RATE_SCALE);
  return Number.isFinite(number) && number > 0 && Number.isSafeInteger(scaled) ? scaled : null;
}

function roundedRatio(numerator: bigint, denominator: bigint) {
  if (numerator <= BigInt(0) || denominator <= BigInt(0)) return null;
  const value = (numerator + denominator / BigInt(2)) / denominator;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function calculateCashValues(inputs: CashInputs) {
  let amountMinor = positiveMinor(inputs.amount);
  let baseAmountMinor = positiveMinor(inputs.baseAmount);
  let rateScaled = positiveRate(inputs.ratePerUsd);

  if (inputs.calculatedField === "baseAmount") {
    if (!amountMinor || !rateScaled) return null;
    baseAmountMinor = roundedRatio(
      BigInt(amountMinor) * BigInt(CASH_RATE_SCALE),
      BigInt(rateScaled),
    );
  } else if (inputs.calculatedField === "amount") {
    if (!baseAmountMinor || !rateScaled) return null;
    amountMinor = roundedRatio(
      BigInt(baseAmountMinor) * BigInt(rateScaled),
      BigInt(CASH_RATE_SCALE),
    );
  } else {
    if (!amountMinor || !baseAmountMinor) return null;
    rateScaled = roundedRatio(
      BigInt(amountMinor) * BigInt(CASH_RATE_SCALE),
      BigInt(baseAmountMinor),
    );
  }

  if (!amountMinor || !baseAmountMinor || !rateScaled) return null;
  return { amountMinor, baseAmountMinor, rateScaled };
}

export function minorInput(value: number) {
  return (value / 100).toFixed(2);
}

export function rateInput(value: number) {
  return (value / CASH_RATE_SCALE).toFixed(8).replace(/\.?0+$/, "");
}
