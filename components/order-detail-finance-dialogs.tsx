import {
  CurrencySelect,
  type CurrencyOption,
} from "@/components/currency-select";
import {
  CashCalculationInput,
  Choose,
  Field,
  directionLabel,
  planLabel,
  type CashDirection,
  type Row,
} from "@/components/order-detail-ui";
import type {
  CashDraft,
  OrderDetailDialog,
  PlanDraft,
} from "@/components/order-detail-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CashCalculatedField } from "@/lib/cash-calculation";

type Props = {
  activeDialog: OrderDetailDialog;
  message: string;
  currencies: CurrencyOption[];
  currenciesLoading: boolean;
  editingCashId: string;
  cash: CashDraft;
  matchingPlans: Row[];
  cashValuesValid: boolean;
  onCashChange: (value: CashDraft) => void;
  onCashValueChange: (
    field: "amount" | "baseAmount" | "ratePerUsd",
    value: string,
  ) => void;
  onCalculatedCashFieldChange: (field: CashCalculatedField) => void;
  onCashCurrencyChange: (currency: string) => void;
  onCloseCash: () => void;
  onSaveCash: () => Promise<void>;
  editingPlanId: string;
  plan: PlanDraft;
  onPlanChange: (value: PlanDraft) => void;
  onClosePlan: () => void;
  onSavePlan: () => Promise<void>;
};

