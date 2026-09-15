"use client";

import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FilterX,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
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

type Log = {
  id: string;
  occurred_at: string;
  actor_username_snapshot: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  result: "SUCCESS" | "FAILURE";
  summary: string;
  changes_json: string | null;
  request_id: string;
  ip: string | null;
  user_agent: string | null;
};

type AuditResponse = {
  rows: Log[];
  total: number;
  page: number;
  pageSize: number;
  actors: string[];
  actions: { action: string; entity_type: string; count: number }[];
  canExport: boolean;
};

const moduleLabel: Record<string, string> = {
  AUTH: "登录与安全",
  USER: "用户",
  ROLE: "角色",
  ORDER: "订单",
  CASH_ENTRY: "订单收支",
  TASK: "订单待办",
  PROJECT: "项目",
  AGENT: "代理",
  CUSTOMER: "代理（历史）",
  CHANNEL: "渠道商",
  CURRENCY: "币种",
  MATERIAL_CATALOG: "材料管理",
  MATERIAL_FILE: "材料文件",
  AUDIT: "操作日志",
  SYSTEM: "系统维护",
};

const actionLabel: Record<string, string> = {
  AUTH_LOGIN: "登录系统",
  AUTH_LOGOUT: "退出系统",
  AUTH_PASSWORD_CHANGE: "修改本人密码",
  AUTH_PASSWORD_HASH_UPGRADE: "升级密码哈希",
  AUTH_SESSION_CLEANUP: "清理过期会话",
  AUTH_SESSION_REVOKE: "退出登录设备",
  AUTH_SESSION_REVOKE_OTHERS: "退出其他设备",
  AUTH_MFA: "双重验证失败",
  AUTH_MFA_SETUP_BEGIN: "开始设置双重验证",
  AUTH_MFA_ENABLE: "启用双重验证",
  AUTH_MFA_DISABLE: "关闭双重验证",
  AUTH_MFA_RECOVERY_REGENERATE: "更新双重验证恢复码",
  SECURITY_ORIGIN_REJECT: "拦截跨站写入",
  USER_CREATE: "新增用户",
  USER_BOOTSTRAP: "初始化系统所有者",
  USER_UPDATE: "修改用户",
  USER_TOGGLE: "切换用户状态",
  USER_ENABLE: "启用用户",
  USER_DISABLE: "停用用户",
  USER_PASSWORD_RESET: "重置用户密码",
  USER_SESSIONS_REVOKE: "注销用户会话",
  ROLE_CREATE: "新增角色",
  ROLE_UPDATE: "修改角色",
  ROLE_DISABLE: "停用角色",
  ROLE_DEACTIVATE: "停用角色",
  AUDIT_EXPORT: "导出操作日志",
  DATABASE_BACKUP: "数据库自动备份",
  DATABASE_RESTORE: "数据库恢复",
  MATERIAL_FILE_UPLOAD: "上传材料文件",
  MATERIAL_FILE_REPLACE: "替换材料文件",
  MATERIAL_FILE_VOID: "作废材料文件",
  MATERIAL_FILE_RESTORE: "恢复材料文件",
  MATERIAL_FILE_PREVIEW: "预览材料文件",
  MATERIAL_FILE_DOWNLOAD: "下载材料文件",
  MATERIAL_FILE_DELETE: "删除材料文件",
  FILE_INTEGRITY_CHECK: "检查文件一致性",
  MATERIAL_CATALOG_CREATE: "新增材料模板",
  MATERIAL_CATALOG_UPDATE: "修改材料模板",
  MATERIAL_CATALOG_ACTIVATE: "启用材料模板",
  MATERIAL_CATALOG_DEACTIVATE: "停用材料模板",
  MATERIAL_CATALOG_DELETE: "删除材料模板",
  MATERIAL_CATALOG_MOVE: "调整材料模板顺序",
  PROJECTS_CREATE: "新增项目",
  PROJECT_UPDATE: "修改项目资料",
  PROJECT_DEFAULTCHANNEL: "修改默认渠道",
  PROJECT_CHANNEL: "关联项目渠道",
  PROJECT_STEP: "新增项目流程",
  PROJECT_UPDATESTEP: "修改项目流程",
  PROJECT_PLAN: "新增收付款方案",
  PROJECT_UPDATEPLAN: "修改收付款方案",
  PROJECT_MATERIAL: "新增项目材料",
  PROJECT_UPDATEMATERIAL: "修改项目材料",
  PROJECT_IMPORTMATERIALS: "从材料库导入",
  PROJECT_MOVETEMPLATE: "调整项目模板顺序",
  PROJECT_REMOVETEMPLATE: "删除项目模板",
  PROJECT_PACKAGE_EXPORT: "导出项目包",
  PROJECT_PACKAGE_IMPORT: "导入项目包",
  ORDER_STATUS: "修改订单状态",
  ORDER_UPDATENOTES: "修改订单备注",
  ORDER_UPDATESIGNEDAT: "修改签订日期",
  ORDER_UPDATEAPPLICANT: "修改申请人",
  ORDER_NOTES: "修改订单备注",
  ORDER_STEP: "修改流程状态",
  ORDER_MOVESTEP: "调整流程顺序",
  ORDER_ADDSTEP: "新增订单流程",
  ORDER_UPDATESTEP: "修改订单流程",
  ORDER_DELETESTEP: "删除订单流程",
  ORDER_ADDAPPLICANT: "添加附属申请人",
  ORDER_DELETEAPPLICANT: "删除附属申请人",
  ORDER_ADDMATERIAL: "新增订单材料",
  ORDER_UPDATEMATERIAL: "修改订单材料",
  ORDER_PROGRESS: "新增跟进记录",
  ORDER_COMPLETEFOLLOWUP: "完成跟进事项",
  ORDER_APPLICANT: "保存申请人",
  APPLICANT_MRZ_SCAN: "识别护照 MRZ",
  APPLICANT_MRZ_CONFIRM: "确认护照 MRZ",
  ORDER_MATERIAL: "保存订单材料",
  ORDER_DELETEMATERIAL: "删除订单材料",
  ORDER_SAVEPLAN: "保存订单计划",
  ORDER_PLAN: "新增订单计划",
  ORDER_UPDATEPLAN: "修改订单计划",
  ORDER_DELETEPLAN: "删除订单计划",
  ORDER_MOVEPLAN: "调整订单计划顺序",
  ORDER_SAVECASHENTRY: "保存收付款记录",
  ORDER_DELETECASHENTRY: "删除收付款记录",
  CASH_ENTRY_VOID: "作废收付款记录",
  CASH_ENTRY_RESTORE: "恢复收付款记录",
  ORDER_CLOSE: "正式结案",
  ORDER_REOPEN: "重新开启订单",
  ORDER_ASSIGNOWNER: "分配订单负责人",
  TASK_CREATE: "新增订单待办",
  TASK_UPDATE: "修改订单待办",
  TASK_COMPLETE: "完成订单待办",
  TASK_REOPEN: "重新打开待办",
  TASK_DELETE: "删除订单待办",
  AGENTS_CREATE: "新增代理",
  AGENTS_UPDATE: "修改代理",
  AGENTS_ACTIVATE: "启用代理",
  AGENTS_DEACTIVATE: "停用代理",
  CHANNELS_CREATE: "新增渠道商",
  CHANNELS_UPDATE: "修改渠道商",
  CHANNELS_ACTIVATE: "启用渠道商",
  CHANNELS_DEACTIVATE: "停用渠道商",
  RATES_CREATE: "新增币种",
  RATES_SAVE: "修改币种",
  RATES_ACTIVATE: "启用币种",
  RATES_DEACTIVATE: "停用币种",
};

