"use client";

import Link from "next/link";
import { ArrowRight, FolderKanban, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  CurrencySelect,
  type CurrencyOption,
} from "@/components/currency-select";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { ProjectPackageActions } from "@/components/project-package-actions";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPost, useApiList } from "@/lib/use-api";
import { usePermissions } from "@/lib/use-permissions";

type Project = {
  id: string;
  code: string;
  name: string;
  country: string;
  status: string;
  revision_no: number;
  default_receivable_currency: string;
  provider_currency: string;
  channel_name: string | null;
  order_count: number;
  step_count: number;
  receipt_stages: number;
  payment_stages: number;
};
type Catalogs = {
  channels: { id: string; name: string }[];
  rates: CurrencyOption[];
};
const blank = {
  name: "",
  code: "",
  country: "",
  receivableCurrency: "USD",
  providerCurrency: "USD",
  defaultChannelId: "",
};
export default function ProjectsPage() {
  const { rows, loading, error, reload } = useApiList<Project>("projects");
  const can = usePermissions();
  const [catalogs, setCatalogs] = useState<Catalogs>({
    channels: [],
    rates: [],
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      rows.filter((r) =>
        `${r.name} ${r.country} ${r.code}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [rows, query],
  );
  async function showCreate() {
    setOpen(true);
    const response = await fetch("/api/data/catalogs");
    if (response.ok) setCatalogs(await response.json());
  }
  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await apiPost("projects", form);
      setOpen(false);
      setForm(blank);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppShell>
      <PageHeader
        eyebrow="基础资料"
        title="项目管理"
        description="维护可复用的流程、收付款、材料和渠道模板"
        action={
          <div className="flex flex-wrap gap-2">
            <ProjectPackageActions onImported={reload} />
            {can("projects.write") && (
              <Button onClick={showCreate} className="bg-[#0f766e]">
                <Plus size={16} /> 新建项目
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>项目是模板，不是办理实例：</b>
        创建订单时会复制当前版本；之后修改项目，不会改变已经创建的订单。
      </div>
      {error && <ErrorState message={error} />}{" "}
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          title="还没有项目"
          description="先新建项目或导入项目包，再设置办理流程、收付款方案和材料清单。"
        />
      ) : (
        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b p-5">
            <div className="relative max-w-sm flex-1">
              <Search
                size={17}
                className="absolute left-3 top-2.5 text-slate-400"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目名称、国家或简称"
                className="h-10 bg-slate-50 pl-9"
              />
            </div>
            <Badge variant="outline" className="ml-auto">
              共 {rows.length} 个项目
            </Badge>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-11 place-items-center rounded-2xl bg-teal-50 text-teal-700">
                    <FolderKanban />
                  </span>
                  <Badge
                    variant="outline"
                    className={`status ${row.status === "ACTIVE" ? "green" : "amber"}`}
                  >
                    {row.status === "ACTIVE" ? "启用" : "停用"} · V
                    {row.revision_no}
                  </Badge>
                </div>
                <h2 className="mt-5 font-semibold">{row.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {row.country} · {row.code}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                  <div>
                    <p className="text-slate-400">应收 / 项目方币种</p>
                    <p className="mt-1 font-medium">
                      {row.default_receivable_currency} /{" "}
                      {row.provider_currency}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">默认渠道商</p>
                    <p className="mt-1 truncate font-medium">
                      {row.channel_name || "未设置"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-between text-xs text-slate-500">
                  <span>
                    流程 {row.step_count || 0} 步 · 方案{" "}
                    {(row.receipt_stages || 0) + (row.payment_stages || 0)} 项
                  </span>
                  <span>订单 {row.order_count || 0}</span>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  className="mt-3 w-full text-teal-700"
                >
                  <Link href={`/projects/${row.id}`}>
                    {can("projects.write") ? "管理" : "查看"}项目模板{" "}
                    <ArrowRight size={15} />
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建项目</DialogTitle>
            <DialogDescription>
              保存后进入项目详情设置流程、收付款、渠道和材料。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目名称">
              <Input
                className="mt-2"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="项目简称">
              <Input
                className="mt-2"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="例如：PTGV"
              />
            </Field>
            <Field label="国家/地区">
              <Input
                className="mt-2"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </Field>
            <Field label="默认渠道商">
              <Select
                value={form.defaultChannelId || "NONE"}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    defaultChannelId: value === "NONE" ? "" : value,
                  })
                }
              >
                <SelectTrigger className="mt-2 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">暂不设置</SelectItem>
                  {catalogs.channels.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="默认应收币种">
              <CurrencySelect
                value={form.receivableCurrency}
                onChange={(value) =>
                  setForm({ ...form, receivableCurrency: value })
                }
                currencies={catalogs.rates}
              />
            </Field>
            <Field label="项目方币种">
              <CurrencySelect
                value={form.providerCurrency}
                onChange={(value) =>
                  setForm({ ...form, providerCurrency: value })
                }
                currencies={catalogs.rates}
              />
            </Field>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                saving ||
                !form.name.trim() ||
                !form.code.trim() ||
                !form.country.trim() ||
                catalogs.rates.length === 0
              }
              onClick={save}
              className="bg-[#0f766e]"
            >
              {saving ? "正在保存…" : "保存项目"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
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
