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

type CashCalculationDraft = {
  amount: string;
  baseAmount: string;
  ratePerUsd: string;
  calculatedField: CashCalculatedField;
};

type CashAutoDraft = CashCalculationDraft & {
  currency: string;
  inputOrder?: CashCalculatedField[];
};

const cashFields: CashCalculatedField[] = ["amount", "baseAmount", "ratePerUsd"];

type CurrencyRate = {
  currency: string;
  rate_per_usd?: number;
  rate_per_usd_scaled?: number;
};

export function defaultCashRate(currency: string, currencies: CurrencyRate[]) {
  if (currency === "USD") return "1";
  const option = currencies.find((item) => item.currency === currency);
  if (option?.rate_per_usd_scaled) return rateInput(Number(option.rate_per_usd_scaled));
  return option?.rate_per_usd ? String(option.rate_per_usd) : "";
}

export function withCashCalculation<T extends CashCalculationDraft>(next: T): T {
  const calculated = calculateCashValues(next);
  if (!calculated) return { ...next, [next.calculatedField]: "" };
  if (next.calculatedField === "amount") return { ...next, amount: minorInput(calculated.amountMinor) };
  if (next.calculatedField === "baseAmount") return { ...next, baseAmount: minorInput(calculated.baseAmountMinor) };
  return { ...next, ratePerUsd: rateInput(calculated.rateScaled) };
}

export function withCashAutoInput<T extends CashAutoDraft>(current: T, field: CashCalculatedField, value: string): T {
  if (current.currency === "USD") {
    if (field === "ratePerUsd") return current;
    return {
      ...current,
      amount: value,
      baseAmount: value,
      ratePerUsd: "1",
      calculatedField: field === "amount" ? "baseAmount" : "amount",
      inputOrder: [field],
    };
  }

  const previous = current.inputOrder ?? cashFields.filter((candidate) => candidate !== current.calculatedField);
  const inputOrder = [...previous.filter((candidate) => candidate !== field), field].slice(-2);
  const calculatedField = cashFields.find((candidate) => !inputOrder.includes(candidate)) ?? current.calculatedField;
  return withCashCalculation({ ...current, [field]: value, inputOrder, calculatedField });
}

export function withCashCurrency<T extends CashAutoDraft>(current: T, currency: string, ratePerUsd: string): T {
  if (current.currency === currency) return current;
  return {
    ...current,
    currency,
    amount: "",
    baseAmount: "",
    ratePerUsd: currency === "USD" ? "1" : ratePerUsd,
    calculatedField: "baseAmount",
    inputOrder: currency === "USD" || !ratePerUsd ? [] : ["ratePerUsd"],
  };
}

export function planMinorFromBase(baseAmountMinor: number, budgetRateScaled: number) {
  if (!Number.isSafeInteger(baseAmountMinor) || !Number.isSafeInteger(budgetRateScaled) || baseAmountMinor <= 0 || budgetRateScaled <= 0) return null;
  const rounded = (BigInt(baseAmountMinor) * BigInt(budgetRateScaled) + BigInt(CASH_RATE_SCALE / 2)) / BigInt(CASH_RATE_SCALE);
  const value = Number(rounded);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
