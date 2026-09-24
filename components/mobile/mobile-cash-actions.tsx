"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { CurrencyOption } from "@/components/currency-select";
import type { CashDraft } from "@/components/order-detail-types";
import type { CashDirection, Row } from "@/components/order-detail-ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMobileOrderMutation } from "@/hooks/use-mobile-order-mutation";
import { formatMoney } from "@/lib/amount";
import { calculateCashValues, defaultCashRate, withCashAutoInput, withCashCurrency } from "@/lib/cash-calculation";
import { selectCashPlan } from "@/lib/cash-plan-description";

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function newCashDraft(direction: CashDirection, plans: Row[], currencies: CurrencyOption[]): CashDraft {
  const plan = plans.find((item) => item.plan_type === (direction === "RECEIPT" ? "RECEIVABLE" : "PAYABLE"));
  const preferred = String(plan?.currency || "USD");
  const currency = currencies.some((item) => item.currency === preferred) ? preferred : currencies.find((item) => item.currency === "USD")?.currency || currencies[0]?.currency || "USD";
  return {
    direction, entryDate: localDateKey(), description: "", currency, amount: "", baseAmount: "",
    ratePerUsd: defaultCashRate(currency, currencies), calculatedField: "baseAmount",
    inputOrder: currency === "USD" || !defaultCashRate(currency, currencies) ? [] : ["ratePerUsd"],
    orderPlanId: "", notes: "",
  };
}

const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm";

