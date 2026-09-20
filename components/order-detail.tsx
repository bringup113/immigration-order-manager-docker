/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/components/current-user-provider";
import type { CurrencyOption } from "@/components/currency-select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/components/data-state";
import { ImagePreview } from "@/components/image-preview";
import { OrderDetailFinanceSection } from "@/components/order-detail-finance-section";
import { OrderDetailFinanceDialogs } from "@/components/order-detail-finance-dialogs";
import { OrderDetailClosureDialog } from "@/components/order-detail-closure-dialog";
import { OrderDetailPeopleSection } from "@/components/order-detail-people-section";
import { OrderDetailCommonSection } from "@/components/order-detail-common-section";
import { OrderDetailWorkflowSection } from "@/components/order-detail-workflow-section";
import { OrderDetailWorkflowDialogs } from "@/components/order-detail-workflow-dialogs";
import { OrderDetailPeopleDialogs } from "@/components/order-detail-people-dialogs";
import {
  type OrderDetailConfirmation,
  type OrderDetailData,
  type OrderDetailDialog,
} from "@/components/order-detail-types";
import {
  Metric,
  OrderMeta,
  formatFileSize,
  orderStatusLabel,
  type Row,
} from "@/components/order-detail-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/amount";
import { useApiList } from "@/lib/use-api";
import { useOrderPeopleMaterials } from "@/hooks/use-order-people-materials";
import { useOrderWorkflowActions } from "@/hooks/use-order-workflow-actions";
import { useOrderFinanceActions } from "@/hooks/use-order-finance-actions";
import { useOrderLifecycleActions } from "@/hooks/use-order-lifecycle-actions";

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

