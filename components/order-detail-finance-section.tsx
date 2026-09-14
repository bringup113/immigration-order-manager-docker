"use client";

import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Plus,
} from "lucide-react";
import {
  CashEntryTable,
  PlanGroup,
  type CashDirection,
  type Row,
} from "@/components/order-detail-ui";
import { EmptyState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

type Props = {
  loading: boolean;
  plans: Row[];
  receivable: Row[];
  payable: Row[];
  cashEntries: Row[];
  activeCashEntries: Row[];
  cashHasMore: boolean;
  cashPage: number;
  showVoidedCash: boolean;
  canWrite: boolean;
  canRestore: boolean;
  onAddPlan: () => void;
  onAddCash: (direction: CashDirection) => void;
  onMovePlan: (row: Row, direction: "UP" | "DOWN") => void;
  onEditPlan: (row: Row) => void;
  onDeletePlan: (row: Row) => void;
  onEditCash: (direction: CashDirection, row: Row) => void;
  onVoidCash: (row: Row) => void;
  onRestoreCash: (row: Row) => void;
  onToggleVoided: () => void;
  onCashPageChange: (page: number) => void;
};

export function OrderDetailFinanceSection({
  loading,
  plans,
  receivable,
  payable,
  cashEntries,
  activeCashEntries,
  cashHasMore,
  cashPage,
  showVoidedCash,
  canWrite,
  canRestore,
  onAddPlan,
  onAddCash,
  onMovePlan,
  onEditPlan,
  onDeletePlan,
  onEditCash,
  onVoidCash,
  onRestoreCash,
  onToggleVoided,
  onCashPageChange,
}: Props) {
  return (
    <TabsContent value="finance" className="m-0 p-5">
      {loading && <LoadingState />}
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-semibold">订单收付款</h3>
          <p className="mt-1 text-sm text-slate-500">
            计划回答“应收/应付多少”，两类计划分别用箭头排序；实际记录回答“哪天、什么币种、收了或付了多少”。
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onAddPlan}>
              <Plus size={16} /> 新增计划
            </Button>
            <Button variant="outline" onClick={() => onAddCash("RECEIPT")}>
              <ArrowDownLeft size={16} /> 收款
            </Button>
            <Button
              onClick={() => onAddCash("PAYMENT")}
              className="bg-[#0f766e]"
            >
              <ArrowUpRight size={16} /> 付款
            </Button>
          </div>
        )}
      </div>

      {plans.length === 0 ? (
        <EmptyState
          title="暂无收付款计划"
          description="可以按这张订单的实际约定添加应收或应付阶段。"
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {[receivable, payable]
            .filter((rows) => rows.length)
            .map((rows) => (
              <PlanGroup
                key={String(rows[0].plan_type)}
                rows={rows}
                canEdit={canWrite}
                onMove={onMovePlan}
                onEdit={onEditPlan}
                onDelete={onDeletePlan}
              />
            ))}
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-end justify-between gap-3 border-t pt-5">
        <div>
          <h3 className="font-semibold">实际收付款记录</h3>
          <p className="mt-1 text-sm text-slate-500">
            有效记录参与计划和利润计算；作废记录永久保留在历史中。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onToggleVoided}>
          {showVoidedCash ? <Archive size={15} /> : <History size={15} />}{" "}
          {showVoidedCash ? "只看有效记录" : "包含作废记录"}
        </Button>
      </div>

      {activeCashEntries.length === 0 && !showVoidedCash ? (
        <div className="mt-4">
          <EmptyState
            title="暂无有效收付款"
            description="点击“收款”或“付款”登记第一笔记录。"
          />
        </div>
      ) : (
        <CashEntryTable
          rows={showVoidedCash ? cashEntries : activeCashEntries}
          canWrite={canWrite}
          canRestore={canRestore}
          onEdit={onEditCash}
          onVoid={onVoidCash}
          onRestore={onRestoreCash}
        />
      )}

      <div className="mt-4 flex justify-end gap-3">
        <Button
          variant="outline"
          disabled={loading || cashPage === 1}
          onClick={() => onCashPageChange(cashPage - 1)}
        >
          上一页流水
        </Button>
        <span>流水第 {cashPage} 页</span>
        <Button
          variant="outline"
          disabled={loading || !cashHasMore}
          onClick={() => onCashPageChange(cashPage + 1)}
        >
          下一页流水
        </Button>
      </div>
    </TabsContent>
  );
}
