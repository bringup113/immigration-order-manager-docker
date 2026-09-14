"use client";

import { Download, Upload } from "lucide-react";
import { ChangeEvent, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { usePermissions } from "@/lib/use-permissions";

type Preview = {
  summary: {
    projects: number;
    steps: number;
    plans: number;
    materials: number;
    channels: number;
    currencies: number;
  };
  projects: {
    code: string;
    name: string;
    exists: boolean;
    counts: {
      steps: number;
      plans: number;
      materials: number;
      channels: number;
    };
  }[];
  dependencies: {
    missingChannels: string[];
    reusedChannels: string[];
    missingCurrencies: string[];
    reusedCurrencies: string[];
  };
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const summaryLabels: Record<string, string> = {
  projects: "项目",
  steps: "流程",
  plans: "收付款",
  materials: "材料",
  channels: "渠道",
  currencies: "币种",
};

async function responseError(response: Response, fallback: string) {
  const result = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return result?.error || fallback;
}

export function ProjectPackageActions({
  projectId,
  onImported,
}: {
  projectId?: string;
  onImported?: () => void | Promise<void>;
}) {
  const can = usePermissions();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [bundle, setBundle] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [strategies, setStrategies] = useState<Record<string, string>>({});
  const [copyCodes, setCopyCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const conflicts = preview?.projects.filter((item) => item.exists) || [];
  const ready = Boolean(
    preview &&
      conflicts.every((item) => {
        const strategy = strategies[item.code];
        return (
          strategy === "OVERWRITE" ||
          (strategy === "COPY" &&
            /^[A-Z0-9_-]{2,40}$/.test(
              (copyCodes[item.code] || "").trim().toUpperCase(),
            ))
        );
      }),
  );
  const hasOverwrite = conflicts.some(
    (item) => strategies[item.code] === "OVERWRITE",
  );

  function reset() {
    setFileName("");
    setBundle(null);
    setPreview(null);
    setStrategies({});
    setCopyCodes({});
    setMessage("");
    setError("");
    setBusy(false);
    setConfirmOpen(false);
  }

  async function exportPackage() {
    setExporting(true);
    setError("");
    try {
      const query = projectId
        ? `?projectId=${encodeURIComponent(projectId)}`
        : "";
      const response = await fetch(`/api/projects/export${query}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(await responseError(response, "项目包导出失败。"));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const name =
        disposition.match(/filename="([^"]+)"/)?.[1] ||
        `MIGRA-projects-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目包导出失败。");
    } finally {
      setExporting(false);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setBundle(null);
    setMessage("");
    setError("");
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setError("项目包不能超过 5 MB。");
      return;
    }
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", package: parsed }),
      });
      if (!response.ok)
        throw new Error(await responseError(response, "项目包预检失败。"));
      const result = (await response.json()) as Preview;
      setBundle(parsed);
      setPreview(result);
      setStrategies(
        Object.fromEntries(
          result.projects
            .filter((item) => item.exists)
            .map((item) => [item.code, "UNDECIDED"]),
        ),
      );
      setCopyCodes(
        Object.fromEntries(
          result.projects
            .filter((item) => item.exists)
            .map((item) => [item.code, `${item.code}_COPY`]),
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof SyntaxError
          ? "文件不是有效的 JSON 项目包。"
          : reason instanceof Error
            ? reason.message
            : "项目包预检失败。",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function commit() {
    if (!bundle || !ready) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          package: bundle,
          conflicts: strategies,
          copyCodes,
        }),
      });
      if (!response.ok)
        throw new Error(await responseError(response, "项目包导入失败。"));
      const result = (await response.json()) as {
        imported: { targetCode: string }[];
      };
      setMessage(
        `已成功导入 ${result.imported.length} 个项目：${result.imported.map((item) => item.targetCode).join("、")}`,
      );
      setBundle(null);
      setPreview(null);
      setFileName("");
      await onImported?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目包导入失败。");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && !open && (
          <span className="max-w-64 text-xs text-rose-700">{error}</span>
        )}
        {can("projects.export") && (
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => void exportPackage()}
          >
            <Download size={16} />
            {exporting ? "正在导出…" : projectId ? "导出项目" : "导出全部"}
          </Button>
        )}
        {!projectId && can("projects.import") && (
          <Button
            variant="outline"
            onClick={() => {
              reset();
              setOpen(true);
            }}
          >
            <Upload size={16} /> 导入项目
          </Button>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            if (!value) reset();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>导入项目包</DialogTitle>
            <DialogDescription>
              先预检项目、模板及依赖；导入不会修改任何已有订单。
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="project-package">选择 JSON 项目包</Label>
            <Input
              id="project-package"
              className="mt-2"
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => void chooseFile(event)}
            />
            {fileName && (
              <p className="mt-2 text-xs text-slate-500">{fileName}</p>
            )}
          </div>
          {busy && !preview && (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
              正在检查项目包…
            </p>
          )}
          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {message}
            </p>
          )}
          {preview && (
            <>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {Object.entries(preview.summary).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-xl bg-slate-50 p-3 text-center"
                  >
                    <b className="block text-lg">{value}</b>
                    <span className="text-xs text-slate-500">
                      {summaryLabels[key]}
                    </span>
                  </div>
                ))}
              </div>
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">项目处理方式</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    没有冲突的项目会直接新建；简称重复时必须明确选择。
                  </p>
                </div>
                {preview.projects.map((item) => (
                  <div key={item.code} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <b>{item.name}</b>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.code} · 流程 {item.counts.steps} · 收付款{" "}
                          {item.counts.plans} · 材料 {item.counts.materials} ·
                          渠道 {item.counts.channels}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          item.exists ? "status amber" : "status green"
                        }
                      >
                        {item.exists ? "简称已存在" : "新建"}
                      </Badge>
                    </div>
                    {item.exists && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Select
                          value={strategies[item.code] || "UNDECIDED"}
                          onValueChange={(value) =>
                            setStrategies((current) => ({
                              ...current,
                              [item.code]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UNDECIDED">
                              请选择处理方式
                            </SelectItem>
                            <SelectItem value="COPY">另存为新项目</SelectItem>
                            <SelectItem value="OVERWRITE">
                              覆盖现有项目模板
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {strategies[item.code] === "COPY" && (
                          <Input
                            value={copyCodes[item.code] || ""}
                            onChange={(event) =>
                              setCopyCodes((current) => ({
                                ...current,
                                [item.code]: event.target.value.toUpperCase(),
                              }))
                            }
                            placeholder="新的项目简称"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </section>
              <section className="rounded-xl border bg-slate-50 p-4 text-xs text-slate-600">
                <b className="text-sm text-slate-800">依赖处理</b>
                <p className="mt-2">
                  新增渠道：
                  {preview.dependencies.missingChannels.join("、") || "无"}
                  ；复用渠道：
                  {preview.dependencies.reusedChannels.join("、") || "无"}
                </p>
                <p className="mt-1">
                  新增币种：
                  {preview.dependencies.missingCurrencies.join("、") || "无"}
                  ；复用币种：
                  {preview.dependencies.reusedCurrencies.join("、") || "无"}
                </p>
                <p className="mt-2 text-slate-500">
                  复用现有渠道和币种时不会覆盖本地资料或当前汇率。
                </p>
              </section>
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              关闭
            </Button>
            {preview && (
              <Button
                className="bg-[#0f766e]"
                disabled={!ready || busy}
                onClick={() =>
                  hasOverwrite ? setConfirmOpen(true) : void commit()
                }
              >
                {busy ? "正在导入…" : "确认导入"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="覆盖现有项目模板"
        description="覆盖会替换所选项目的渠道关联、流程、收付款和材料模板，但不会修改已经创建的订单。确定继续吗？"
        confirmLabel="确认覆盖并导入"
        pending={busy}
        pendingLabel="正在导入…"
        onConfirm={() => void commit()}
      />
    </>
  );
}
