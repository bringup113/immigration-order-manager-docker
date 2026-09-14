"use client";

import { Pencil, Plus, Power, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
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

type Agent = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  country_region: string | null;
  notes: string | null;
  active: number | boolean;
  system_managed: number | boolean;
  order_count: number;
};
const blank = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  countryRegion: "",
  notes: "",
};

export default function AgentsPage() {
  const { rows, loading, error, reload } = useApiList<Agent>("agents");
  const canEdit = usePermissions()("agents.write");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [toggleTarget, setToggleTarget] = useState<Agent | null>(null);
  const visible = useMemo(
    () =>
      rows.filter((row) =>
        `${row.name} ${row.contact_name || ""} ${row.phone || ""} ${row.email || ""}`
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
  function openEdit(row: Agent) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      contactName: row.contact_name || "",
      phone: row.phone || "",
      email: row.email || "",
      countryRegion: row.country_region || "",
      notes: row.notes || "",
    });
    setMessage("");
    setOpen(true);
  }
  async function save() {
    setSaving(true);
    setMessage("");
    try {
      await apiPost("agents", {
        ...form,
        action: editingId ? "update" : "create",
        id: editingId || undefined,
      });
      setOpen(false);
      setForm(blank);
      setEditingId("");
      await reload();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function toggle(row: Agent) {
    const active = Boolean(row.active);
    if (active) {
      setMessage("");
      setToggleTarget(row);
      return;
    }
    try {
      await apiPost("agents", {
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
      await apiPost("agents", {
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
        title="代理管理"
        description="维护订单的代理来源与联系方式"
        action={
          canEdit ? (
            <Button onClick={openCreate} className="bg-[#0f766e]">
              <Plus size={16} /> 新增代理
            </Button>
          ) : null
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>代理表示订单来源：</b>
        外部合作方单独建档；没有外部代理的订单统一选择系统内置的“公司直营”。申请人仍在订单内单独登记。
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
          title="还没有代理"
          description="新增代理后即可在订单中选择。"
        />
      ) : (
        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 p-5">
            <div className="relative max-w-sm flex-1">
              <Search
                size={17}
                className="absolute left-3 top-2.5 text-slate-400"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索代理名称、联系人或电话"
                className="h-10 bg-slate-50 pl-9"
              />
            </div>
            <Badge variant="outline" className="ml-auto">
              共 {rows.length} 个代理来源
            </Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="table-head">
                  <th>代理名称</th>
                  <th>联系人</th>
                  <th>联系方式</th>
                  <th>订单数</th>
                  <th>状态</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    id={`agent-${row.id}`}
                    className={`table-row scroll-mt-24 ${!Boolean(row.active) ? "opacity-60" : ""}`}
                    key={row.id}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <b>{row.name}</b>
                        {Boolean(row.system_managed) && (
                          <Badge variant="outline" className="status teal">
                            系统内置
                          </Badge>
                        )}
                      </div>
                      {row.notes && (
                        <p className="mt-1 max-w-xs truncate text-xs text-slate-400">
                          {row.notes}
                        </p>
                      )}
                    </td>
                    <td>{row.contact_name || "—"}</td>
                    <td>
                      <span>{row.phone || "—"}</span>
                      {row.email && (
                        <p className="mt-1 text-xs text-slate-400">
                          {row.email}
                        </p>
                      )}
                    </td>
                    <td>{row.order_count || 0}</td>
                    <td>
                      <Badge
                        variant="outline"
                        className={`status ${Boolean(row.active) ? "green" : "amber"}`}
                      >
                        {Boolean(row.active) ? "启用" : "停用"}
                      </Badge>
                    </td>
                    {canEdit && (
                      <td>
                        {!Boolean(row.system_managed) && (
                          <div className="flex justify-end gap-1">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "修改代理" : "新增代理"}</DialogTitle>
            <DialogDescription>
              登记外部代理及其联系方式；币种仍在订单收付款中独立选择。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="代理名称">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className="mt-2"
                placeholder="个人或公司名称"
              />
            </Field>
            <Field label="联系人">
              <Input
                value={form.contactName}
                onChange={(event) =>
                  setForm({ ...form, contactName: event.target.value })
                }
                className="mt-2"
              />
            </Field>
            <Field label="联系电话">
              <Input
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
                className="mt-2"
              />
            </Field>
            <Field label="电子邮箱">
              <Input
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
                className="mt-2"
              />
            </Field>
            <Field label="国家/地区">
              <Input
                value={form.countryRegion}
                onChange={(event) =>
                  setForm({ ...form, countryRegion: event.target.value })
                }
                className="mt-2"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="备注">
                <Textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  className="mt-2"
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
              disabled={saving || !form.name.trim()}
              onClick={() => void save()}
              className="bg-[#0f766e]"
            >
              {saving ? "正在保存…" : "保存代理"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(value) => !value && setToggleTarget(null)}
        title="停用代理"
        description={
          <>
            停用“{toggleTarget?.name}
            ”后，新订单将不能再选择该代理，已有订单不受影响。
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
