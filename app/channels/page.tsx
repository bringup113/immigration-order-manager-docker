"use client";

import { Building2, Pencil, Plus, Power, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  CurrencySelect,
  type CurrencyOption,
} from "@/components/currency-select";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
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
import { Textarea } from "@/components/ui/textarea";
import { apiPost, useApiList } from "@/lib/use-api";
import { usePermissions } from "@/lib/use-permissions";

type Channel = {
  id: string;
  name: string;
  country: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  settlement_currency: string;
  notes: string | null;
  active: number | boolean;
  project_count: number;
  order_count: number;
};
const blank = {
  name: "",
  country: "",
  contactName: "",
  phone: "",
  email: "",
  settlementCurrency: "USD",
  notes: "",
};

export default function ChannelsPage() {
  const { rows, loading, error, reload } = useApiList<Channel>("channels");
  const currencies = useApiList<CurrencyOption>("currencies");
  const canEdit = usePermissions()("channels.write");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [toggleTarget, setToggleTarget] = useState<Channel | null>(null);
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        `${row.name} ${row.country || ""} ${row.contact_name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [rows, query],
  );

  function openCreate() {
    setEditingId("");
    setForm(blank);
    setMessage("");
    setOpen(true);
  }
  function openEdit(row: Channel) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      country: row.country || "",
      contactName: row.contact_name || "",
      phone: row.phone || "",
      email: row.email || "",
      settlementCurrency: row.settlement_currency,
      notes: row.notes || "",
    });
    setMessage("");
    setOpen(true);
  }
  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await apiPost("channels", {
        ...form,
        action: editingId ? "update" : "create",
        id: editingId || undefined,
      });
      setOpen(false);
      setEditingId("");
      setForm(blank);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function toggle(row: Channel) {
    const active = Boolean(row.active);
    if (active) {
      setMessage("");
      setToggleTarget(row);
      return;
    }
    try {
      await apiPost("channels", {
        action: "activate",
        id: row.id,
        name: row.name,
      });
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "状态修改失败");
    }
  }
  async function confirmDeactivate() {
    if (!toggleTarget) return;
    setSaving(true);
    try {
      await apiPost("channels", {
        action: "deactivate",
        id: toggleTarget.id,
        name: toggleTarget.name,
      });
      setToggleTarget(null);
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "状态修改失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="基础资料"
        title="渠道商管理"
        description="管理实际承接项目的对接公司、联系人和结算币种"
        action={
          canEdit ? (
            <Button onClick={openCreate} className="bg-[#0f766e]">
              <Plus size={16} /> 新增渠道商
            </Button>
          ) : null
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>渠道商不是代理：</b>
        代理表示订单来源；渠道商是你转交项目、支付项目费用的对接公司。
      </div>
      {message && !open && (
        <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {message}
        </p>
      )}
      {error && <ErrorState message={error} />}{" "}
      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          title="还没有渠道商"
          description="新增对接公司后，可以设为项目的默认渠道商，也可以在订单中另行选择。"
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
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索渠道商或国家"
                className="h-10 bg-slate-50 pl-9"
              />
            </div>
            <Badge variant="outline" className="ml-auto">
              共 {rows.length} 家
            </Badge>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((row) => (
              <article
                key={row.id}
                className={`rounded-2xl border border-slate-200 p-5 ${!Boolean(row.active) ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
                    <Building2 />
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{row.settlement_currency}</Badge>
                    <Badge
                      variant="outline"
                      className={`status ${Boolean(row.active) ? "green" : "amber"}`}
                    >
                      {Boolean(row.active) ? "启用" : "停用"}
                    </Badge>
                  </div>
                </div>
                <h2 className="mt-5 font-semibold">{row.name}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {row.country || "未填写地区"}
                </p>
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                  <p>{row.contact_name || "未填写联系人"}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {row.phone || row.email || "暂无联系方式"}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    关联项目 {row.project_count || 0} · 关联订单{" "}
                    {row.order_count || 0}
                  </span>
                  {canEdit && (
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="修改"
                        onClick={() => openEdit(row)}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={Boolean(row.active) ? "停用" : "启用"}
                        onClick={() => void toggle(row)}
                      >
                        <Power size={15} />
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "修改渠道商" : "新增渠道商"}</DialogTitle>
            <DialogDescription>
              登记项目实际对接公司及常用结算币种。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="渠道商名称">
              <Input
                className="mt-2"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="国家/地区">
              <Input
                className="mt-2"
                value={form.country}
                onChange={(event) =>
                  setForm({ ...form, country: event.target.value })
                }
              />
            </Field>
            <Field label="联系人">
              <Input
                className="mt-2"
                value={form.contactName}
                onChange={(event) =>
                  setForm({ ...form, contactName: event.target.value })
                }
              />
            </Field>
            <Field label="联系电话">
              <Input
                className="mt-2"
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </Field>
            <Field label="电子邮箱">
              <Input
                className="mt-2"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </Field>
            <Field label="常用结算币种">
              <CurrencySelect
                value={form.settlementCurrency}
                onChange={(value) =>
                  setForm({ ...form, settlementCurrency: value })
                }
                currencies={currencies.rows}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="备注">
                <Textarea
                  className="mt-2"
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                />
              </Field>
            </div>
          </div>
          {message && <p className="text-sm text-rose-700">{message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={saving || !form.name.trim() || currencies.loading}
              onClick={() => void save()}
              className="bg-[#0f766e]"
            >
              {saving ? "正在保存…" : "保存渠道商"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(value) => !value && setToggleTarget(null)}
        title="停用渠道商"
        description={
          <>
            确定停用“{toggleTarget?.name}
            ”吗？已有项目和订单记录会保留，但以后不能再选择该渠道商。
          </>
        }
        confirmLabel="确认停用"
        pending={saving}
        pendingLabel="正在停用…"
        error={message || undefined}
        onConfirm={() => void confirmDeactivate()}
      />
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
