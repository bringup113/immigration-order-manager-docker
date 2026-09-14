import { useState } from "react";
import type { CurrencyOption } from "@/components/currency-select";
import {
  directionLabel,
  type CashDirection,
  type Row,
} from "@/components/order-detail-ui";
import type {
  CashDraft,
  OrderDetailConfirmation,
  OrderDetailData,
  OrderDetailDialog,
  PlanDraft,
} from "@/components/order-detail-types";
import {
  calculateCashValues,
  minorInput,
  rateInput,
  type CashCalculatedField,
} from "@/lib/cash-calculation";

type UseOrderFinanceActionsOptions = {
  data: OrderDetailData | null;
  currencies: CurrencyOption[];
  today: () => string;
  act: (payload: unknown) => Promise<void>;
  run: (payload: unknown, close?: boolean) => Promise<void>;
  setActiveTab: (tab: string) => void;
  setDialog: (dialog: OrderDetailDialog) => void;
  setMessage: (message: string) => void;
  askConfirmation: (confirmation: OrderDetailConfirmation) => void;
};

export function useOrderFinanceActions({
  data,
  currencies,
  today,
  act,
  run,
  setActiveTab,
  setDialog,
  setMessage,
  askConfirmation,
}: UseOrderFinanceActionsOptions) {
  const [editingPlanId, setEditingPlanId] = useState("");
  const [editingCashId, setEditingCashId] = useState("");
  const [plan, setPlan] = useState<PlanDraft>({
    planType: "RECEIVABLE",
    name: "",
    currency: "USD",
    amount: "",
    dueDate: "",
    notes: "",
  });
  const [cash, setCash] = useState<CashDraft>({
    direction: "RECEIPT",
    entryDate: today(),
    description: "",
    currency: "USD",
    amount: "",
    baseAmount: "",
    ratePerUsd: "1",
    calculatedField: "baseAmount",
    orderPlanId: "",
    notes: "",
  });

  function rateFor(currency: string) {
    return String(
      currencies.find((item) => item.currency === currency)?.rate_per_usd ||
        (currency === "USD" ? 1 : ""),
    );
  }

  function withCashCalculation(next: CashDraft) {
    const calculated = calculateCashValues(next);
    if (!calculated) return { ...next, [next.calculatedField]: "" };
    if (next.calculatedField === "amount")
      return { ...next, amount: minorInput(calculated.amountMinor) };
    if (next.calculatedField === "baseAmount")
      return {
        ...next,
        baseAmount: minorInput(calculated.baseAmountMinor),
      };
    return { ...next, ratePerUsd: rateInput(calculated.rateScaled) };
  }

  function changeCashValue(
    field: "amount" | "baseAmount" | "ratePerUsd",
    value: string,
  ) {
    setCash((current) => withCashCalculation({ ...current, [field]: value }));
  }

  function setCalculatedCashField(calculatedField: CashCalculatedField) {
    setCash((current) => withCashCalculation({ ...current, calculatedField }));
  }

  function changeCashCurrency(currency: string) {
    setCash((current) =>
      withCashCalculation({
        ...current,
        currency,
        ratePerUsd: rateFor(currency),
        calculatedField: "baseAmount",
      }),
    );
  }

  function openPlan(row?: Row) {
    setEditingPlanId(row ? String(row.id) : "");
    const defaultCurrency = String(
      data?.plans.find((item) => item.plan_type === "RECEIVABLE")?.currency ||
        "USD",
    );
    setPlan(
      row
        ? {
            planType: String(row.plan_type),
            name: String(row.name),
            currency: String(row.currency),
            amount: String(Number(row.planned_amount_minor) / 100),
            dueDate: String(row.due_date || ""),
            notes: String(row.notes || ""),
          }
        : {
            planType: "RECEIVABLE",
            name: "",
            currency: defaultCurrency,
            amount: "",
            dueDate: "",
            notes: "",
          },
    );
    setMessage("");
    setDialog("plan");
  }

  function openCash(direction: CashDirection, row?: Row) {
    setEditingCashId(row ? String(row.id) : "");
    const matchingPlan = data?.plans.find(
      (item) =>
        item.plan_type === (direction === "RECEIPT" ? "RECEIVABLE" : "PAYABLE"),
    );
    const currency = row
      ? String(row.currency)
      : String(matchingPlan?.currency || "USD");
    setCash(
      row
        ? {
            direction: String(row.direction) as CashDirection,
            entryDate: String(row.entry_date),
            description: String(row.description),
            currency,
            amount: String(Number(row.amount_minor) / 100),
            baseAmount: String(Number(row.base_amount_minor) / 100),
            ratePerUsd: String(row.rate_per_usd),
            calculatedField: "baseAmount",
            orderPlanId: String(row.order_plan_id || ""),
            notes: String(row.notes || ""),
          }
        : {
            direction,
            entryDate: today(),
            description: "",
            currency,
            amount: "",
            baseAmount: "",
            ratePerUsd: rateFor(currency),
            calculatedField: "baseAmount",
            orderPlanId: "",
            notes: "",
          },
    );
    setMessage("");
    setActiveTab("finance");
    setDialog("cash");
  }

  function savePlan() {
    return run(
      {
        action: editingPlanId ? "updatePlan" : "plan",
        planId: editingPlanId || undefined,
        ...plan,
      },
      true,
    );
  }

  function saveCashEntry() {
    return run(
      {
        action: "saveCashEntry",
        entryId: editingCashId || undefined,
        ...cash,
      },
      true,
    );
  }

  function removePlan(row: Row) {
    askConfirmation({
      title: "删除收付款计划",
      description: `确定删除“${String(row.name)}”吗？删除后无法恢复。`,
      confirmLabel: "确认删除",
      pendingLabel: "正在删除…",
      onConfirm: async () => {
        await act({ action: "deletePlan", planId: row.id });
      },
    });
  }

  function voidCash(row: Row) {
    const direction = directionLabel[String(row.direction) as CashDirection];
    askConfirmation({
      title: `作废${direction}记录`,
      description: `确定作废“${String(row.description)}”吗？作废后不再参与计划进度、实际收付和利润计算，并可由具有恢复权限的用户恢复。`,
      confirmLabel: "确认作废",
      pendingLabel: "正在作废…",
      reasonLabel: "作废原因",
      reasonPlaceholder: "请填写这笔记录需要作废的原因",
      onConfirm: async (reason) => {
        await act({ action: "voidCashEntry", entryId: row.id, reason });
      },
    });
  }

  function restoreCash(row: Row) {
    askConfirmation({
      title: "恢复收付款记录",
      description: `确定恢复“${String(row.description)}”吗？恢复后会重新计入订单计划和利润。`,
      confirmLabel: "确认恢复",
      pendingLabel: "正在恢复…",
      destructive: false,
      reasonLabel: "恢复原因",
      reasonPlaceholder: "请填写恢复这笔记录的原因",
      onConfirm: async (reason) => {
        await act({ action: "restoreCashEntry", entryId: row.id, reason });
      },
    });
  }

  const matchingPlans =
    data?.plans.filter(
      (item) =>
        item.plan_type ===
        (cash.direction === "RECEIPT" ? "RECEIVABLE" : "PAYABLE"),
    ) || [];

  return {
    editingPlanId,
    setEditingPlanId,
    editingCashId,
    setEditingCashId,
    plan,
    setPlan,
    cash,
    setCash,
    matchingPlans,
    cashValuesValid: Boolean(calculateCashValues(cash)),
    changeCashValue,
    setCalculatedCashField,
    changeCashCurrency,
    openPlan,
    openCash,
    savePlan,
    saveCashEntry,
    removePlan,
    voidCash,
    restoreCash,
  };
}