export function OrderDetailFinanceDialogs({
  activeDialog,
  message,
  currencies,
  currenciesLoading,
  editingCashId,
  cash,
  matchingPlans,
  cashValuesValid,
  onCashChange,
  onCashValueChange,
  onCalculatedCashFieldChange,
  onCashCurrencyChange,
  onCloseCash,
  onSaveCash,
  editingPlanId,
  plan,
  onPlanChange,
  onClosePlan,
  onSavePlan,
}: Props) {
  return (
    <>
      <Dialog
        open={activeDialog === "cash"}
        onOpenChange={(open) => !open && onCloseCash()}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingCashId
                ? `修改${directionLabel[cash.direction]}记录`
                : `登记${directionLabel[cash.direction]}`}
            </DialogTitle>
            <DialogDescription>
              原币金额、USD
              本位币金额和汇率任选两项填写，第三项由系统计算并保存为本次历史快照。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="类型">
              <Choose
                value={cash.direction}
                onChange={(direction) =>
                  onCashChange({
                    ...cash,
                    direction: direction as CashDirection,
                    orderPlanId: "",
                  })
                }
                items={Object.entries(directionLabel)}
              />
            </Field>
            <Field label="日期">
              <Input
                className="mt-2"
                type="date"
                value={cash.entryDate}
                onChange={(event) =>
                  onCashChange({ ...cash, entryDate: event.target.value })
                }
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="收付款说明">
                <Input
                  className="mt-2"
                  value={cash.description}
                  onChange={(event) =>
                    onCashChange({ ...cash, description: event.target.value })
                  }
                  placeholder={
                    cash.direction === "RECEIPT"
                      ? "例如：签约首款"
                      : "例如：项目方申请费 / 代理佣金"
                  }
                />
              </Field>
            </div>
            <Field label="实际币种">
              <CurrencySelect
                value={cash.currency}
                onChange={onCashCurrencyChange}
                currencies={currencies}
              />
            </Field>
            <Field label="关联计划（可选）">
              <Choose
                value={cash.orderPlanId || "NONE"}
                onChange={(value) =>
                  onCashChange({
                    ...cash,
                    orderPlanId: value === "NONE" ? "" : value,
                  })
                }
                items={[
                  ["NONE", "不关联具体计划"],
                  ...matchingPlans.map((row) => [
                    String(row.id),
                    `${String(row.name)} · ${String(row.currency)}`,
                  ]),
                ]}
              />
            </Field>
            <CashCalculationInput
              label={`原币金额（${cash.currency}）`}
              value={cash.amount}
              auto={cash.calculatedField === "amount"}
              autoDisabled={cash.currency === "USD"}
              step="0.01"
              onChange={(value) => onCashValueChange("amount", value)}
              onAuto={() => onCalculatedCashFieldChange("amount")}
            />
            <CashCalculationInput
              label="本位币金额（USD）"
              value={cash.baseAmount}
              auto={cash.calculatedField === "baseAmount"}
              autoDisabled={cash.currency === "USD"}
              step="0.01"
              onChange={(value) => onCashValueChange("baseAmount", value)}
              onAuto={() => onCalculatedCashFieldChange("baseAmount")}
            />
            <div className="sm:col-span-2">
              <CashCalculationInput
                label={`汇率（1 USD = ? ${cash.currency}）`}
                value={cash.currency === "USD" ? "1" : cash.ratePerUsd}
                auto={cash.calculatedField === "ratePerUsd"}
                autoDisabled={cash.currency === "USD"}
                locked={cash.currency === "USD"}
                step="0.00000001"
                onChange={(value) => onCashValueChange("ratePerUsd", value)}
                onAuto={() => onCalculatedCashFieldChange("ratePerUsd")}
              />
            </div>
            <div className="sm:col-span-2 rounded-xl border border-teal-100 bg-teal-50/60 p-3 text-xs text-teal-900">
              {cash.currency === "USD"
                ? "USD 与本位币相同，只需填写原币金额。"
                : "绿色项目由另外两项自动计算；点击其他项目右上角的“改为自动计算”即可切换。"}
              {cash.orderPlanId && (
                <p className="mt-1 text-teal-800">
                  关联不同币种的计划时，系统还会按计划汇率快照自动计算计入计划的金额。
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Field label="备注（可选）">
                <Textarea
                  className="mt-2"
                  value={cash.notes}
                  onChange={(event) =>
                    onCashChange({ ...cash, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseCash}>
              取消
            </Button>
            <Button
              disabled={
                !cash.description.trim() || !cash.entryDate || !cashValuesValid
              }
              onClick={() => void onSaveCash()}
              className="bg-[#0f766e]"
            >
              {editingCashId
                ? "保存修改"
                : `保存${directionLabel[cash.direction]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeDialog === "plan"}
        onOpenChange={(open) => !open && onClosePlan()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPlanId ? "修改订单计划" : "新增订单计划"}
            </DialogTitle>
            <DialogDescription>
              这是订单专属计划，不会写回项目模板。已有实际记录后，类型和币种将不能修改。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="类型">
              <Choose
                value={plan.planType}
                onChange={(planType) => onPlanChange({ ...plan, planType })}
                items={Object.entries(planLabel)}
              />
            </Field>
            <Field label="阶段名称">
              <Input
                className="mt-2"
                value={plan.name}
                onChange={(event) =>
                  onPlanChange({ ...plan, name: event.target.value })
                }
              />
            </Field>
            <Field label="币种">
              <CurrencySelect
                value={plan.currency}
                onChange={(currency) => onPlanChange({ ...plan, currency })}
                currencies={currencies}
              />
            </Field>
            <Field label="计划金额">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                className="mt-2"
                value={plan.amount}
                onChange={(event) =>
                  onPlanChange({ ...plan, amount: event.target.value })
                }
              />
            </Field>
            <Field label="计划日期">
              <Input
                type="date"
                className="mt-2"
                value={plan.dueDate}
                onChange={(event) =>
                  onPlanChange({ ...plan, dueDate: event.target.value })
                }
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="备注">
                <Textarea
                  className="mt-2"
                  value={plan.notes}
                  onChange={(event) =>
                    onPlanChange({ ...plan, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClosePlan}>
              取消
            </Button>
            <Button
              disabled={
                !plan.name.trim() ||
                Number(plan.amount) <= 0 ||
                currenciesLoading
              }
              onClick={() => void onSavePlan()}
              className="bg-[#0f766e]"
            >
              {editingPlanId ? "保存修改" : "保存计划"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
