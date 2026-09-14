"use client";

import { Plus, Power, PowerOff, Save } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/components/data-state";
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
import { apiPost, useApiList } from "@/lib/use-api";
import { usePermissions } from "@/lib/use-permissions";

type Rate = {
  currency: string;
  name: string;
  rate_per_usd: number;
  updated_at: string;
  active: number;
};

export default function CurrenciesPage() {
  const rates = useApiList<Rate>("rates");
  const can = usePermissions();
  const [drafts, setDrafts] = useState<
    Record<string, { name: string; rate: string }>
  >({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newRate, setNewRate] = useState({ currency: "", name: "", rate: "" });
  const [saving, setSaving] = useState("");
  const [notice, setNotice] = useState({ text: "", error: false });
  const [deactivateTarget, setDeactivateTarget] = useState<Rate | null>(null);
  const draft = (row: Rate) =>
    drafts[row.currency] ?? { name: row.name, rate: String(row.rate_per_usd) };
  const patchDraft = (
    row: Rate,
    patch: Partial<{ name: string; rate: string }>,
  ) =>
    setDrafts((current) => ({
      ...current,
      [row.currency]: {
        ...(current[row.currency] ?? {
          name: row.name,
          rate: String(row.rate_per_usd),
        }),
        ...patch,
      },
    }));

  async function run(
    currency: string,
    task: () => Promise<unknown>,
    success: string,
  ) {
    setSaving(currency);
    setNotice({ text: "", error: false });
    try {
      await task();
      await rates.reload();
      setNotice({ text: success, error: false });
      return true;
    } catch (reason) {
      setNotice({
        text: reason instanceof Error ? reason.message : "保存失败",
        error: true,
      });
      return false;
    } finally {
      setSaving("");
    }
  }
  async function save(row: Rate) {
    const value = draft(row);
    await run(
      row.currency,
      () =>
        apiPost("rates", {
          action: "save",
          currency: row.currency,
          name: value.name,
          ratePerUsd: row.currency === "USD" ? 1 : value.rate,
        }),
      `${row.currency} 已更新；历史订单和收付款记录保留原汇率快照。`,
    );
  }
  async function toggle(row: Rate) {
    if (row.active) {
      setNotice({ text: "", error: false });
      setDeactivateTarget(row);
      return;
    }
    await run(
      row.currency,
      () => apiPost("rates", { action: "activate", currency: row.currency }),
      `${row.currency} 已重新启用。`,
    );
  }
  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    const ok = await run(
      deactivateTarget.currency,
      () =>
        apiPost("rates", {
          action: "deactivate",
          currency: deactivateTarget.currency,
        }),
      `${deactivateTarget.currency} 已停用。`,
    );
    if (ok) setDeactivateTarget(null);
  }
  async function create() {
    const currency = newRate.currency.trim().toUpperCase();
    const ok = await run(
      currency || "new",
      () =>
        apiPost("rates", {
          action: "create",
          currency,
          name: newRate.name,
          ratePerUsd: newRate.rate,
        }),
      `${currency} 已新增，可立即用于项目、订单和收付款记录。`,
    );
    if (ok) {
      setCreateOpen(false);
      setNewRate({ currency: "", name: "", rate: "" });
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="系统设置"
        title="币种与参考汇率"
        description="以 USD 为本位币；金额使用整数分保存，每次收付款保留当时的汇率快照"
        action={
          can("currencies.write") ? (
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-[#0f766e]"
            >
              <Plus size={16} /> 新增币种
            </Button>
          ) : undefined
        }
      />
      <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <b>汇率口径：</b>填写“1 USD
        可以兑换多少目标币种”。修改参考汇率不会改变历史订单或历史收付款记录。
      </div>
      {notice.text && (
        <p
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${notice.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
        >
          {notice.text}
        </p>
      )}
      {rates.error ? (
        <ErrorState message={rates.error} />
      ) : rates.loading ? (
        <LoadingState />
      ) : (
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="table-head">
                  <th>币种</th>
                  <th>名称</th>
                  <th>1 USD 对应单位</th>
                  <th>状态</th>
                  <th>最后更新</th>
                  {can("currencies.write") && <th></th>}
                </tr>
              </thead>
              <tbody>
                {rates.rows.map((row) => (
                  <tr
                    className={`table-row ${row.active ? "" : "opacity-60"}`}
                    key={row.currency}
                  >
                    <td className="font-semibold">{row.currency}</td>
                    <td>
                      <Input
                        className="min-w-[180px]"
                        disabled={!can("currencies.write") || !row.active}
                        value={draft(row).name}
                        onChange={(event) =>
                          patchDraft(row, { name: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <Input
                        className="max-w-[220px]"
                        disabled={
                          !can("currencies.write") ||
                          row.currency === "USD" ||
                          !row.active
                        }
                        type="number"
                        min="0.00000001"
                        step="0.00000001"
                        value={draft(row).rate}
                        onChange={(event) =>
                          patchDraft(row, { rate: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <Badge
                        variant="outline"
                        className={`status ${row.active ? "green" : "amber"}`}
                      >
                        {row.active ? "启用" : "停用"}
                      </Badge>
                    </td>
                    <td>{row.updated_at.slice(0, 10)}</td>
                    {can("currencies.write") && (
                      <td>
                        <div className="flex justify-end gap-2">
                          {row.active && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                saving === row.currency ||
                                !draft(row).name.trim()
                              }
                              onClick={() => save(row)}
                            >
                              <Save size={15} /> 保存
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              saving === row.currency || row.currency === "USD"
                            }
                            onClick={() => toggle(row)}
                          >
                            {row.active ? (
                              <>
                                <PowerOff size={15} /> 停用
                              </>
                            ) : (
                              <>
                                <Power size={15} /> 启用
                              </>
                            )}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增币种</DialogTitle>
            <DialogDescription>
              使用三位国际币种代码，并填写相对于 USD 的当前参考汇率。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="币种代码">
              <Input
                className="mt-2 uppercase"
                maxLength={3}
                value={newRate.currency}
                onChange={(event) =>
                  setNewRate({
                    ...newRate,
                    currency: event.target.value
                      .replace(/[^a-zA-Z]/g, "")
                      .toUpperCase(),
                  })
                }
                placeholder="例如 THB"
              />
            </Field>
            <Field label="币种名称">
              <Input
                className="mt-2"
                value={newRate.name}
                onChange={(event) =>
                  setNewRate({ ...newRate, name: event.target.value })
                }
                placeholder="例如 泰铢"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="1 USD 对应单位">
                <Input
                  className="mt-2"
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={newRate.rate}
                  onChange={(event) =>
                    setNewRate({ ...newRate, rate: event.target.value })
                  }
                  placeholder="例如 34.50"
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                Boolean(saving) ||
                newRate.currency.length !== 3 ||
                !newRate.name.trim() ||
                Number(newRate.rate) <= 0
              }
              onClick={create}
              className="bg-[#0f766e]"
            >
              {saving ? "正在保存…" : "保存币种"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title="停用币种"
        description={
          <>
            确定停用 {deactivateTarget?.currency}（{deactivateTarget?.name}
            ）吗？历史订单和收付款记录不受影响，但新数据不能再选择该币种。
          </>
        }
        confirmLabel="确认停用"
        pending={saving === deactivateTarget?.currency}
        pendingLabel="正在停用…"
        error={notice.error ? notice.text : undefined}
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
