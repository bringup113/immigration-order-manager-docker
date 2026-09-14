/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import {
  ArrowDown,
  ArrowUp,
  FileCheck2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
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
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/lib/use-permissions";

type MaterialRow = {
  id: string;
  name: string;
  category: string | null;
  default_scope: string;
  default_required: number;
  description: string | null;
  active: number;
  sequence: number;
};
type IntegrityReport = {
  generatedAt: string;
  summary: {
    databaseRecords: number;
    diskFiles: number;
    missingFiles: number;
    orphanFiles: number;
    missingChecksums: number;
    sizeMismatches: number;
    hashMismatches: number;
  };
  orphans: { relativePath: string; kind: string }[];
};

const scopeLabels: Record<string, string> = {
  COMMON: "合同与付款",
  MAIN: "仅主申请人",
  ALL: "每位申请人",
  DEPENDENT: "每位附属申请人",
};
const blankForm = {
  id: "",
  name: "",
  category: "",
  defaultScope: "ALL",
  defaultRequired: true,
  description: "",
};

export default function MaterialsPage() {
  const can = usePermissions();
  const canWrite = can("material_catalog.write");
  const canCheckFiles = can("materials.write");
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MaterialRow | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<MaterialRow | null>(
    null,
  );
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState({ text: "", error: false });
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/material-catalog", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取失败");
      setRows(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? rows.filter((row) =>
          [
            row.name,
            row.category,
            row.description,
            scopeLabels[row.default_scope],
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(term),
        )
      : rows;
  }, [query, rows]);

  function openCreate() {
    setForm(blankForm);
    setDialogOpen(true);
    setNotice({ text: "", error: false });
  }

  function openEdit(row: MaterialRow) {
    setForm({
      id: row.id,
      name: row.name,
      category: row.category || "",
      defaultScope: row.default_scope,
      defaultRequired: Boolean(row.default_required),
      description: row.description || "",
    });
    setDialogOpen(true);
    setNotice({ text: "", error: false });
  }

  async function post(payload: unknown) {
    const response = await fetch("/api/material-catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保存失败");
    return data;
  }

  async function checkIntegrity() {
    setCheckingIntegrity(true);
    setNotice({ text: "", error: false });
    try {
      const response = await fetch("/api/admin/file-integrity", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "检查失败");
      setIntegrity(result);
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "检查失败",
        error: true,
      });
    } finally {
      setCheckingIntegrity(false);
    }
  }

  async function save() {
    setSaving(true);
    setNotice({ text: "", error: false });
    try {
      await post({ action: form.id ? "update" : "create", ...form });
      await load();
      setDialogOpen(false);
      setNotice({
        text: `${form.name} 已保存；只影响以后从材料库进行的选择。`,
        error: false,
      });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "保存失败",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: MaterialRow) {
    if (row.active) {
      setNotice({ text: "", error: false });
      setDeactivateTarget(row);
      return;
    }
    setBusyId(row.id);
    setNotice({ text: "", error: false });
    try {
      await post({ action: "activate", id: row.id, name: row.name });
      await load();
      setNotice({ text: `${row.name} 已启用。`, error: false });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "保存失败",
        error: true,
      });
    } finally {
      setBusyId("");
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    setBusyId(deactivateTarget.id);
    setNotice({ text: "", error: false });
    try {
      await post({
        action: "deactivate",
        id: deactivateTarget.id,
        name: deactivateTarget.name,
      });
      const name = deactivateTarget.name;
      setDeactivateTarget(null);
      await load();
      setNotice({
        text: `${name} 已停用，不再出现在项目选择列表中。`,
        error: false,
      });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "停用失败",
        error: true,
      });
    } finally {
      setBusyId("");
    }
  }

  async function move(row: MaterialRow, direction: "UP" | "DOWN") {
    setBusyId(row.id);
    setNotice({ text: "", error: false });
    try {
      await post({ action: "move", id: row.id, name: row.name, direction });
      await load();
      setNotice({ text: `${row.name} 的顺序已调整。`, error: false });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "排序失败",
        error: true,
      });
    } finally {
      setBusyId("");
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setNotice({ text: "", error: false });
    try {
      await post({
        action: "delete",
        id: deleteTarget.id,
        name: deleteTarget.name,
      });
      const name = deleteTarget.name;
      setDeleteTarget(null);
      await load();
      setNotice({
        text: `${name} 已从材料库删除；已有项目和订单不受影响。`,
        error: false,
      });
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "删除失败",
        error: true,
      });
    } finally {
      setBusyId("");
    }
  }

  const sortingDisabled = Boolean(query.trim()) || Boolean(busyId);

  return (
    <AppShell>
      <PageHeader
        eyebrow="系统设置"
        title="材料管理"
        description="维护项目创建时可选择的材料模板，不与项目或订单保持关联"
        action={
          canWrite || canCheckFiles ? (
            <div className="flex flex-wrap gap-2">
              {canCheckFiles && (
                <Button
                  variant="outline"
                  disabled={checkingIntegrity}
                  onClick={() => void checkIntegrity()}
                >
                  <FileCheck2 size={16} />
                  {checkingIntegrity ? "正在检查…" : "检查订单文件"}
                </Button>
              )}
              {canWrite && (
                <Button className="bg-[#0f766e]" onClick={openCreate}>
                  <Plus size={16} /> 新增材料
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>使用规则：</b>
        加入项目时只复制材料内容；之后修改、停用、排序或删除材料库条目，都不会改变已有项目和订单。
      </div>
      {notice.text && (
        <p
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${notice.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {notice.text}
        </p>
      )}
      {integrity && (
        <section className="mb-5 rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">订单文件一致性</h2>
              <p className="mt-1 text-xs text-slate-500">
                检查时间{" "}
                {new Date(integrity.generatedAt).toLocaleString("zh-CN")}
                ；只检查，不会自动删除或修改文件。
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                integrity.summary.missingFiles ||
                integrity.summary.hashMismatches ||
                integrity.summary.sizeMismatches
                  ? "status amber"
                  : "status green"
              }
            >
              {integrity.summary.missingFiles ||
              integrity.summary.hashMismatches ||
              integrity.summary.sizeMismatches
                ? "需要处理"
                : "有效文件正常"}
            </Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["数据库记录", integrity.summary.databaseRecords],
              ["磁盘文件", integrity.summary.diskFiles],
              ["缺失文件", integrity.summary.missingFiles],
              ["孤儿文件", integrity.summary.orphanFiles],
              ["缺少哈希", integrity.summary.missingChecksums],
              [
                "哈希/大小异常",
                integrity.summary.hashMismatches +
                  integrity.summary.sizeMismatches,
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
          </div>
          {integrity.orphans.length > 0 && (
            <p className="mt-3 text-xs text-amber-700">
              发现 {integrity.orphans.length}{" "}
              个未索引文件，系统不会自动删除；需核对后单独处理。
            </p>
          )}
        </section>
      )}
      <div className="mb-4 max-w-md">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-10"
            placeholder="搜索名称、分类或说明"
          />
        </div>
        {query.trim() && canWrite && (
          <p className="mt-2 text-xs text-slate-500">
            清空搜索后可以调整材料顺序。
          </p>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState />
      ) : (
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="table-head">
                  <th className="w-16">顺序</th>
                  <th>材料名称</th>
                  <th>分类</th>
                  <th>默认范围</th>
                  <th>默认要求</th>
                  <th>状态</th>
                  {canWrite && <th></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const position = rows.findIndex((item) => item.id === row.id);
                  return (
                    <tr
                      key={row.id}
                      className={`table-row ${row.active ? "" : "opacity-60"}`}
                    >
                      <td className="tabular-nums text-slate-500">
                        {position + 1}
                      </td>
                      <td>
                        <b>{row.name}</b>
                        {row.description && (
                          <p className="mt-1 max-w-[320px] truncate text-xs text-slate-500">
                            {row.description}
                          </p>
                        )}
                      </td>
                      <td>{row.category || "未分类"}</td>
                      <td>
                        {scopeLabels[row.default_scope] || row.default_scope}
                      </td>
                      <td>{row.default_required ? "必需" : "可选"}</td>
                      <td>
                        <Badge
                          variant="outline"
                          className={`status ${row.active ? "green" : "amber"}`}
                        >
                          {row.active ? "启用" : "停用"}
                        </Badge>
                      </td>
                      {canWrite && (
                        <td>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={sortingDisabled || position === 0}
                              onClick={() => void move(row, "UP")}
                              title="上移"
                              aria-label={`上移 ${row.name}`}
                            >
                              <ArrowUp size={15} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={
                                sortingDisabled || position === rows.length - 1
                              }
                              onClick={() => void move(row, "DOWN")}
                              title="下移"
                              aria-label={`下移 ${row.name}`}
                            >
                              <ArrowDown size={15} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busyId === row.id}
                              onClick={() => openEdit(row)}
                              title="修改"
                              aria-label={`修改 ${row.name}`}
                            >
                              <Pencil size={15} />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busyId === row.id}
                              onClick={() => void toggle(row)}
                              title={row.active ? "停用" : "启用"}
                              aria-label={`${row.active ? "停用" : "启用"} ${row.name}`}
                            >
                              {row.active ? (
                                <PowerOff size={15} />
                              ) : (
                                <Power size={15} />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={busyId === row.id}
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => setDeleteTarget(row)}
                              title="删除"
                              aria-label={`删除 ${row.name}`}
                            >
                              <Trash2 size={15} />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-slate-500">
              没有匹配的材料
            </div>
          )}
        </section>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "修改材料" : "新增材料"}</DialogTitle>
            <DialogDescription>
              默认值只在项目选择材料时带入，加入后项目会保存自己的副本。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="材料名称">
              <Input
                className="mt-2"
                maxLength={120}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                placeholder="例如 护照首页"
              />
            </Field>
            <Field label="分类">
              <Input
                className="mt-2"
                maxLength={60}
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
                placeholder="例如 身份证明"
              />
            </Field>
            <Field label="默认适用范围">
              <Select
                value={form.defaultScope}
                onValueChange={(defaultScope) =>
                  setForm({ ...form, defaultScope })
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(scopeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <label className="mt-7 flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.defaultRequired}
                onCheckedChange={(checked) =>
                  setForm({ ...form, defaultRequired: Boolean(checked) })
                }
              />{" "}
              默认设为必需材料
            </label>
            <div className="sm:col-span-2">
              <Field label="说明">
                <Textarea
                  className="mt-2"
                  maxLength={1000}
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder="可填写核查要点或材料说明"
                />
              </Field>
            </div>
          </div>
          {notice.error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {notice.text}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-[#0f766e]"
              disabled={saving || !form.name.trim()}
              onClick={save}
            >
              {saving ? "正在保存…" : "保存材料"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(value) => !value && setDeactivateTarget(null)}
        title="停用材料模板"
        description={
          <>
            确定停用“{deactivateTarget?.name}
            ”吗？停用后不能再从材料库选择，但已有项目和订单不受影响。
          </>
        }
        confirmLabel="确认停用"
        pending={busyId === deactivateTarget?.id}
        pendingLabel="正在停用…"
        error={notice.error ? notice.text : undefined}
        onConfirm={() => void confirmDeactivate()}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(value) => !value && setDeleteTarget(null)}
        title="删除材料模板"
        description={
          <>
            确定删除“{deleteTarget?.name}
            ”吗？这只会从材料选择库中移除，不会影响已经加入项目或订单的材料。
          </>
        }
        confirmLabel="确认删除"
        pending={busyId === deleteTarget?.id}
        pendingLabel="正在删除…"
        error={notice.error ? notice.text : undefined}
        onConfirm={() => void remove()}
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