export function MobileCashActions({ orderNo, version, plans, currencies, readPending, onReload }: {
  orderNo: string;
  version: number;
  plans: Row[];
  currencies: CurrencyOption[];
  readPending: boolean;
  onReload: () => void;
}) {
  const [direction, setDirection] = useState<CashDirection | null>(null);
  const [discardCash, setDiscardCash] = useState(false);
  const [cash, setCash] = useState<CashDraft>(() => newCashDraft("RECEIPT", plans, currencies));
  const { pending, disabled, needsRefresh, uncertain, error, notice, submit, clearFeedback, acknowledge } =
    useMobileOrderMutation(orderNo, version, readPending, onReload);
  const matchingPlans = plans.filter((item) => item.plan_type === (direction === "RECEIPT" ? "RECEIVABLE" : "PAYABLE"));
  const calculated = calculateCashValues(cash);
  const cashValuesValid = calculated !== null && (cash.currency !== "USD" || calculated.amountMinor === calculated.baseAmountMinor && calculated.rateScaled === 100_000_000);
  const cashDirty = Boolean(cash.amount || cash.baseAmount || cash.description || cash.orderPlanId || cash.notes || cash.entryDate !== localDateKey());

  function open(nextDirection: CashDirection) {
    if (disabled || currencies.length === 0) return;
    clearFeedback();
    setCash(newCashDraft(nextDirection, plans, currencies));
    setDirection(nextDirection);
  }

  function changeValue(field: "amount" | "baseAmount" | "ratePerUsd", value: string) {
    setCash((current) => withCashAutoInput(current, field, value));
  }

  function changeCurrency(currency: string) {
    setCash((current) => withCashCurrency(current, currency, defaultCashRate(currency, currencies)));
  }

  function save() {
    if (!direction || !cashValuesValid || !cash.description.trim() || !cash.entryDate) return;
    const payload = { ...cash };
    delete payload.autoDescription;
    delete payload.inputOrder;
    void submit({ action: "saveCashEntry", ...payload }, {
      successMessage: `${direction === "RECEIPT" ? "收款" : "付款"}已登记。`,
      onSuccess: () => setDirection(null),
    });
  }

  function closeCash() {
    if (pending) return;
    if (cashDirty) setDiscardCash(true);
    else setDirection(null);
  }

  return <section aria-label="收支操作"
    className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 mx-auto max-w-[520px] border-t border-slate-200 bg-white/95 px-4 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={disabled || currencies.length === 0} onClick={() => open("RECEIPT")}
        className="flex min-h-11 items-center justify-center gap-1 rounded-xl border border-teal-600 px-2 text-sm font-semibold text-teal-700 disabled:opacity-50">
        <ArrowDownLeft size={16} /> 登记收款
      </button>
      <button type="button" disabled={disabled || currencies.length === 0} onClick={() => open("PAYMENT")}
        className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-teal-700 px-2 text-sm font-semibold text-white disabled:opacity-50">
        <ArrowUpRight size={16} /> 登记付款
      </button>
    </div>
    {currencies.length === 0 && <p className="mt-2 text-xs text-amber-700">暂无可用币种，暂不能登记收付款。</p>}
    {needsRefresh && <p role="status" className="mt-2 text-xs text-slate-500">正在确认最新订单状态…</p>}
    {notice && <p role="status" className="mt-2 text-xs text-teal-700">{notice}</p>}
    {error && !direction && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    {uncertain && !readPending && !direction && <button type="button" onClick={acknowledge} className="mt-2 text-xs font-semibold text-teal-700">已核对订单，继续操作</button>}

    <Dialog open={direction !== null} onOpenChange={(opened) => { if (opened) return; closeCash(); }}>
      <DialogContent className="!left-0 !top-0 !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-y-auto !rounded-none px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <DialogHeader>
          <DialogTitle>{direction === "RECEIPT" ? "登记收款" : "登记付款"}</DialogTitle>
          <DialogDescription>原币金额、USD 金额和汇率任选两项填写，第三项自动算出；自动算出的数值也可以直接修改。</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4">
          <div><Label htmlFor="mobile-cash-date">日期</Label><Input id="mobile-cash-date" type="date" required className="mt-2" value={cash.entryDate} onChange={(event) => setCash({ ...cash, entryDate: event.target.value })} /></div>
          <div><Label htmlFor="mobile-cash-plan">关联计划（可选）</Label><select id="mobile-cash-plan" className={inputClass} value={cash.orderPlanId} onChange={(event) => {
            const plan = matchingPlans.find((item) => String(item.id) === event.target.value);
            setCash(selectCashPlan(cash, event.target.value, String(plan?.name || "")));
          }}><option value="">不关联计划</option>{matchingPlans.map((plan) => <option key={String(plan.id)} value={String(plan.id)}>{String(plan.name)} · {formatMoney(String(plan.currency), plan.planned_amount_minor)}</option>)}</select></div>
          <div><Label htmlFor="mobile-cash-description">{direction === "RECEIPT" ? "收款说明" : "付款说明"}</Label><Input id="mobile-cash-description" required maxLength={200} className="mt-2" value={cash.description} onChange={(event) => setCash({ ...cash, description: event.target.value, autoDescription: null })} placeholder={direction === "RECEIPT" ? "例如：签约首款" : "例如：项目方申请费"} /></div>
          <div><Label htmlFor="mobile-cash-currency">实际币种</Label><select id="mobile-cash-currency" required className={inputClass} value={cash.currency} onChange={(event) => changeCurrency(event.target.value)}>{currencies.map((option) => <option key={option.currency} value={option.currency}>{option.currency}{option.name ? ` · ${option.name}` : ""}</option>)}</select></div>
          <div><Label htmlFor="mobile-cash-amount">原币金额（{cash.currency}）{cash.calculatedField === "amount" ? " · 自动算出" : ""}</Label><Input id="mobile-cash-amount" type="number" min="0.01" step="0.01" inputMode="decimal" className="mt-2" value={cash.amount} onChange={(event) => changeValue("amount", event.target.value)} /></div>
          {cash.currency !== "USD" && <details className="rounded-2xl border border-slate-200 bg-slate-50">
            <summary className="min-h-12 cursor-pointer list-none px-4 py-4 text-sm font-semibold text-slate-700">调整本位币金额与汇率</summary>
            <div className="space-y-4 border-t border-slate-200 p-4">
              <div><Label htmlFor="mobile-cash-base">本位币金额（USD）{cash.calculatedField === "baseAmount" ? " · 自动算出" : ""}</Label><Input id="mobile-cash-base" type="number" min="0.01" step="0.01" inputMode="decimal" className="mt-2" value={cash.baseAmount} onChange={(event) => changeValue("baseAmount", event.target.value)} /></div>
              <div><Label htmlFor="mobile-cash-rate">汇率（1 USD = ? {cash.currency}）{cash.calculatedField === "ratePerUsd" ? " · 自动算出" : ""}</Label><Input id="mobile-cash-rate" type="number" min="0.00000001" step="0.00000001" inputMode="decimal" className="mt-2" value={cash.ratePerUsd} onChange={(event) => changeValue("ratePerUsd", event.target.value)} /></div>
            </div>
          </details>}
          <p className="rounded-xl bg-teal-50 p-3 text-xs text-teal-900">{calculated && cashValuesValid ? `将登记 ${formatMoney(cash.currency, calculated.amountMinor)}；本位币 ${formatMoney("USD", calculated.baseAmountMinor)}。` : cash.currency === "USD" ? "USD 只需填写其中一项金额。" : "请填写任意两项大于 0 且在允许范围内的金额或汇率。"}{cash.orderPlanId ? " 如计划币种不同，计入计划的金额将按计划汇率快照换算。" : ""}{cash.currency !== "USD" ? " 切换币种会清空金额。" : ""}</p>
          <div><Label htmlFor="mobile-cash-notes">备注（可选）</Label><Textarea id="mobile-cash-notes" maxLength={4000} className="mt-2" value={cash.notes} onChange={(event) => setCash({ ...cash, notes: event.target.value })} /></div>
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {uncertain && !readPending && <button type="button" onClick={acknowledge} className="text-xs font-semibold text-teal-700">已核对订单，继续操作</button>}
          <DialogFooter>
            <button type="button" disabled={pending} onClick={closeCash} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm disabled:opacity-50">取消</button>
            <button type="submit" disabled={disabled || !cash.description.trim() || !cash.entryDate || !cashValuesValid} className="min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "正在保存…" : direction === "RECEIPT" ? "保存收款" : "保存付款"}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={discardCash} onOpenChange={setDiscardCash}
      title="放弃未保存的收支记录？" description="当前填写内容尚未保存，关闭后将无法恢复。"
      confirmLabel="放弃并关闭" destructive pending={false}
      onConfirm={() => { setDiscardCash(false); setDirection(null); }} />
  </section>;
}
