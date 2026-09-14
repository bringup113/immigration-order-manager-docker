/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Library,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CurrencySelect,
  type CurrencyOption,
} from "@/components/currency-select";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { ProjectPackageActions } from "@/components/project-package-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/amount";
import { usePermissions } from "@/lib/use-permissions";

type Row = Record<string, unknown>;
type Data = {
  project: Row;
  steps: Row[];
  plans: Row[];
  materials: Row[];
  channels: Row[];
  projectChannels: Row[];
  currencies: CurrencyOption[];
};
type CatalogRow = {
  id: string;
  name: string;
  category: string | null;
  default_scope: string;
  default_required: number;
  description: string | null;
  active: number;
};
type CatalogChoice = { scope: string; required: boolean };
type DialogType = "channel" | "step" | "plan" | "material" | "catalog" | null;
type RemoveTarget = {
  type: "step" | "plan" | "material";
  id: string;
  title: string;
};
const planLabels: Record<string, string> = {
  RECEIVABLE: "订单应收",
  PAYABLE: "订单应付",
};
const materialScopeLabels: Record<string, string> = {
  COMMON: "合同与付款",
  MAIN: "仅主申请人",
  ALL: "每位申请人",
  DEPENDENT: "每位附属申请人",
};

export default function ProjectDetail() {
  const id = String(useParams().id);
  const can = usePermissions();
  const canEdit = can("projects.write");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<DialogType>(null);
  const [editingStepId, setEditingStepId] = useState("");
  const [editingPlanId, setEditingPlanId] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState("");
  const [form, setForm] = useState({
    name: "",
    country: "",
    receivableCurrency: "USD",
    providerCurrency: "USD",
    defaultChannelId: "",
    status: "ACTIVE",
    notes: "",
  });
  const [channel, setChannel] = useState({ channelId: "", isDefault: false });
  const [step, setStep] = useState({
    name: "",
    dueDays: "",
    required: true,
    notes: "",
  });
  const [plan, setPlan] = useState({
    planType: "RECEIVABLE",
    name: "",
    currency: "USD",
    amount: "",
    dueDays: "",
    notes: "",
  });
  const [material, setMaterial] = useState({
    name: "",
    scope: "ALL",
    required: true,
    notes: "",
  });
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([]);
  const [catalogChoices, setCatalogChoices] = useState<
    Record<string, CatalogChoice>
  >({});
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [projectDeactivateOpen, setProjectDeactivateOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取失败");
      setData(result);
      const project = result.project;
      setForm({
        name: String(project.name),
        country: String(project.country),
        receivableCurrency: String(project.default_receivable_currency),
        providerCurrency: String(project.provider_currency),
        defaultChannelId: String(project.default_channel_id || ""),
        status: String(project.status),
        notes: String(project.notes || ""),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: unknown) {
    setMessage("");
    const response = await fetch(`/api/projects/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(payload as Record<string, unknown>),
        expectedVersion: Number(data?.project.version || 1),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) await load();
      throw new Error(result.error || "保存失败");
    }
    await load();
  }

  async function run(payload: unknown, success = "已保存。") {
    try {
      await act(payload);
      setDialog(null);
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    }
  }

  function saveProject() {
    if (
      String(data?.project.status) === "ACTIVE" &&
      form.status === "INACTIVE"
    ) {
      setMessage("");
      setProjectDeactivateOpen(true);
      return;
    }
    void run(
      { action: "update", ...form },
      "项目资料已保存，新版本只影响之后创建的订单。",
    );
  }

  async function confirmProjectDeactivate() {
    setConfirming(true);
    try {
      await act({ action: "update", ...form });
      setProjectDeactivateOpen(false);
      setMessage("项目已停用；已有订单不受影响。");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "停用失败");
    } finally {
      setConfirming(false);
    }
  }

  async function confirmRemoveTemplate() {
    if (!removeTarget) return;
    setConfirming(true);
    setMessage("");
    try {
      await act({
        action: "removeTemplate",
        type: removeTarget.type,
        templateId: removeTarget.id,
      });
      setRemoveTarget(null);
      setMessage(`${removeTarget.title}已从项目模板删除；已有订单不受影响。`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setConfirming(false);
    }
  }

  function addPlan() {
    setEditingPlanId("");
    setPlan({
      planType: "RECEIVABLE",
      name: "",
      currency: form.receivableCurrency || "USD",
      amount: "",
      dueDays: "",
      notes: "",
    });
    setDialog("plan");
  }

  function editPlan(row: Row) {
    setEditingPlanId(String(row.id));
    setPlan({
      planType: String(row.plan_type),
      name: String(row.name),
      currency: String(row.currency),
      amount: String(Number(row.amount_minor || 0) / 100),
      dueDays: row.due_days === null ? "" : String(row.due_days),
      notes: String(row.notes || ""),
    });
    setDialog("plan");
  }

  function addStep() {
    setEditingStepId("");
    setStep({ name: "", dueDays: "", required: true, notes: "" });
    setDialog("step");
  }

  function editStep(row: Row) {
    setEditingStepId(String(row.id));
    setStep({
      name: String(row.name),
      dueDays: row.due_days === null ? "" : String(row.due_days),
      required: Boolean(row.required),
      notes: String(row.notes || ""),
    });
    setDialog("step");
  }

  function addMaterial() {
    setEditingMaterialId("");
    setMaterial({ name: "", scope: "ALL", required: true, notes: "" });
    setDialog("material");
  }

  function editMaterial(row: Row) {
    setEditingMaterialId(String(row.id));
    setMaterial({
      name: String(row.name),
      scope: String(row.scope || "ALL"),
      required: Boolean(row.required),
      notes: String(row.notes || ""),
    });
    setDialog("material");
  }

  async function openCatalog() {
    setDialog("catalog");
    setCatalogLoading(true);
    setCatalogError("");
    setCatalogQuery("");
    setCatalogChoices({});
    try {
      const response = await fetch("/api/material-catalog", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "读取材料库失败");
      setCatalogRows(
        (result as CatalogRow[]).filter((row) => Boolean(row.active)),
      );
    } catch (reason) {
      setCatalogError(
        reason instanceof Error ? reason.message : "读取材料库失败",
      );
    } finally {
      setCatalogLoading(false);
    }
  }

  function toggleCatalog(row: CatalogRow, checked: boolean) {
    setCatalogChoices((current) => {
      if (!checked) {
        const next = { ...current };
        delete next[row.id];
        return next;
      }
      return {
        ...current,
        [row.id]: {
          scope: row.default_scope || "ALL",
          required: Boolean(row.default_required),
        },
      };
    });
  }

  async function importCatalog() {
    const items = Object.entries(catalogChoices).map(([catalogId, choice]) => ({
      catalogId,
      ...choice,
    }));
    await run(
      { action: "importMaterials", items },
      `已从材料库添加 ${items.length} 项；只影响之后创建的订单。`,
    );
  }

  if (error)
    return (
      <AppShell>
        <ErrorState message={error} />
      </AppShell>
    );
  if (loading || !data)
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  const linkedIds = new Set(
    data.projectChannels.map((row) => String(row.channel_id)),
  );
  const unlinkedChannels = data.channels.filter(
    (row) => !linkedIds.has(String(row.id)),
  );
  return (
    <AppShell>
      <PageHeader
        eyebrow={`项目模板 · V${String(data.project.revision_no)}`}
        title={String(data.project.name)}
        description="项目只保存可复用模板；创建订单时复制，订单之后可独立调整"
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/projects">
                <ArrowLeft size={16} /> 返回
              </Link>
            </Button>
            <ProjectPackageActions projectId={id} />
            {canEdit && (
              <Button onClick={saveProject} className="bg-[#0f766e]">
                <Save size={16} /> 保存项目
              </Button>
            )}
          </div>
        }
      />
      {message && (
        <div
          className={`mb-4 rounded-xl border p-4 text-sm ${message.includes("失败") || message.includes("请") ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {message}
        </div>
      )}
      <Tabs defaultValue="base" className="gap-5">
        <div className="panel detail-tabs-nav overflow-x-auto overflow-y-hidden px-4 md:overflow-visible">
          <TabsList className="detail-tabs-list grid w-full min-w-[650px] grid-cols-5 md:min-w-0">
            <TabsTrigger className="tab-trigger" value="base">
              基本信息
            </TabsTrigger>
            <TabsTrigger className="tab-trigger" value="channels">
              合作渠道
            </TabsTrigger>
            <TabsTrigger className="tab-trigger" value="steps">
              办理流程
            </TabsTrigger>
            <TabsTrigger className="tab-trigger" value="plans">
              收付款方案
            </TabsTrigger>
            <TabsTrigger className="tab-trigger" value="materials">
              材料清单
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="base">
          <section className="panel p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="项目名称">
                <Input
                  disabled={!canEdit}
                  className="mt-2"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Field>
              <Field label="办理国家/地区">
                <Input
                  disabled={!canEdit}
                  className="mt-2"
                  value={form.country}
                  onChange={(event) =>
                    setForm({ ...form, country: event.target.value })
                  }
                />
              </Field>
              <Field label="默认应收币种">
                <CurrencySelect
                  disabled={!canEdit}
                  value={form.receivableCurrency}
                  onChange={(receivableCurrency) =>
                    setForm({ ...form, receivableCurrency })
                  }
                  currencies={data.currencies}
                />
              </Field>
              <Field label="默认项目方币种">
                <CurrencySelect
                  disabled={!canEdit}
                  value={form.providerCurrency}
                  onChange={(providerCurrency) =>
                    setForm({ ...form, providerCurrency })
                  }
                  currencies={data.currencies}
                />
              </Field>
              <Field label="项目状态">
                <Choose
                  disabled={!canEdit}
                  value={form.status}
                  onChange={(status) => setForm({ ...form, status })}
                  items={[
                    ["ACTIVE", "启用"],
                    ["INACTIVE", "停用"],
                  ]}
                />
              </Field>
              <Field label="默认渠道">
                <Choose
                  disabled={!canEdit}
                  value={form.defaultChannelId || "NONE"}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      defaultChannelId: value === "NONE" ? "" : value,
                    })
                  }
                  items={[
                    ["NONE", "暂不设置"],
                    ...data.projectChannels.map((row) => [
                      String(row.channel_id),
                      String(row.name),
                    ]),
                  ]}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="项目说明">
                  <Textarea
                    disabled={!canEdit}
                    className="mt-2"
                    value={form.notes}
                    onChange={(event) =>
                      setForm({ ...form, notes: event.target.value })
                    }
                  />
                </Field>
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="channels">
          <TemplatePanel
            editable={canEdit}
            title="合作渠道"
            note="一个项目可以对应多家渠道；可以直接切换或清空默认渠道，具体订单的每个应付阶段仍可另行选择。"
            onAdd={() => setDialog("channel")}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.projectChannels.map((row) => (
                <div key={String(row.id)} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <b>{String(row.name)}</b>
                    {Boolean(row.is_default) && (
                      <Badge className="status teal">默认</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    结算币种 {String(row.settlement_currency)}
                  </p>
                  {canEdit && (
                    <div className="mt-4 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          run(
                            {
                              action: "defaultChannel",
                              channelId: row.is_default ? "" : row.channel_id,
                            },
                            row.is_default
                              ? "已清空项目默认渠道。"
                              : `已将 ${String(row.name)} 设为默认渠道。`,
                          )
                        }
                      >
                        {row.is_default ? "取消默认" : "设为默认"}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TemplatePanel>
        </TabsContent>

        <TabsContent value="steps">
          <TemplatePanel
            editable={canEdit}
            title="默认办理流程"
            note="可用箭头调整先后顺序；新订单复制最新模板，已创建订单保持原流程。"
            onAdd={addStep}
          >
            <div className="space-y-3">
              {data.steps.map((row, index) => (
                <TemplateRow
                  key={String(row.id)}
                  index={index + 1}
                  title={String(row.name)}
                  meta={`${Boolean(row.required) ? "必办" : "选办"} · 签约后 ${row.due_days ?? "—"} 天`}
                  onMoveUp={
                    canEdit && index > 0
                      ? () =>
                          run(
                            {
                              action: "moveTemplate",
                              type: "step",
                              templateId: row.id,
                              direction: "UP",
                            },
                            "流程顺序已调整。",
                          )
                      : undefined
                  }
                  onMoveDown={
                    canEdit && index < data.steps.length - 1
                      ? () =>
                          run(
                            {
                              action: "moveTemplate",
                              type: "step",
                              templateId: row.id,
                              direction: "DOWN",
                            },
                            "流程顺序已调整。",
                          )
                      : undefined
                  }
                  onEdit={canEdit ? () => editStep(row) : undefined}
                  onRemove={
                    canEdit
                      ? () => {
                          setMessage("");
                          setRemoveTarget({
                            type: "step",
                            id: String(row.id),
                            title: `流程“${String(row.name)}”`,
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </TemplatePanel>
        </TabsContent>

        <TabsContent value="plans">
          <TemplatePanel
            editable={canEdit}
            title="默认收付款方案"
            note="这里只设置阶段、币种、金额和日期；应付阶段的新订单会统一继承项目默认渠道。"
            onAdd={addPlan}
          >
            <div className="space-y-3">
              {data.plans.map((row) => {
                const group = data.plans.filter(
                  (item) => item.plan_type === row.plan_type,
                );
                const index = group.findIndex((item) => item.id === row.id);
                return (
                  <TemplateRow
                    key={String(row.id)}
                    index={index + 1}
                    title={`${planLabels[String(row.plan_type)]} · ${String(row.name)}`}
                    meta={`${formatMoney(String(row.currency), row.amount_minor)} · 签约后 ${row.due_days ?? "—"} 天`}
                    onMoveUp={
                      canEdit && index > 0
                        ? () =>
                            run(
                              {
                                action: "moveTemplate",
                                type: "plan",
                                templateId: row.id,
                                direction: "UP",
                              },
                              "收付款顺序已调整。",
                            )
                        : undefined
                    }
                    onMoveDown={
                      canEdit && index < group.length - 1
                        ? () =>
                            run(
                              {
                                action: "moveTemplate",
                                type: "plan",
                                templateId: row.id,
                                direction: "DOWN",
                              },
                              "收付款顺序已调整。",
                            )
                        : undefined
                    }
                    onEdit={canEdit ? () => editPlan(row) : undefined}
                    onRemove={
                      canEdit
                        ? () => {
                            setMessage("");
                            setRemoveTarget({
                              type: "plan",
                              id: String(row.id),
                              title: `收付款阶段“${String(row.name)}”`,
                            });
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </TemplatePanel>
        </TabsContent>

        <TabsContent value="materials">
          <TemplatePanel
            editable={canEdit}
            title="默认材料清单"
            note="从材料库批量选择后可逐项调整；新建订单时按实际申请人展开，已创建订单保持原快照。"
            onAdd={addMaterial}
            addLabel="自定义材料"
            extraAction={
              canEdit && can("material_catalog.read") ? (
                <Button
                  onClick={() => void openCatalog()}
                  className="bg-[#0f766e]"
                >
                  <Library size={16} /> 从材料库选择
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              {data.materials.map((row, index) => (
                <TemplateRow
                  key={String(row.id)}
                  index={index + 1}
                  title={String(row.name)}
                  meta={`${materialScopeLabels[String(row.scope || "ALL")]} · ${Boolean(row.required) ? "必需材料" : "可选材料"}`}
                  onEdit={canEdit ? () => editMaterial(row) : undefined}
                  onRemove={
                    canEdit
                      ? () => {
                          setMessage("");
                          setRemoveTarget({
                            type: "material",
                            id: String(row.id),
                            title: `材料“${String(row.name)}”`,
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </TemplatePanel>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={projectDeactivateOpen}
        onOpenChange={setProjectDeactivateOpen}
        title="停用项目模板"
        description={
          <>
            确定停用“{String(data.project.name)}
            ”吗？停用后不能再用它创建新订单，但已有订单仍保留自己的项目快照。
          </>
        }
        confirmLabel="确认停用"
        pending={confirming}
        pendingLabel="正在停用…"
        error={message || undefined}
        onConfirm={() => void confirmProjectDeactivate()}
      />
      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`删除${removeTarget?.type === "step" ? "流程" : removeTarget?.type === "plan" ? "收付款阶段" : "材料"}`}
        description={
          <>
            确定删除{removeTarget?.title}
            吗？删除只影响以后创建的订单，已有订单不受影响。
          </>
        }
        confirmLabel="确认删除"
        pending={confirming}
        pendingLabel="正在删除…"
        error={message || undefined}
        onConfirm={() => void confirmRemoveTemplate()}
      />

      <Dialog
        open={dialog === "channel"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关联合作渠道</DialogTitle>
            <DialogDescription>
              项目统一维护可用渠道；默认渠道会带入以后创建的订单。
            </DialogDescription>
          </DialogHeader>
          <Field label="渠道商">
            <Choose
              value={channel.channelId}
              onChange={(channelId) => setChannel({ ...channel, channelId })}
              items={unlinkedChannels.map((row) => [
                String(row.id),
                String(row.name),
              ])}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={channel.isDefault}
              onCheckedChange={(checked) =>
                setChannel({ ...channel, isDefault: Boolean(checked) })
              }
            />{" "}
            设为项目默认渠道
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              disabled={!channel.channelId}
              onClick={() =>
                run({ action: "channel", ...channel }, "合作渠道已更新。")
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "step"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setEditingStepId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStepId ? "修改流程步骤" : "新增流程步骤"}
            </DialogTitle>
            <DialogDescription>
              {editingStepId
                ? "修改只影响以后创建的订单，现有订单流程不会改变。"
                : "天数从订单签约日开始计算。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="步骤名称">
              <Input
                className="mt-2"
                value={step.name}
                onChange={(event) =>
                  setStep({ ...step, name: event.target.value })
                }
              />
            </Field>
            <Field label="签约后几天到期">
              <Input
                className="mt-2"
                type="number"
                min="0"
                value={step.dueDays}
                onChange={(event) =>
                  setStep({ ...step, dueDays: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={step.required}
                onCheckedChange={(checked) =>
                  setStep({ ...step, required: Boolean(checked) })
                }
              />{" "}
              必办步骤
            </label>
            <div className="sm:col-span-2">
              <Field label="说明">
                <Textarea
                  className="mt-2"
                  value={step.notes}
                  onChange={(event) =>
                    setStep({ ...step, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
                setEditingStepId("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={!step.name.trim()}
              onClick={() =>
                run(
                  {
                    action: editingStepId ? "updateStep" : "step",
                    templateId: editingStepId || undefined,
                    ...step,
                  },
                  editingStepId
                    ? "流程步骤已修改，仅影响之后创建的订单。"
                    : "流程模板已更新。",
                )
              }
            >
              {editingStepId ? "保存修改" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "plan"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setEditingPlanId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingPlanId ? "修改收付款阶段" : "新增收付款阶段"}
            </DialogTitle>
            <DialogDescription>
              {editingPlanId
                ? "修改只影响以后创建的订单，现有订单仍保留创建时的方案快照。"
                : "应付可以是项目方费用、佣金或其他成本，直接用阶段名称说明。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="类型">
              <Choose
                value={plan.planType}
                onChange={(planType) => setPlan({ ...plan, planType })}
                items={Object.entries(planLabels)}
              />
            </Field>
            <Field label="阶段名称">
              <Input
                className="mt-2"
                value={plan.name}
                onChange={(event) =>
                  setPlan({ ...plan, name: event.target.value })
                }
              />
            </Field>
            <Field label="币种">
              <CurrencySelect
                value={plan.currency}
                onChange={(currency) => setPlan({ ...plan, currency })}
                currencies={data.currencies}
              />
            </Field>
            <Field label="默认金额">
              <Input
                className="mt-2"
                type="number"
                min="0"
                value={plan.amount}
                onChange={(event) =>
                  setPlan({ ...plan, amount: event.target.value })
                }
              />
            </Field>
            <Field label="签约后几天到期">
              <Input
                className="mt-2"
                type="number"
                min="0"
                value={plan.dueDays}
                onChange={(event) =>
                  setPlan({ ...plan, dueDays: event.target.value })
                }
              />
            </Field>
            <div className="self-end rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              {plan.planType === "PAYABLE"
                ? "渠道由项目统一维护，新订单自动使用项目默认渠道。"
                : "订单应收不关联渠道。"}
            </div>
            <div className="sm:col-span-2">
              <Field label="备注">
                <Textarea
                  className="mt-2"
                  value={plan.notes}
                  onChange={(event) =>
                    setPlan({ ...plan, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
                setEditingPlanId("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={!plan.name.trim()}
              onClick={() =>
                run(
                  {
                    action: editingPlanId ? "updatePlan" : "plan",
                    templateId: editingPlanId || undefined,
                    ...plan,
                  },
                  editingPlanId
                    ? "收付款方案已修改，仅影响之后创建的订单。"
                    : "收付款模板已更新。",
                )
              }
            >
              {editingPlanId ? "保存修改" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "material"}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setEditingMaterialId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMaterialId ? "修改材料模板" : "新增材料"}
            </DialogTitle>
            <DialogDescription>
              {editingMaterialId
                ? "修改只影响以后创建的订单；现有订单的材料和文件不变。"
                : "这里只定义材料要求，文件在具体订单中上传。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="材料名称">
              <Input
                className="mt-2"
                value={material.name}
                onChange={(event) =>
                  setMaterial({ ...material, name: event.target.value })
                }
              />
            </Field>
            <Field label="适用范围">
              <Choose
                value={material.scope}
                onChange={(scope) => setMaterial({ ...material, scope })}
                items={Object.entries(materialScopeLabels)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={material.required}
                onCheckedChange={(checked) =>
                  setMaterial({ ...material, required: Boolean(checked) })
                }
              />{" "}
              必需材料
            </label>
            <div className="sm:col-span-2">
              <Field label="说明">
                <Textarea
                  className="mt-2"
                  value={material.notes}
                  onChange={(event) =>
                    setMaterial({ ...material, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialog(null);
                setEditingMaterialId("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={!material.name.trim()}
              onClick={() =>
                run(
                  {
                    action: editingMaterialId ? "updateMaterial" : "material",
                    templateId: editingMaterialId || undefined,
                    ...material,
                  },
                  editingMaterialId
                    ? "材料模板已修改，仅影响之后创建的订单。"
                    : "材料模板已更新。",
                )
              }
            >
              {editingMaterialId ? "保存修改" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "catalog"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>从材料库选择</DialogTitle>
            <DialogDescription>
              可一次选择多项，并在加入项目之前覆盖默认适用范围和是否必需。
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <Input
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              className="pl-10"
              placeholder="搜索材料名称、分类或说明"
            />
          </div>
          <div className="max-h-[54vh] space-y-2 overflow-y-auto pr-1">
            {catalogLoading ? (
              <LoadingState />
            ) : catalogError ? (
              <ErrorState message={catalogError} />
            ) : (
              catalogRows
                .filter((row) =>
                  [row.name, row.category, row.description]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(catalogQuery.trim().toLowerCase()),
                )
                .map((row) => {
                  const choice = catalogChoices[row.id];
                  const alreadyUsed = data.materials.some(
                    (materialRow) =>
                      String(materialRow.name || "")
                        .trim()
                        .toLowerCase() === row.name.trim().toLowerCase(),
                  );
                  return (
                    <div
                      key={row.id}
                      className={`rounded-xl border p-3 ${alreadyUsed ? "bg-slate-50 opacity-60" : choice ? "border-teal-300 bg-teal-50/40" : ""}`}
                    >
                      <div className="grid items-center gap-3 md:grid-cols-[minmax(180px,1fr)_180px_120px]">
                        <label className="flex min-w-0 items-start gap-3">
                          <Checkbox
                            className="mt-0.5"
                            disabled={alreadyUsed}
                            checked={Boolean(choice) || alreadyUsed}
                            onCheckedChange={(checked) =>
                              toggleCatalog(row, Boolean(checked))
                            }
                          />
                          <span className="min-w-0">
                            <b className="block truncate text-sm">{row.name}</b>
                            <span className="mt-1 block truncate text-xs text-slate-500">
                              {alreadyUsed
                                ? "已在当前项目中"
                                : [row.category, row.description]
                                    .filter(Boolean)
                                    .join(" · ") || "未分类"}
                            </span>
                          </span>
                        </label>
                        <Choose
                          value={choice?.scope || row.default_scope}
                          onChange={(scope) =>
                            setCatalogChoices((current) => ({
                              ...current,
                              [row.id]: {
                                ...(current[row.id] || {
                                  required: Boolean(row.default_required),
                                }),
                                scope,
                              },
                            }))
                          }
                          items={Object.entries(materialScopeLabels)}
                          disabled={!choice || alreadyUsed}
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            disabled={!choice || alreadyUsed}
                            checked={
                              choice?.required ?? Boolean(row.default_required)
                            }
                            onCheckedChange={(checked) =>
                              setCatalogChoices((current) => ({
                                ...current,
                                [row.id]: {
                                  ...(current[row.id] || {
                                    scope: row.default_scope,
                                  }),
                                  required: Boolean(checked),
                                },
                              }))
                            }
                          />{" "}
                          必需材料
                        </label>
                      </div>
                    </div>
                  );
                })
            )}
            {!catalogLoading && !catalogError && catalogRows.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-500">
                材料库暂无启用材料，请先到“材料管理”新增。
              </p>
            )}
          </div>
          <DialogFooter>
            <span className="mr-auto self-center text-sm text-slate-500">
              已选择 {Object.keys(catalogChoices).length} 项
            </span>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              className="bg-[#0f766e]"
              disabled={!Object.keys(catalogChoices).length}
              onClick={() => void importCatalog()}
            >
              加入项目清单
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function TemplatePanel({
  title,
  note,
  onAdd,
  addLabel = "新增",
  extraAction,
  editable,
  children,
}: {
  title: string;
  note: string;
  onAdd: () => void;
  addLabel?: string;
  extraAction?: React.ReactNode;
  editable: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
        </div>
        {editable && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={onAdd}>
              <Plus size={16} /> {addLabel}
            </Button>
            {extraAction}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
function TemplateRow({
  index,
  title,
  meta,
  onMoveUp,
  onMoveDown,
  onEdit,
  onRemove,
}: {
  index: number;
  title: string;
  meta: string;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <b className="text-sm">{title}</b>
        <p className="mt-1 text-xs text-slate-500">{meta}</p>
      </div>
      {(onMoveUp || onMoveDown) && (
        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            disabled={!onMoveUp}
            onClick={onMoveUp}
            title="上移"
            aria-label={`上移：${title}`}
          >
            <ArrowUp size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!onMoveDown}
            onClick={onMoveDown}
            title="下移"
            aria-label={`下移：${title}`}
          >
            <ArrowDown size={15} />
          </Button>
        </div>
      )}
      {onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil size={15} /> 修改
        </Button>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          title="删除"
          aria-label={`删除：${title}`}
        >
          <Trash2 size={16} />
        </Button>
      )}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Choose({
  value,
  onChange,
  items,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  items: string[][];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="mt-2 w-full">
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent>
        {items.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