export function OrderDetail({ orderNo, initialTab = "workflow" }: { orderNo: string; initialTab?: string }) {
  const currencies = useApiList<CurrencyOption>("currencies");
  const [data, setData] = useState<OrderDetailData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<OrderDetailDialog>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedApplicantId, setSelectedApplicantId] = useState("");
  const [message, setMessage] = useState("");
  const [previewFile, setPreviewFile] = useState<Row | null>(null);
  const { user } = useCurrentUser();
  const permissions = user.permissions;
  const permissionsLoaded = true;
  const [confirmation, setConfirmation] =
    useState<OrderDetailConfirmation | null>(null);
  const [confirmationReason, setConfirmationReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [showVoidedCash, setShowVoidedCash] = useState(false);

  const [historyPage, setHistoryPage] = useState(1);
  const [cashPage, setCashPage] = useState(1);
  const {
    orderNotes,
    notesNotice,
    signedAt,
    signedDateNotice,
    closure,
    setClosure,
    syncOrderDrafts,
    changeOrderNotes,
    changeSignedAt,
    saveOrderNotes,
    saveSignedAt,
    updateOrderStatus,
    openClosure,
    saveClosure,
    reopenClosedOrder,
  } = useOrderLifecycleActions({
    data,
    today,
    act,
    run,
    setDialog,
    setMessage,
    askConfirmation,
  });
  const readController = useRef<AbortController | null>(null);
  const needsClosure = dialog === "close";
  const load = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderNo)}?${new URLSearchParams({ section: activeTab, closure: needsClosure ? "1" : "0", historyPage: String(historyPage), cashPage: String(cashPage), cashStatus: showVoidedCash ? "all" : "active" })}`,
        { cache: "no-store", signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      if (controller.signal.aborted) return;
      setData(result);
      syncOrderDrafts(result.order);
      setSelectedApplicantId((current) =>
        result.applicants.some((item: Row) => item.id === current)
          ? current
          : String(
              result.applicants.find(
                (item: Row) => item.applicant_type === "MAIN",
              )?.id ||
                result.applicants[0]?.id ||
                "",
            ),
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [
    orderNo,
    activeTab,
    needsClosure,
    historyPage,
    cashPage,
    showVoidedCash,
    syncOrderDrafts,
  ]);
  useEffect(() => {
    void load();
    return () => readController.current?.abort();
  }, [load]);
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, orderNo]);
  useEffect(() => {
    if (
      permissionsLoaded &&
      activeTab === "finance" &&
      !permissions.includes("*") &&
      !permissions.includes("finance.read")
    )
      setActiveTab("workflow");
  }, [activeTab, permissions, permissionsLoaded]);

  async function act(payload: unknown) {
    setMessage("");
    const response = await fetch(`/api/orders/${encodeURIComponent(orderNo)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(payload as Record<string, unknown>),
        expectedVersion: Number(data?.order.version || 1),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await load();
      throw new Error(result.error || "保存失败");
    }
    await load();
  }
  async function run(payload: unknown, close = false) {
    try {
      await act(payload);
      if (close) setDialog(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  }
  function askConfirmation(value: OrderDetailConfirmation) {
    setConfirmationReason("");
    setMessage("");
    setConfirmation(value);
  }

  async function confirmAction() {
    if (!confirmation) return;
    setConfirming(true);
    try {
      await confirmation.onConfirm(confirmationReason.trim());
      setConfirmation(null);
      setConfirmationReason("");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setConfirming(false);
    }
  }

  const {
    selectedApplicant,
    fileNotice,
    uploadingMaterialId,
    editingMaterialId,
    setEditingMaterialId,
    editingApplicantId,
    setEditingApplicantId,
    material,
    setMaterial,
    applicant,
    setApplicant,
    mrzReview,
    setMrzReview,
    scanningPassport,
    uploadMaterialFile,
    replaceMaterialFile,
    changeMaterialFileStatus,
    addMaterial,
    editMaterial,
    removeMaterial,
    saveMaterial,
    openApplicant,
    scanCurrentPassport,
    confirmMrzReview,
    saveApplicant,
    removeApplicant,
  } = useOrderPeopleMaterials({
    orderNo,
    data,
    selectedApplicantId,
    permissions,
    act,
    load,
    setDialog,
    setMessage,
    askConfirmation,
  });

  const {
    editingStepId,
    setEditingStepId,
    editingTaskId,
    setEditingTaskId,
    progress,
    setProgress,
    step,
    setStep,
    task,
    setTask,
    taskRelatedItems,
    openProgress,
    saveProgress,
    openStep,
    saveStep,
    removeStep,
    updateStepStatus,
    moveStep,
    openTask,
    saveTask,
    removeTask,
    toggleTask,
    completeFollowUp,
  } = useOrderWorkflowActions({
    data,
    permissions,
    today,
    act,
    run,
    setDialog,
    setMessage,
    askConfirmation,
  });

  const {
    editingPlanId,
    setEditingPlanId,
    editingCashId,
    setEditingCashId,
    plan,
    setPlan,
    cash,
    setCash,
    matchingPlans,
    cashValuesValid,
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
  } = useOrderFinanceActions({
    data,
    currencies: currencies.rows,
    today,
    act,
    run,
    setActiveTab,
    setDialog,
    setMessage,
    askConfirmation,
  });

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;
  const order = data.order;
  const can = (permission: string) =>
    permissions.includes("*") || permissions.includes(permission);
  const receivable = data.plans.filter(
    (item) => item.plan_type === "RECEIVABLE",
  );
  const payable = data.plans.filter((item) => item.plan_type === "PAYABLE");
  const sum = (rows: Row[], key: string) =>
    rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const completedSteps = data.steps.filter(
    (item) => item.status === "COMPLETED" || item.status === "SKIPPED",
  ).length;
  const workflowPercent = data.steps.length
    ? Math.round((completedSteps / data.steps.length) * 100)
    : 0;
  const applicantMaterials = data.materials.filter(
    (item) => item.applicant_id === selectedApplicant?.id,
  );
  const commonMaterials = data.materials.filter((item) => !item.applicant_id);
  const activeCashEntries = data.cashEntries.filter(
    (item) => item.status !== "VOIDED",
  );

  const expectedProfit =
    sum(receivable, "planned_base_minor") - sum(payable, "planned_base_minor");
  const mainApplicant = String(
    data.applicants.find((item) => item.applicant_type === "MAIN")?.name ||
      "未填写主申请人",
  );
  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
                订单详情
              </span>
              <Badge variant="outline" className="status teal">
                项目模板 V{String(order.project_revision)}
              </Badge>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {String(order.project_name_snapshot)}
            </h1>
            <p className="mt-1 text-base font-medium text-slate-700">
              主申请人：{mainApplicant}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {String(order.country_snapshot)} · 代理来源：
              {String(order.agent_name)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("orders.assign") ? (
              <Select
                value={String(order.owner_user_id)}
                onValueChange={(ownerUserId) =>
                  void run({ action: "assignOwner", ownerUserId })
                }
              >
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.assignableUsers.map((user) => (
                    <SelectItem key={String(user.id)} value={String(user.id)}>
                      {String(user.display_name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge variant="outline" className="px-3">
                负责人：{String(order.owner_name)}
              </Badge>
            )}
            {order.status === "COMPLETED" ? (
              <>
                <Badge variant="outline" className="status green px-3">
                  已结案 · {String(order.closed_on)}
                </Badge>
                {can("orders.override") && (
                  <Button variant="outline" onClick={reopenClosedOrder}>
                    <RotateCcw size={16} /> 重新开启
                  </Button>
                )}
              </>
            ) : (
              can("orders.write") && (
                <>
                  <Select
                    value={String(order.status)}
                    onValueChange={(status) => void updateOrderStatus(status)}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(orderStatusLabel)
                        .filter(([value]) => value !== "COMPLETED")
                        .map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={openProgress}>
                    <Plus size={16} /> 记录跟进
                  </Button>
                  <Button onClick={openClosure} className="bg-[#0f766e]">
                    <CheckCircle2 size={16} /> 正式结案
                  </Button>
                </>
              )
            )}
            {can("finance.write") && (
              <>
                <Button variant="outline" onClick={() => openCash("RECEIPT")}>
                  <ArrowDownLeft size={16} /> 登记收款
                </Button>
                <Button
                  onClick={() => openCash("PAYMENT")}
                  className="bg-[#0f766e]"
                >
                  <ArrowUpRight size={16} /> 登记付款
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="grid gap-4 border-b bg-slate-50/60 px-5 py-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.4fr]">
          <OrderMeta label="代理来源" value={String(order.agent_name)} />
          <OrderMeta label="订单编号" value={String(order.order_no)} mono />
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">签订日期</p>
              {signedDateNotice && (
                <span className="text-xs text-emerald-700">
                  {signedDateNotice}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                disabled={!can("orders.write")}
                type="date"
                value={signedAt}
                onChange={(event) => changeSignedAt(event.target.value)}
              />
              {can("orders.write") && (
                <Button
                  variant="outline"
                  disabled={
                    !signedAt || signedAt === String(order.signed_at || "")
                  }
                  onClick={() => void saveSignedAt()}
                >
                  保存
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              修改日期不会改变已生成的订单编号。
            </p>
          </div>
        </div>
        <div className="border-b px-5 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label htmlFor="order-notes">订单备注</Label>
            {notesNotice && (
              <span className="text-xs text-emerald-700">{notesNotice}</span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              id="order-notes"
              disabled={!can("orders.write")}
              value={orderNotes}
              onChange={(event) => changeOrderNotes(event.target.value)}
              placeholder="填写合同或办理注意事项"
              className="min-h-16 flex-1 resize-y"
            />
            {can("orders.write") && (
              <Button
                variant="outline"
                disabled={orderNotes === String(order.notes || "")}
                onClick={() => void saveOrderNotes()}
              >
                保存备注
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3 bg-slate-50/70 px-5 py-4 lg:grid-cols-[160px_1fr_auto] lg:items-center">
          <div>
            <p className="text-xs text-slate-500">办理流程</p>
            <p className="mt-1 font-semibold">
              {completedSteps} / {data.steps.length} 步完成
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${workflowPercent}%` }}
            />
          </div>
          <span className="text-sm font-semibold text-teal-700">
            {workflowPercent}%
          </span>
        </div>
      </section>
      {message && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {message}
        </div>
      )}

      {can("finance.read") && (
        <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric
            label="计划应收"
            value={formatMoney("USD", sum(receivable, "planned_base_minor"))}
          />
          <Metric
            label="实际已收"
            value={formatMoney("USD", data.receivedBaseMinor)}
            green
          />
          <Metric
            label="计划应付"
            value={formatMoney("USD", sum(payable, "planned_base_minor"))}
          />
          <Metric
            label="实际已付"
            value={formatMoney("USD", data.paidBaseMinor)}
          />
          <Metric
            label="预计利润"
            value={formatMoney("USD", expectedProfit)}
            green={expectedProfit >= 0}
          />
          <Metric
            label={order.status === "COMPLETED" ? "订单利润" : "当前订单利润"}
            value={formatMoney("USD", data.balanceBaseMinor)}
            green={data.balanceBaseMinor >= 0}
          />
        </section>
      )}

      <section className="panel mt-4 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
          <div className="detail-tabs-nav overflow-x-auto overflow-y-hidden px-4 md:overflow-visible">
            <TabsList
              className="detail-tabs-list grid w-full min-w-[540px] md:min-w-0"
              style={{
                gridTemplateColumns: `repeat(${can("finance.read") ? 4 : 3}, minmax(0, 1fr))`,
              }}
            >
              <TabsTrigger className="tab-trigger" value="workflow">
                办理与跟进
              </TabsTrigger>
              {can("finance.read") && (
                <TabsTrigger className="tab-trigger" value="finance">
                  订单收支
                </TabsTrigger>
              )}
              <TabsTrigger className="tab-trigger" value="people">
                申请人与材料
              </TabsTrigger>
              <TabsTrigger className="tab-trigger" value="common">
                合同与付款
              </TabsTrigger>
            </TabsList>
          </div>
          <OrderDetailWorkflowSection
            loading={loading}
            steps={data.steps}
            tasks={data.tasks}
            progress={data.progress}
            historyPage={historyPage}
            historyHasMore={data.historyHasMore}
            today={today()}
            canWriteOrders={can("orders.write")}
            canOverrideOrders={can("orders.override")}
            canReadTasks={can("tasks.read")}
            canWriteTasks={can("tasks.write")}
            onAddStep={() => openStep()}
            onMoveStep={moveStep}
            onEditStep={openStep}
            onDeleteStep={(row) => void removeStep(row)}
            onStepStatusChange={(row, status) =>
              void updateStepStatus(row, status)
            }
            onAddTask={() => openTask()}
            onToggleTask={toggleTask}
            onEditTask={openTask}
            onDeleteTask={(row) => void removeTask(row)}
            onAddProgress={openProgress}
            onCompleteFollowUp={completeFollowUp}
            onHistoryPageChange={setHistoryPage}
          />

          {can("finance.read") && (
            <OrderDetailFinanceSection
              loading={loading}
              plans={data.plans}
              receivable={receivable}
              payable={payable}
              cashEntries={data.cashEntries}
              activeCashEntries={activeCashEntries}
              cashHasMore={data.cashHasMore}
              cashPage={cashPage}
              showVoidedCash={showVoidedCash}
              canWrite={can("finance.write")}
              canRestore={can("finance.restore")}
              onAddPlan={() => openPlan()}
              onAddCash={(direction) => openCash(direction)}
              onMovePlan={(row, direction) =>
                void run({ action: "movePlan", planId: row.id, direction })
              }
              onEditPlan={openPlan}
              onDeletePlan={(row) => void removePlan(row)}
              onEditCash={openCash}
              onVoidCash={(row) => void voidCash(row)}
              onRestoreCash={(row) => void restoreCash(row)}
              onToggleVoided={() => {
                setShowVoidedCash((value) => !value);
                setCashPage(1);
              }}
              onCashPageChange={setCashPage}
            />
          )}

          <OrderDetailPeopleSection
            applicants={data.applicants}
            selectedApplicant={selectedApplicant}
            applicantMaterials={applicantMaterials}
            materialFiles={data.materialFiles}
            uploadingMaterialId={uploadingMaterialId}
            fileNotice={fileNotice}
            scanningPassport={scanningPassport}
            canWriteApplicants={can("applicants.write")}
            canScanMrz={can("applicants.mrz")}
            canReadMaterials={can("materials.read")}
            canWriteMaterials={can("materials.write")}
            canRestoreMaterials={can("materials.restore")}
            canDownloadMaterials={can("materials.download")}
            onAddApplicant={() => openApplicant()}
            onSelectApplicant={setSelectedApplicantId}
            onEditApplicant={openApplicant}
            onDeleteApplicant={(row) => void removeApplicant(row)}
            onScanPassport={() => void scanCurrentPassport()}
            materialHandlers={{
              onAdd: () => addMaterial(String(selectedApplicant?.id || "")),
              onEdit: editMaterial,
              onDelete: (row) => void removeMaterial(row),
              onUpload: (materialId, file) =>
                void uploadMaterialFile(materialId, file),
              onReplace: replaceMaterialFile,
              onPreview: setPreviewFile,
              onVoidFile: (fileId, fileName, version) =>
                changeMaterialFileStatus(fileId, fileName, version, "VOID"),
              onRestoreFile: (fileId, fileName, version) =>
                changeMaterialFileStatus(fileId, fileName, version, "RESTORE"),
            }}
          />

          <OrderDetailCommonSection
            canRead={can("materials.read")}
            canEdit={can("materials.write")}
            canRestore={can("materials.restore")}
            canDownload={can("materials.download")}
            notice={fileNotice}
            materials={commonMaterials}
            files={data.materialFiles}
            uploadingMaterialId={uploadingMaterialId}
            onAdd={() => addMaterial("")}
            onEdit={editMaterial}
            onDelete={(row) => void removeMaterial(row)}
            onUpload={(materialId, file) =>
              void uploadMaterialFile(materialId, file)
            }
            onReplace={replaceMaterialFile}
            onPreview={setPreviewFile}
            onVoidFile={(fileId, fileName, version) =>
              changeMaterialFileStatus(fileId, fileName, version, "VOID")
            }
            onRestoreFile={(fileId, fileName, version) =>
              changeMaterialFileStatus(fileId, fileName, version, "RESTORE")
            }
          />
        </Tabs>
      </section>

      <ConfirmDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !confirming) {
            setConfirmation(null);
            setConfirmationReason("");
          }
        }}
        title={confirmation?.title || "确认操作"}
        description={confirmation?.description || ""}
        confirmLabel={confirmation?.confirmLabel}
        pendingLabel={confirmation?.pendingLabel}
        pending={confirming}
        destructive={confirmation?.destructive}
        reasonLabel={confirmation?.reasonLabel}
        reasonPlaceholder={confirmation?.reasonPlaceholder}
        reasonValue={confirmationReason}
        onReasonChange={setConfirmationReason}
        error={message || undefined}
        onConfirm={() => void confirmAction()}
      />

      <Dialog
        open={Boolean(previewFile)}
        onOpenChange={(open) => !open && setPreviewFile(null)}
      >
        <DialogContent className="h-[90vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="pr-8">文件预览</DialogTitle>
            <DialogDescription className="truncate">
              {previewFile
                ? `${String(previewFile.stored_name)} · ${formatFileSize(Number(previewFile.size_bytes))}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-hidden rounded-xl border bg-slate-100">
            {previewFile &&
              (String(previewFile.mime_type).startsWith("image/") ? (
                <ImagePreview
                  key={String(previewFile.id)}
                  src={`/api/material-files/${encodeURIComponent(String(previewFile.id))}`}
                  alt={String(previewFile.stored_name)}
                />
              ) : (
                <iframe
                  key={String(previewFile.id)}
                  src={`/api/material-files/${encodeURIComponent(String(previewFile.id))}`}
                  title={`预览 ${String(previewFile.stored_name)}`}
                  className="h-full w-full bg-white"
                />
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <OrderDetailClosureDialog
        activeDialog={dialog}
        closureCheck={data.closureCheck}
        closure={closure}
        onClosureChange={setClosure}
        canReadFinance={can("finance.read")}
        canOverride={can("orders.override")}
        loading={loading}
        message={message}
        onClose={() => setDialog(null)}
        onSave={saveClosure}
      />

      <OrderDetailFinanceDialogs
        activeDialog={dialog}
        message={message}
        currencies={currencies.rows}
        currenciesLoading={currencies.loading}
        editingCashId={editingCashId}
        cash={cash}
        matchingPlans={matchingPlans}
        cashValuesValid={cashValuesValid}
        onCashChange={setCash}
        onCashValueChange={changeCashValue}
        onCalculatedCashFieldChange={setCalculatedCashField}
        onCashCurrencyChange={changeCashCurrency}
        onCloseCash={() => {
          setDialog(null);
          setEditingCashId("");
        }}
        onSaveCash={saveCashEntry}
        editingPlanId={editingPlanId}
        plan={plan}
        onPlanChange={setPlan}
        onClosePlan={() => {
          setDialog(null);
          setEditingPlanId("");
        }}
        onSavePlan={savePlan}
      />

      <OrderDetailPeopleDialogs
        activeDialog={dialog}
        applicants={data.applicants}
        editingMaterialId={editingMaterialId}
        material={material}
        onMaterialChange={setMaterial}
        onCloseMaterial={() => {
          setDialog(null);
          setEditingMaterialId("");
        }}
        onSaveMaterial={saveMaterial}
        editingApplicantId={editingApplicantId}
        applicant={applicant}
        onApplicantChange={setApplicant}
        onCloseApplicant={() => {
          setDialog(null);
          setEditingApplicantId("");
        }}
        onSaveApplicant={saveApplicant}
        mrzReview={mrzReview}
        onMrzReviewChange={setMrzReview}
        onCloseMrz={() => {
          setDialog(null);
          setMrzReview(null);
        }}
        onConfirmMrz={confirmMrzReview}
        message={message}
      />
      <OrderDetailWorkflowDialogs
        activeDialog={dialog}
        message={message}
        progress={progress}
        onProgressChange={setProgress}
        onCloseProgress={() => setDialog(null)}
        onSaveProgress={saveProgress}
        editingStepId={editingStepId}
        step={step}
        onStepChange={setStep}
        onCloseStep={() => {
          setDialog(null);
          setEditingStepId("");
        }}
        onSaveStep={saveStep}
        editingTaskId={editingTaskId}
        task={task}
        onTaskChange={setTask}
        assignableUsers={data.assignableUsers}
        taskRelatedItems={taskRelatedItems}
        onCloseTask={() => {
          setDialog(null);
          setEditingTaskId("");
        }}
        onSaveTask={saveTask}
      />
    </>
  );
}
