import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashValues, defaultCashRate, planMinorFromBase, withCashAutoInput, withCashCalculation, withCashCurrency } from "../lib/cash-calculation.ts";

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

test("editing any two cash fields automatically recalculates the third", () => {
  const initial = { currency: "CNY", amount: "", baseAmount: "", ratePerUsd: "7.5", calculatedField: "baseAmount", inputOrder: ["ratePerUsd"] };
  const amountEntered = withCashAutoInput(initial, "amount", "750");
  assert.equal(amountEntered.baseAmount, "100.00");
  assert.equal(amountEntered.calculatedField, "baseAmount");

  const baseEdited = withCashAutoInput(amountEntered, "baseAmount", "125");
  assert.equal(baseEdited.ratePerUsd, "6");
  assert.equal(baseEdited.calculatedField, "ratePerUsd");

  const rateEdited = withCashAutoInput(baseEdited, "ratePerUsd", "7.5");
  assert.equal(rateEdited.amount, "937.50");
  assert.equal(rateEdited.calculatedField, "amount");

  const cleared = withCashAutoInput(rateEdited, "baseAmount", "");
  assert.equal(cleared.amount, "");
  assert.equal(calculateCashValues(cleared), null);
});

test("currency changes clear old amounts and USD mirrors either editable amount", () => {
  const initial = { currency: "CNY", amount: "750", baseAmount: "100", ratePerUsd: "7.5", calculatedField: "baseAmount", inputOrder: ["ratePerUsd", "amount"] };
  const switched = withCashCurrency(initial, "MYR", "4.04");
  assert.equal(switched.amount, "");
  assert.equal(switched.baseAmount, "");
  assert.equal(switched.ratePerUsd, "4.04");
  assert.equal(withCashAutoInput(switched, "baseAmount", "100").amount, "404.00");

  const usd = withCashCurrency(switched, "USD", "1");
  const fromOriginal = withCashAutoInput(usd, "amount", "50.25");
  assert.equal(fromOriginal.baseAmount, "50.25");
  const fromBase = withCashAutoInput(fromOriginal, "baseAmount", "75.50");
  assert.equal(fromBase.amount, "75.50");
  assert.equal(fromBase.ratePerUsd, "1");
  assert.equal(calculateCashValues(fromBase)?.baseAmountMinor, 7_550);
});

test("cross-currency plan allocation rounds safely and rejects overflow", () => {
  assert.equal(planMinorFromBase(10_000, 750_000_000), 75_000);
  assert.equal(planMinorFromBase(1, 1), null);
  assert.equal(planMinorFromBase(Number.MAX_SAFE_INTEGER, 400_000_000), null);
});
