import assert from "node:assert/strict";
import test from "node:test";
import { calculateCashValues } from "../lib/cash-calculation.ts";

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

test("cash values reject missing, zero, and unsafe inputs", () => {
  assert.equal(calculateCashValues({ amount: "", ratePerUsd: "7.5", calculatedField: "baseAmount" }), null);
  assert.equal(calculateCashValues({ amount: "750", baseAmount: "0", calculatedField: "ratePerUsd" }), null);
  assert.equal(calculateCashValues({ baseAmount: "1e20", ratePerUsd: "7.5", calculatedField: "amount" }), null);
});