const fieldLabel: Record<string, string> = {
  name: "名称",
  username: "用户名",
  displayName: "显示姓名",
  role: "角色",
  roleId: "角色",
  status: "状态",
  notes: "备注",
  title: "标题",
  details: "详情",
  nextAction: "下一步",
  followUpDate: "跟进日期",
  entryDate: "发生日期",
  signedAt: "签订日期",
  currency: "币种",
  receivableCurrency: "默认应收币种",
  providerCurrency: "项目方币种",
  amount: "金额",
  baseAmount: "USD 本位币金额",
  ratePerUsd: "汇率",
  calculatedField: "自动计算项",
  description: "说明",
  category: "分类",
  defaultScope: "默认范围",
  defaultRequired: "默认必需",
  scope: "适用范围",
  required: "是否必需",
  reason: "变更原因",
  before: "变更前",
  after: "变更后",
  submitted: "提交内容",
  direction: "收支类型",
  dueDate: "预计日期",
  dueDays: "预计天数",
  permissions: "权限",
  active: "启用状态",
  mimeType: "文件类型",
  sizeBytes: "文件大小",
  items: "项目",
  ownerUserId: "负责人",
  agentId: "代理来源",
  orderScope: "订单数据范围",
  priority: "优先级",
  relatedType: "关联类型",
  relatedId: "关联对象",
};

