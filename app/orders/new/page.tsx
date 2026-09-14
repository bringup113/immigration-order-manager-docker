"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Save,
  ScanLine,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  CurrencySelect,
  type CurrencyOption,
} from "@/components/currency-select";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/use-api";
import {
  describeMrzChecksum,
  emptyPassportIdentity,
  recognizePassportFile,
  type PassportIdentity,
  type PassportMrzCapture,
} from "@/lib/passport-mrz";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Item = { id: string; name: string; [key: string]: unknown };
type Applicant = PassportIdentity & {
  clientKey: string;
  applicantType: "MAIN" | "DEPENDENT";
  relationship: string;
  passportFile?: File;
  mrz?: PassportMrzCapture;
  recognizing?: boolean;
  notice?: string;
};
type Step = {
  templateId?: string;
  name: string;
  required: boolean;
  dueDate: string;
  notes?: string;
};
type PlanType = "RECEIVABLE" | "PAYABLE";
type Plan = {
  templateId?: string;
  planType: PlanType;
  name: string;
  currency: string;
  amount: string;
  dueDate: string;
  channelId: string;
  notes?: string;
};
type MaterialScope = "COMMON" | "MAIN" | "ALL" | "DEPENDENT";
type Material = {
  templateId?: string;
  name: string;
  scope: MaterialScope;
  required: boolean;
  expectedDate: string;
  notes?: string;
};
type Catalogs = {
  agents: (Item & { system_managed: number | boolean })[];
  projects: (Item & {
    code: string;
    country: string;
    default_receivable_currency: string;
    provider_currency: string;
    default_channel_id: string | null;
    revision_no: number;
  })[];
  channels: Item[];
  projectChannels: {
    project_id: string;
    channel_id: string;
    is_default: number;
  }[];
  projectSteps: {
    id: string;
    project_id: string;
    name: string;
    required: number;
    due_days: number | null;
    notes: string | null;
  }[];
  projectPlans: {
    id: string;
    project_id: string;
    plan_type: PlanType;
    name: string;
    currency: string;
    amount_minor: number;
    due_days: number | null;
    notes: string | null;
  }[];
  projectMaterials: {
    id: string;
    project_id: string;
    name: string;
    scope: MaterialScope;
    required: number;
    notes: string | null;
  }[];
  rates: CurrencyOption[];
  owners: { id: string; display_name: string; username: string }[];
  currentUserId: string;
  canAssignOrders: boolean;
};

function newClientKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `app-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
const newApplicant = (
  applicantType: Applicant["applicantType"],
  clientKey = newClientKey(),
): Applicant => ({
  clientKey,
  applicantType,
  relationship: applicantType === "MAIN" ? "" : "配偶",
  ...emptyPassportIdentity(),
});
const planLabel: Record<PlanType, string> = {
  RECEIVABLE: "订单应收",
  PAYABLE: "订单应付",
};
const planTone: Record<PlanType, string> = {
  RECEIVABLE: "teal",
  PAYABLE: "violet",
};
const materialScopeLabels: Record<MaterialScope, string> = {
  COMMON: "合同与付款",
  MAIN: "仅主申请人",
  ALL: "每位申请人",
  DEPENDENT: "每位附属申请人",
};

function dateAfter(date: string, days: number | null) {
  if (days === null) return "";
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export default function NewOrderPage() {
  const router = useRouter();
  const [catalogs, setCatalogs] = useState<Catalogs | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateReady, setTemplateReady] = useState(false);
  const templateRequest = useRef(0);
  const numberRequest = useRef(0);
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [signedAt, setSignedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [applicants, setApplicants] = useState<Applicant[]>(() => [
    newApplicant("MAIN", "main"),
  ]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [notes, setNotes] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");

  useEffect(() => {
    fetch("/api/data/catalogs", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取失败");
        setCatalogs(data);
        setOwnerUserId(data.currentUserId || "");
        setAgentId(
          data.agents.find((item: { system_managed: number | boolean }) =>
            Boolean(item.system_managed),
          )?.id ||
            data.agents[0]?.id ||
            "",
        );
      })
      .catch((reason) => setLoadError(reason.message));
  }, []);

  const project = catalogs?.projects.find((item) => item.id === projectId);
  const projectChannelIds =
    catalogs?.projectChannels
      .filter((row) => row.project_id === projectId)
      .map((row) => row.channel_id) ?? [];
  const projectChannels =
    catalogs?.channels.filter((item) => projectChannelIds.includes(item.id)) ??
    [];

  async function refreshOrderNumber(selectedProjectId: string, date: string) {
    const requestId = ++numberRequest.current;
    if (!selectedProjectId || !date) {
      setOrderNo("");
      return;
    }
    try {
      const response = await fetch(
        `/api/data/order-number?projectId=${encodeURIComponent(selectedProjectId)}&signedAt=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "订单编号生成失败");
      if (requestId !== numberRequest.current) return;
      setOrderNo(result.orderNo);
      setMessage("");
    } catch (reason) {
      if (requestId !== numberRequest.current) return;
      setOrderNo("");
      setMessage(reason instanceof Error ? reason.message : "订单编号生成失败");
    }
  }

  async function chooseProject(value: string) {
    if (!catalogs) return;
    const picked = catalogs.projects.find((item) => item.id === value);
    setProjectId(value);
    setOrderNo("");
    numberRequest.current += 1;
    if (!picked) return;
    const requestId = ++templateRequest.current;
    setTemplateLoading(true);
    setTemplateReady(false);
    setSteps([]);
    setPlans([]);
    setMaterials([]);
    let selected: Catalogs;
    try {
      const response = await fetch(
        `/api/data/catalogs?projectId=${encodeURIComponent(value)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "模板读取失败");
      if (requestId !== templateRequest.current) return;
      selected = { ...catalogs, ...result };
      setCatalogs(selected);
      setTemplateReady(true);
    } catch (error) {
      if (requestId === templateRequest.current)
        setMessage(error instanceof Error ? error.message : "模板读取失败");
      return;
    } finally {
      if (requestId === templateRequest.current) setTemplateLoading(false);
    }
    const defaultChannel = picked.default_channel_id || "";
    setSteps(
      selected.projectSteps
        .filter((row) => row.project_id === value)
        .map((row) => ({
          templateId: row.id,
          name: row.name,
          required: Boolean(row.required),
          dueDate: dateAfter(signedAt, row.due_days),
          notes: row.notes || "",
        })),
    );
    setPlans(
      selected.projectPlans
        .filter((row) => row.project_id === value)
        .map((row) => ({
          templateId: row.id,
          planType: row.plan_type,
          name: row.name,
          currency: row.currency,
          amount: row.amount_minor ? String(row.amount_minor / 100) : "",
          dueDate: dateAfter(signedAt, row.due_days),
          channelId: row.plan_type === "PAYABLE" ? defaultChannel : "",
          notes: row.notes || "",
        })),
    );
    setMaterials(
      selected.projectMaterials
        .filter((row) => row.project_id === value)
        .map((row) => ({
          templateId: row.id,
          name: row.name,
          scope: row.scope || "ALL",
          required: Boolean(row.required),
          expectedDate: "",
          notes: row.notes || "",
        })),
    );
    void refreshOrderNumber(value, signedAt);
  }

  function addPlan(planType: PlanType) {
    const currency =
      planType === "RECEIVABLE"
        ? project?.default_receivable_currency || "USD"
        : project?.provider_currency || "USD";
    const defaultChannel =
      planType === "PAYABLE" ? project?.default_channel_id || "" : "";
    setPlans([
      ...plans,
      {
        planType,
        name: `${planLabel[planType]}第 ${plans.filter((row) => row.planType === planType).length + 1} 期`,
        currency,
        amount: "",
        dueDate: "",
        channelId: defaultChannel,
      },
    ]);
  }

  function moveStep(index: number, direction: "UP" | "DOWN") {
    const target = index + (direction === "UP" ? -1 : 1);
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    setSteps(next);
  }

  function movePlan(index: number, direction: "UP" | "DOWN") {
    const groupIndexes = plans
      .map((item, itemIndex) =>
        item.planType === plans[index].planType ? itemIndex : -1,
      )
      .filter((itemIndex) => itemIndex >= 0);
    const position = groupIndexes.indexOf(index);
    const target = groupIndexes[position + (direction === "UP" ? -1 : 1)];
    if (target === undefined) return;
    const next = [...plans];
    [next[index], next[target]] = [next[target], next[index]];
    setPlans(next);
  }

  function updateApplicant(index: number, changes: Partial<Applicant>) {
    setApplicants((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...changes } : item,
      ),
    );
  }

  async function choosePassport(index: number, file?: File) {
    if (!file) return;
    updateApplicant(index, {
      passportFile: file,
      mrz: undefined,
      notice:
        file.type === "application/pdf" ? "正在读取 PDF 页面并识别 MRZ…" : "",
      recognizing: true,
    });
    try {
      const mrz = await recognizePassportFile(file);
      setApplicants((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                ...mrz.fields,
                name: item.name.trim() || mrz.fields.name,
                passportFile: file,
                mrz,
                recognizing: false,
                notice: `${mrz.sourcePage ? `已从 PDF 第 ${mrz.sourcePage} 页识别。` : "MRZ 已识别。"}${mrz.formatWarning ? ` ${mrz.formatWarning}` : mrz.valid ? "全部校验位通过，请确认资料后保存。" : "有校验位未通过，请逐项人工核对。"}`,
              }
            : item,
        ),
      );
    } catch (reason) {
      updateApplicant(index, {
        recognizing: false,
        notice:
          reason instanceof Error
            ? reason.message
            : "护照识别失败，请人工填写。",
      });
    }
  }

  const canSave = Boolean(
    templateReady &&
      !templateLoading &&
      projectId &&
      agentId &&
      orderNo.trim() &&
      signedAt &&
      applicants.length > 0 &&
      applicants.every(
        (item) =>
          item.name.trim() &&
          item.passportNo.trim() &&
          item.nationality.trim() &&
          item.birthDate &&
          item.passportExpiry &&
          item.passportFile &&
          !item.recognizing,
      ) &&
      plans.length > 0 &&
      plans.every((item) => item.name.trim() && Number(item.amount) > 0),
  );

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage("");
    let createdOrderNo = "";
    try {
      const submittedApplicants = applicants.map((item) => ({
        clientKey: item.clientKey,
        applicantType: item.applicantType,
        relationship: item.relationship,
        name: item.name,
        surname: item.surname,
        givenNames: item.givenNames,
        nationality: item.nationality,
        passportNo: item.passportNo,
        birthDate: item.birthDate,
        sex: item.sex,
        passportExpiry: item.passportExpiry,
        issuingCountry: item.issuingCountry,
        documentCode: item.documentCode,
        personalNumber: item.personalNumber,
      }));
      const result = await apiPost("orders", {
        projectId,
        agentId,
        ownerUserId,
        signedAt,
        applicants: submittedApplicants,
        steps,
        plans,
        materials,
        notes,
      });
      createdOrderNo = String(result.orderNo || "");
      for (const item of applicants) {
        const created = (
          result.applicants as {
            id: string;
            passportMaterialId: string;
            clientKey: string;
          }[]
        ).find((row) => row.clientKey === item.clientKey);
        if (!created || !item.passportFile)
          throw new Error(
            "订单已建立，但护照首页关联失败，请进入订单详情重新上传。",
          );
        const form = new FormData();
        form.set("orderNo", result.orderNo);
        form.set("materialId", created.passportMaterialId);
        form.set("file", item.passportFile);
        const uploadResponse = await fetch("/api/material-files", {
          method: "POST",
          body: form,
        });
        const uploadResult = await uploadResponse.json();
        if (!uploadResponse.ok)
          throw new Error(
            uploadResult.error ||
              "订单已建立，但护照首页上传失败，请进入订单详情重新上传。",
          );
        if (item.mrz) {
          const confirmResponse = await fetch(
            `/api/orders/${encodeURIComponent(result.orderNo)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "confirmMrz",
                applicantId: created.id,
                materialFileId: uploadResult.id,
                rawMrz: item.mrz.rawMrz,
                fields: submittedApplicants.find(
                  (row) => row.clientKey === item.clientKey,
                ),
              }),
            },
          );
          const confirmResult = await confirmResponse.json();
          if (!confirmResponse.ok)
            throw new Error(
              confirmResult.error ||
                "护照已经上传，但 MRZ 资料确认失败，请在订单详情中重新确认。",
            );
        }
      }
      router.push(`/orders/${result.orderNo}`);
    } catch (reason) {
      const errorMessage =
        reason instanceof Error ? reason.message : "保存失败";
      if (createdOrderNo) {
        setMessage(
          `${errorMessage} 订单草稿已经保留，正在进入详情页继续处理。`,
        );
        router.replace(`/orders/${createdOrderNo}?section=people`);
      } else {
        setMessage(errorMessage);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError)
    return (
      <AppShell>
        <ErrorState message={loadError} />
      </AppShell>
    );
  if (!catalogs)
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  const missing =
    catalogs.agents.length === 0 || catalogs.projects.length === 0;

  return (
    <AppShell>
      <PageHeader
        eyebrow="订单管理"
        title="新增订单"
        description="从项目模板建立独立订单副本，保存前可按实际情况修改"
        action={
          <Button asChild variant="outline">
            <Link href="/orders">
              <ArrowLeft size={16} /> 返回列表
            </Link>
          </Button>
        }
      />
      {missing && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          创建订单前，至少需要一个可用代理来源和一个已启用项目。
        </div>
      )}
      <div className="space-y-5">
        <Section
          title="1. 项目、代理与签约信息"
          note={
            project
              ? `将以项目模板 V${project.revision_no} 建立副本；应收计划合计即为本订单合同应收总额。`
              : "先选择项目，系统再带入流程、收付款和材料模板。"
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="办理项目">
              <Choose
                value={projectId}
                onChange={chooseProject}
                placeholder="选择项目"
                items={catalogs.projects.map((item) => [
                  item.id,
                  `${item.name} · ${item.country}`,
                ])}
              />
            </Field>
            <Field label="代理来源">
              <Choose
                value={agentId}
                onChange={setAgentId}
                placeholder="选择代理"
                items={catalogs.agents.map((item) => [item.id, item.name])}
              />
            </Field>
            <Field label="订单编号">
              <Input
                className="mt-2 bg-slate-50 font-mono"
                value={orderNo}
                readOnly
                placeholder="项目简称 + 日期 + 当日序号"
              />
            </Field>
            <Field label="签约日期">
              <Input
                className="mt-2"
                type="date"
                value={signedAt}
                onChange={(event) => {
                  const value = event.target.value;
                  setSignedAt(value);
                  void refreshOrderNumber(projectId, value);
                }}
              />
            </Field>
            {catalogs.canAssignOrders && (
              <Field label="订单负责人">
                <Choose
                  value={ownerUserId}
                  onChange={setOwnerUserId}
                  placeholder="选择负责人"
                  items={catalogs.owners.map((item) => [
                    item.id,
                    `${item.display_name} · ${item.username}`,
                  ])}
                />
              </Field>
            )}
          </div>
        </Section>

        <Section
          title="2. 申请人与护照资料"
          note="每位申请人必须上传护照首页。图片和 PDF 会提交到 MRZ 识别服务处理；系统显示姓名为空时会自动采用护照英文姓名。"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setApplicants((current) => [
                  ...current,
                  newApplicant("DEPENDENT"),
                ])
              }
            >
              <Plus size={15} /> 新增附属申请人
            </Button>
          }
        >
          <div className="space-y-4">
            {applicants.map((row, index) => (
              <article
                key={row.clientKey}
                className="rounded-2xl border border-slate-200 p-4 md:p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge
                    variant="outline"
                    className={`status ${index === 0 ? "teal" : "blue"}`}
                  >
                    {index === 0 ? "主申请人" : "附属申请人"}
                  </Badge>
                  {index > 0 && (
                    <Select
                      value={row.relationship}
                      onValueChange={(relationship) =>
                        updateApplicant(index, { relationship })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["配偶", "子女", "父母", "其他"].map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <label
                      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-white px-3 text-sm font-medium hover:bg-slate-50 ${row.recognizing ? "pointer-events-none opacity-60" : ""}`}
                    >
                      {row.recognizing ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : row.mrz ? (
                        <ScanLine size={16} />
                      ) : (
                        <Upload size={16} />
                      )}{" "}
                      {row.recognizing
                        ? "正在识别…"
                        : row.passportFile
                          ? "更换护照首页"
                          : "上传护照首页"}
                      <input
                        className="hidden"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          void choosePassport(index, file);
                        }}
                      />
                    </label>
                    {index > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-600"
                        onClick={() =>
                          setApplicants(
                            applicants.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                </div>
                {row.passportFile && (
                  <p className="mt-3 text-xs text-slate-500">
                    已选择：{row.passportFile.name}
                  </p>
                )}
                {row.notice && (
                  <div
                    className={`mt-3 flex gap-2 rounded-xl border px-3 py-2 text-xs ${row.mrz?.valid ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                  >
                    {row.mrz && <MrzChecksumHint capture={row.mrz} />}{" "}
                    {!row.mrz && <AlertTriangle size={15} />}
                    <span>{row.notice}</span>
                  </div>
                )}
                {row.mrz && <MrzReviewDetails capture={row.mrz} />}
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label="系统显示姓名 *">
                    <Input
                      className="mt-2"
                      value={row.name}
                      onChange={(event) =>
                        updateApplicant(index, { name: event.target.value })
                      }
                      placeholder="识别后自动填写，也可输入中文名"
                    />
                  </Field>
                  <Field label="护照姓">
                    <Input
                      className="mt-2 uppercase"
                      value={row.surname}
                      onChange={(event) =>
                        updateApplicant(index, {
                          surname: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="护照名">
                    <Input
                      className="mt-2 uppercase"
                      value={row.givenNames}
                      onChange={(event) =>
                        updateApplicant(index, {
                          givenNames: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="护照号码 *">
                    <Input
                      className="mt-2 uppercase"
                      value={row.passportNo}
                      onChange={(event) =>
                        updateApplicant(index, {
                          passportNo: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="国籍 *">
                    <Input
                      className="mt-2 uppercase"
                      value={row.nationality}
                      onChange={(event) =>
                        updateApplicant(index, {
                          nationality: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="出生日期 *">
                    <Input
                      className="mt-2"
                      type="date"
                      value={row.birthDate}
                      onChange={(event) =>
                        updateApplicant(index, {
                          birthDate: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="性别">
                    <Select
                      value={row.sex || "UNKNOWN"}
                      onValueChange={(sex) =>
                        updateApplicant(index, {
                          sex:
                            sex === "UNKNOWN" ? "" : (sex as Applicant["sex"]),
                        })
                      }
                    >
                      <SelectTrigger className="mt-2 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNKNOWN">未填写</SelectItem>
                        <SelectItem value="M">男</SelectItem>
                        <SelectItem value="F">女</SelectItem>
                        <SelectItem value="X">未指定</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="护照有效期 *">
                    <Input
                      className="mt-2"
                      type="date"
                      value={row.passportExpiry}
                      onChange={(event) =>
                        updateApplicant(index, {
                          passportExpiry: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="签发国家/地区">
                    <Input
                      className="mt-2 uppercase"
                      value={row.issuingCountry}
                      onChange={(event) =>
                        updateApplicant(index, {
                          issuingCountry: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="证件类型">
                    <Input
                      className="mt-2 uppercase"
                      value={row.documentCode}
                      onChange={(event) =>
                        updateApplicant(index, {
                          documentCode: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="个人号码/可选数据">
                    <Input
                      className="mt-2 uppercase"
                      value={row.personalNumber}
                      onChange={(event) =>
                        updateApplicant(index, {
                          personalNumber: event.target.value.toUpperCase(),
                        })
                      }
                    />
                  </Field>
                </div>
              </article>
            ))}
          </div>
        </Section>

        <Section
          title="3. 办理流程"
          note="这是该订单自己的步骤。可增加、删除、修改日期或用箭头调整顺序，不影响项目模板。"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSteps([
                  ...steps,
                  { name: "新增步骤", required: true, dueDate: "" },
                ])
              }
            >
              <Plus size={15} /> 增加步骤
            </Button>
          }
        >
          {steps.length === 0 ? (
            <Hint>
              该项目还没有流程模板；你可以现在添加订单步骤，也可以先回项目设置。
            </Hint>
          ) : (
            <div className="space-y-3">
              {steps.map((row, index) => (
                <div
                  key={`${row.templateId || "new"}-${index}`}
                  className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[54px_1fr_150px_110px_80px_44px]"
                >
                  <span className="grid size-9 place-items-center rounded-xl bg-slate-100 text-sm font-semibold">
                    {index + 1}
                  </span>
                  <Input
                    value={row.name}
                    onChange={(event) =>
                      setSteps(
                        steps.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <Input
                    type="date"
                    value={row.dueDate}
                    onChange={(event) =>
                      setSteps(
                        steps.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, dueDate: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={row.required}
                      onCheckedChange={(checked) =>
                        setSteps(
                          steps.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, required: Boolean(checked) }
                              : item,
                          ),
                        )
                      }
                    />{" "}
                    必办
                  </label>
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveStep(index, "UP")}
                      title="上移"
                      aria-label={`上移步骤：${row.name}`}
                    >
                      <ArrowUp size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, "DOWN")}
                      title="下移"
                      aria-label={`下移步骤：${row.name}`}
                    >
                      <ArrowDown size={15} />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setSteps(
                        steps.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="4. 订单收付款计划"
          note="应付计划默认带入项目的默认渠道；这张订单如有特殊情况，仍可单独调整。应收、应付各自在组内排序。"
          action={
            <div className="flex flex-wrap gap-2">
              {(["RECEIVABLE", "PAYABLE"] as PlanType[]).map((type) => (
                <Button
                  key={type}
                  variant="outline"
                  size="sm"
                  onClick={() => addPlan(type)}
                >
                  <Plus size={15} /> {planLabel[type]}
                </Button>
              ))}
            </div>
          }
        >
          {plans.length === 0 ? (
            <Hint>请至少添加一条应收或应付计划。</Hint>
          ) : (
            <div className="space-y-3">
              {plans.map((row, index) => {
                const group = plans.filter(
                  (item) => item.planType === row.planType,
                );
                const groupIndex = group.indexOf(row);
                return (
                  <div
                    key={`${row.templateId || "new"}-${index}`}
                    className="grid gap-3 rounded-xl border p-4 xl:grid-cols-[110px_1.4fr_105px_1fr_150px_1.2fr_80px_44px]"
                  >
                    <Badge
                      variant="outline"
                      className={`status self-center justify-center ${planTone[row.planType]}`}
                    >
                      {planLabel[row.planType]}
                    </Badge>
                    <Input
                      value={row.name}
                      onChange={(event) =>
                        setPlans(
                          plans.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="阶段名称"
                    />
                    <CurrencySelect
                      value={row.currency}
                      onChange={(currency) =>
                        setPlans(
                          plans.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, currency } : item,
                          ),
                        )
                      }
                      currencies={catalogs.rates}
                      compact
                    />
                    <Input
                      type="number"
                      min="0"
                      value={row.amount}
                      onChange={(event) =>
                        setPlans(
                          plans.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, amount: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="金额"
                    />
                    <Input
                      type="date"
                      value={row.dueDate}
                      onChange={(event) =>
                        setPlans(
                          plans.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, dueDate: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    {row.planType === "PAYABLE" ? (
                      <Choose
                        value={row.channelId || "NONE"}
                        onChange={(channelId) =>
                          setPlans(
                            plans.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    channelId:
                                      channelId === "NONE" ? "" : channelId,
                                  }
                                : item,
                            ),
                          )
                        }
                        placeholder="渠道商"
                        items={[
                          ["NONE", "暂不指定渠道"],
                          ...projectChannels.map((item) => [
                            item.id,
                            item.name,
                          ]),
                        ]}
                      />
                    ) : (
                      <span className="self-center text-xs text-slate-400">
                        收款说明在实际记录中填写
                      </span>
                    )}
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={groupIndex === 0}
                        onClick={() => movePlan(index, "UP")}
                        title="上移"
                        aria-label={`上移计划：${row.name}`}
                      >
                        <ArrowUp size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={groupIndex === group.length - 1}
                        onClick={() => movePlan(index, "DOWN")}
                        title="下移"
                        aria-label={`下移计划：${row.name}`}
                      >
                        <ArrowDown size={15} />
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setPlans(
                          plans.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title="5. 材料清单"
          note="创建后会按适用范围展开到“合同与付款”或每位申请人名下；上传文件即表示已经核查完成。"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setMaterials([
                  ...materials,
                  {
                    name: "新增材料",
                    scope: "ALL",
                    required: true,
                    expectedDate: "",
                  },
                ])
              }
            >
              <Plus size={15} /> 增加材料
            </Button>
          }
        >
          {materials.length === 0 ? (
            <Hint>该项目没有默认材料，可按实际需要添加。</Hint>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {materials.map((row, index) => (
                <div
                  key={`${row.templateId || "new"}-${index}`}
                  className="rounded-xl border p-4"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.name}
                      onChange={(event) =>
                        setMaterials(
                          materials.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setMaterials(
                          materials.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                  <Choose
                    value={row.scope}
                    onChange={(scope) =>
                      setMaterials(
                        materials.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, scope: scope as MaterialScope }
                            : item,
                        ),
                      )
                    }
                    placeholder="适用范围"
                    items={Object.entries(materialScopeLabels)}
                  />
                  <Input
                    type="date"
                    className="mt-3"
                    value={row.expectedDate}
                    onChange={(event) =>
                      setMaterials(
                        materials.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, expectedDate: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <div className="mt-3 text-sm">
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={row.required}
                        onCheckedChange={(checked) =>
                          setMaterials(
                            materials.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, required: Boolean(checked) }
                                : item,
                            ),
                          )
                        }
                      />{" "}
                      必需
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="6. 备注与确认"
          note="创建后，项目快照、预算汇率和全部模板副本会固定保存在订单中。"
        >
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="填写合同或办理注意事项（可选）"
          />
          {message && <p className="mt-3 text-sm text-rose-700">{message}</p>}
          <div className="mt-5 flex justify-end">
            <Button
              disabled={saving || !canSave || missing}
              onClick={save}
              className="bg-[#0f766e]"
            >
              <Save size={16} />
              {saving ? "正在保存…" : "创建订单"}
            </Button>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-slate-50 p-5 text-sm text-slate-500">
      {children}
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
  placeholder,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  items: string[][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="mt-2 w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map(([id, label]) => (
          <SelectItem key={id} value={id}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function MrzChecksumHint({ capture }: { capture: PassportMrzCapture }) {
  const entries = Object.entries(capture.checksums);
  const validCount = entries.filter(([, valid]) => valid).length;
  const formatText = capture.format
    ? `（${capture.format}${capture.format === "TD3" ? " 护照" : ""}）`
    : "";
  return (
    <TooltipProvider delayDuration={180}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label="查看 MRZ 校验位详情"
            className="inline-flex shrink-0 cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {capture.valid ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertTriangle size={15} />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">
              MRZ 校验位{formatText}：{validCount}/{entries.length} 项通过
            </p>
            {capture.format === "TD3" && entries.length !== 5 && (
              <p className="text-amber-700">
                标准护照 TD3 应有 5 个校验位；当前识别结果可能不完整。
              </p>
            )}
            {entries.length ? (
              <div className="grid gap-1">
                {entries.map(([key, valid]) => (
                  <div
                    key={key}
                    className={valid ? "text-emerald-700" : "text-rose-700"}
                  >
                    {valid ? "✓" : "✕"} {describeMrzChecksum(key)}：
                    {valid ? "通过" : "未通过"}
                  </div>
                ))}
              </div>
            ) : (
              <p>未返回可用的校验位明细。</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function MrzReviewDetails({ capture }: { capture: PassportMrzCapture }) {
  const entries = Object.entries(capture.checksums);
  return (
    <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <summary className="cursor-pointer select-none font-medium text-slate-700">
        查看原始 MRZ 与校验明细
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-slate-500">
          解析格式：{capture.format || "未知"}
          {capture.format === "TD3" ? "（护照）" : ""}
        </p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-5 text-slate-100">
          {capture.rawMrz}
        </pre>
        <div className="grid gap-1 sm:grid-cols-2">
          {entries.map(([key, valid]) => (
            <div
              key={key}
              className={valid ? "text-emerald-700" : "text-rose-700"}
            >
              {valid ? "✓" : "✕"} {describeMrzChecksum(key)}
              {valid ? "通过" : "未通过"}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
