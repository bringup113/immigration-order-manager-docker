import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashValues, defaultCashRate, planMinorFromBase, withCashCalculation } from "../lib/cash-calculation.ts";

test("cash values calculate USD amount from original amount and rate", () => {
  assert.deepEqual(calculateCashValues({ amount: "750", ratePerUsd: "7.5", calculatedField: "baseAmount" }), {
    amountMinor: 75_000,
    baseAmountMinor: 10_000,
    rateScaled: 750_000_000,
  });
});

test("cash values calculate original amount from USD amount and rate", () => {
  assert.deepEqual(calculateCashValues({ baseAmount: "100", ratePerUsd: "7.5", calculatedField: "amount" }), {
    amountMinor: 75_000,
    baseAmountMinor: 10_000,
    rateScaled: 750_000_000,
  });
});

test("cash values calculate rate from both currency amounts", () => {
  assert.deepEqual(calculateCashValues({ amount: "750", baseAmount: "100", calculatedField: "ratePerUsd" }), {
    amountMinor: 75_000,
    baseAmountMinor: 10_000,
    rateScaled: 750_000_000,
  });
});

test("cash values keep valid large original-currency amounts", () => {
  assert.deepEqual(calculateCashValues({ amount: "1000000", ratePerUsd: "4000", calculatedField: "baseAmount" }), {
    amountMinor: 100_000_000,
    baseAmountMinor: 25_000,
    rateScaled: 400_000_000_000,
  });
});

test("cash values reject missing, zero, and unsafe inputs", () => {
  assert.equal(calculateCashValues({ amount: "", ratePerUsd: "7.5", calculatedField: "baseAmount" }), null);
  assert.equal(calculateCashValues({ amount: "750", baseAmount: "0", calculatedField: "ratePerUsd" }), null);
  assert.equal(calculateCashValues({ baseAmount: "1e20", ratePerUsd: "7.5", calculatedField: "amount" }), null);
});

test("desktop and mobile drafts use the same currency snapshot and calculated field", () => {
  const rates = [{ currency: "CNY", rate_per_usd_scaled: 750_000_000, rate_per_usd: 7.5 }];
  assert.equal(defaultCashRate("CNY", rates), "7.5");
  assert.equal(defaultCashRate("USD", rates), "1");
  const draft = { amount: "750", baseAmount: "", ratePerUsd: defaultCashRate("CNY", rates), calculatedField: "baseAmount", description: "首款" };
  assert.deepEqual(withCashCalculation(draft), { ...draft, baseAmount: "100.00" });
  const reverse = withCashCalculation({ ...draft, amount: "", baseAmount: "100", calculatedField: "amount" });
  assert.equal(reverse.amount, "750.00");
  const inferred = withCashCalculation({ ...draft, baseAmount: "100", calculatedField: "ratePerUsd" });
  assert.equal(inferred.ratePerUsd, "7.5");
});

test("cross-currency plan allocation rounds safely and rejects overflow", () => {
  assert.equal(planMinorFromBase(10_000, 750_000_000), 75_000);
  assert.equal(planMinorFromBase(1, 1), null);
  assert.equal(planMinorFromBase(Number.MAX_SAFE_INTEGER, 400_000_000), null);
});