const emptyData: AuditResponse = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 50,
  actors: [],
  actions: [],
  canExport: false,
};
const emptyFilters = {
  query: "",
  module: "ALL",
  actor: "ALL",
  action: "ALL",
  result: "ALL",
  from: "",
  to: "",
};

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Log | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "50",
      });
      if (filters.query.trim()) params.set("q", filters.query.trim());
      if (filters.module !== "ALL") params.set("module", filters.module);
      if (filters.actor !== "ALL") params.set("actor", filters.actor);
      if (filters.action !== "ALL") params.set("action", filters.action);
      if (filters.result !== "ALL") params.set("result", filters.result);
      if (filters.from)
        params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to) {
        const exclusive = new Date(`${filters.to}T00:00:00`);
        exclusive.setDate(exclusive.getDate() + 1);
        params.set("to", exclusive.toISOString());
      }
      fetch(`/api/admin/audit?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "读取失败");
          setData(result);
        })
        .catch((reason) => {
          if (reason.name !== "AbortError") setError(reason.message);
        })
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, page]);

  const availableActions = useMemo(() => {
    const rows =
      filters.module === "ALL"
        ? data.actions
        : data.actions.filter((item) => item.entity_type === filters.module);
    return [...new Map(rows.map((item) => [item.action, item])).values()];
  }, [data.actions, filters.module]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const hasFilters = Object.entries(filters).some(
    ([key, value]) =>
      value !==
      (key === "query" || key === "from" || key === "to" ? "" : "ALL"),
  );
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(emptyFilters);
    setPage(1);
  };
  const exportLogs = () => {
    const params = new URLSearchParams({ format: "csv" });
    if (filters.query.trim()) params.set("q", filters.query.trim());
    if (filters.module !== "ALL") params.set("module", filters.module);
    if (filters.actor !== "ALL") params.set("actor", filters.actor);
    if (filters.action !== "ALL") params.set("action", filters.action);
    if (filters.result !== "ALL") params.set("result", filters.result);
    if (filters.from)
      params.set("from", new Date(`${filters.from}T00:00:00`).toISOString());
    if (filters.to) {
      const exclusive = new Date(`${filters.to}T00:00:00`);
      exclusive.setDate(exclusive.getDate() + 1);
      params.set("to", exclusive.toISOString());
    }
    // This endpoint returns a CSV attachment rather than an internal page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/admin/audit?${params}`;
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="系统管理"
        title="操作日志"
        description="记录谁在什么时间对什么数据进行了什么操作；日志不可修改或删除"
      />

      <section className="panel overflow-hidden">
        <div className="border-b p-5">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={17}
              />
              <Input
                className="pl-9"
                value={filters.query}
                onChange={(event) => changeFilter("query", event.target.value)}
                placeholder="搜索用户、订单号、项目、文件或操作内容"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-9 px-3">
                共 {data.total} 条
              </Badge>
              {data.canExport && (
                <Button variant="outline" onClick={exportLogs}>
                  <Download size={16} /> 导出当前结果
                </Button>
              )}
              {hasFilters && (
                <Button variant="ghost" onClick={clearFilters}>
                  <FilterX size={16} /> 清空筛选
                </Button>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Filter label="用户">
              <Select
                value={filters.actor}
                onValueChange={(value) => changeFilter("actor", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部用户</SelectItem>
                  {data.actors.map((actor) => (
                    <SelectItem key={actor} value={actor}>
                      {actor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
            <Filter label="模块">
              <Select
                value={filters.module}
                onValueChange={(value) => {
                  changeFilter("module", value);
                  changeFilter("action", "ALL");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部模块</SelectItem>
                  {Object.entries(moduleLabel).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
            <Filter label="操作">
              <Select
                value={filters.action}
                onValueChange={(value) => changeFilter("action", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部操作</SelectItem>
                  {availableActions.map((item) => (
                    <SelectItem key={item.action} value={item.action}>
                      {displayAction(item.action)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
            <Filter label="结果">
              <Select
                value={filters.result}
                onValueChange={(value) => changeFilter("result", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">全部结果</SelectItem>
                  <SelectItem value="SUCCESS">成功</SelectItem>
                  <SelectItem value="FAILURE">失败</SelectItem>
                </SelectContent>
              </Select>
            </Filter>
            <Filter label="开始日期">
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(event) => changeFilter("from", event.target.value)}
              />
            </Filter>
            <Filter label="结束日期">
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) => changeFilter("to", event.target.value)}
              />
            </Filter>
          </div>
        </div>

        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <LoadingState />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="table-head">
                    <th>时间</th>
                    <th>用户</th>
                    <th>事件</th>
                    <th>对象</th>
                    <th>结果</th>
                    <th>来源</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((log) => (
                    <tr key={log.id} className="table-row">
                      <td className="whitespace-nowrap tabular-nums">
                        <span className="block">
                          {formatDate(log.occurred_at)}
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                          {formatTime(log.occurred_at)}
                        </span>
                      </td>
                      <td>
                        <b>{log.actor_username_snapshot || "未知用户"}</b>
                      </td>
                      <td>
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                            <ShieldCheck size={16} />
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <b>{displayAction(log.action)}</b>
                              <Badge
                                variant="outline"
                                className="px-1.5 py-0 text-[10px] text-slate-500"
                              >
                                {moduleLabel[log.entity_type] ||
                                  log.entity_type}
                              </Badge>
                            </div>
                            <p className="mt-1 max-w-[430px] text-xs text-slate-500">
                              {log.summary}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        {entityHref(log) ? (
                          <Link
                            href={entityHref(log)!}
                            className="font-medium text-teal-700 hover:underline"
                          >
                            {log.entity_label || log.entity_id}
                          </Link>
                        ) : (
                          <span>{log.entity_label || "—"}</span>
                        )}
                      </td>
                      <td>
                        <Badge
                          variant="outline"
                          className={`status ${log.result === "SUCCESS" ? "green" : "amber"}`}
                        >
                          {log.result === "SUCCESS" ? "成功" : "失败"}
                        </Badge>
                      </td>
                      <td className="text-xs text-slate-500">
                        {log.ip || "本机"}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelected(log)}
                        >
                          <Eye size={15} /> 详情
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && (
              <p className="p-10 text-center text-sm text-slate-400">
                暂无匹配日志
              </p>
            )}
            {data.total > 0 && (
              <div className="flex items-center justify-between border-t px-5 py-4 text-sm text-slate-500">
                <span>
                  第 {data.page} / {pageCount} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                  >
                    <ChevronLeft size={15} /> 上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={data.page >= pageCount}
                    onClick={() =>
                      setPage((current) => Math.min(pageCount, current + 1))
                    }
                  >
                    下一页 <ChevronRight size={15} />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selected ? displayAction(selected.action) : "操作详情"}
            </DialogTitle>
            <DialogDescription>{selected?.summary}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
                <Detail
                  label="操作时间"
                  value={formatFullDate(selected.occurred_at)}
                />
                <Detail
                  label="操作用户"
                  value={selected.actor_username_snapshot || "未知用户"}
                />
                <Detail
                  label="业务模块"
                  value={
                    moduleLabel[selected.entity_type] || selected.entity_type
                  }
                />
                <Detail
                  label="操作结果"
                  value={selected.result === "SUCCESS" ? "成功" : "失败"}
                />
                <Detail label="操作对象" value={selected.entity_label || "—"} />
                <Detail label="对象标识" value={selected.entity_id || "—"} />
                <Detail label="来源地址" value={selected.ip || "本机"} />
                <Detail label="请求标识" value={selected.request_id} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">变更内容</h3>
                <ChangeDetails json={selected.changes_json} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">设备信息</h3>
                <p className="mt-2 break-all rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                  {selected.user_agent || "未记录"}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Filter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 break-all text-sm font-medium text-slate-700">
        {value}
      </p>
    </div>
  );
}

function ChangeDetails({ json }: { json: string | null }) {
  if (!json)
    return (
      <p className="mt-2 rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">
        本次操作没有附加变更内容。
      </p>
    );
  let changes: Record<string, unknown>;
  try {
    changes = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return (
      <p className="mt-2 break-all rounded-xl border bg-slate-50 p-4 text-xs text-slate-500">
        {json}
      </p>
    );
  }
  const entries = Object.entries(changes).filter(
    ([key]) => key !== "action" && key !== "expectedVersion",
  );
  if (!entries.length)
    return (
      <p className="mt-2 rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">
        本次操作没有需要展示的字段变化。
      </p>
    );
  return (
    <div className="mt-2 divide-y divide-slate-100 rounded-xl border">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]"
        >
          <span className="text-xs text-slate-400">
            {fieldLabel[key] || key}
          </span>
          <span className="break-words text-sm text-slate-700">
            {displayValue(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      value.every(
        (item) =>
          item === null ||
          ["string", "number", "boolean"].includes(typeof item),
      )
    )
      return `${displayValue(value[0])} → ${displayValue(value[1])}`;
    return value
      .map((item) =>
        typeof item === "object" ? JSON.stringify(item) : displayValue(item),
      )
      .join("；");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function displayAction(action: string) {
  if (actionLabel[action]) return actionLabel[action];
  const suffix = action.split("_").at(-1) || action;
  const generic: Record<string, string> = {
    CREATE: "新增",
    UPDATE: "修改",
    SAVE: "保存",
    DELETE: "删除",
    ENABLE: "启用",
    DISABLE: "停用",
    ACTIVATE: "启用",
    DEACTIVATE: "停用",
    PREVIEW: "预览",
    DOWNLOAD: "下载",
    UPLOAD: "上传",
  };
  return generic[suffix] || action;
}

function entityHref(log: Log) {
  if (!log.entity_id) return null;
  if (log.entity_type === "ORDER")
    return `/orders/${encodeURIComponent(log.entity_id)}`;
  if (log.entity_type === "PROJECT")
    return `/projects/${encodeURIComponent(log.entity_id)}`;
  if (log.entity_type === "AGENT" || log.entity_type === "CUSTOMER")
    return `/agents/${encodeURIComponent(log.entity_id)}`;
  if (log.entity_type === "CHANNEL")
    return `/channels/${encodeURIComponent(log.entity_id)}`;
  return null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN");
}
function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}
function formatFullDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
