import test from "node:test";
import assert from "node:assert/strict";
import { selectCashPlan } from "../lib/cash-plan-description.ts";

test("selecting and switching plans fills only empty or automatic descriptions", () => {
  const initial = { orderPlanId: "", description: "", amount: "123" };
  const first = selectCashPlan(initial, "a", "首款");
  assert.equal(first.description, "首款");
  const second = selectCashPlan(first, "b", "尾款");
  assert.equal(second.description, "尾款");
  assert.equal(second.amount, "123");
  assert.equal(initial.description, "");
  const unlinked = selectCashPlan(second, "", "");
  assert.equal(unlinked.description, "尾款");
  assert.equal(unlinked.orderPlanId, "");
  assert.equal(unlinked.autoDescription, null);
  assert.equal(selectCashPlan(unlinked, "a", "首款").description, "尾款");
});

test("manual and saved descriptions are preserved, even when equal to a plan name", () => {
  for (const draft of [
    { orderPlanId: "a", description: "首款" },
    { orderPlanId: "a", description: "首款", autoDescription: null },
    { orderPlanId: "a", description: "客人第一次付款", autoDescription: "首款" },
  ]) {
    assert.equal(selectCashPlan(draft, "b", "尾款").description, draft.description);
    assert.equal(selectCashPlan(draft, "", "").description, draft.description);
  }
  assert.equal(selectCashPlan({ orderPlanId: "a", description: "  ", autoDescription: null }, "b", "尾款").description, "尾款");
});
