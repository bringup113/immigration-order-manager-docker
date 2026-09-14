"use client";

import {
  Archive,
  Download,
  Eye,
  FileText,
  History,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/data-state";
import { Button } from "@/components/ui/button";

export type MaterialRow = Record<string, string | number | boolean | null>;

type Props = {
  materials: MaterialRow[];
  files: MaterialRow[];
  uploadingMaterialId: string;
  onAdd: () => void;
  onEdit: (material: MaterialRow) => void;
  onDelete: (material: MaterialRow) => void;
  onUpload: (materialId: string, file?: File) => void;
  onReplace: (fileId: string, storedName: string, file?: File) => void;
  onPreview: (file: MaterialRow) => void;
  onVoidFile: (fileId: string, storedName: string, version: number) => void;
  onRestoreFile: (fileId: string, storedName: string, version: number) => void;
  canEdit?: boolean;
  canRestore?: boolean;
  canDownload?: boolean;
};

const MATERIAL_FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

export function OrderMaterialList({
  materials,
  files,
  uploadingMaterialId,
  onAdd,
  onEdit,
  onDelete,
  onUpload,
  onReplace,
  onPreview,
  onVoidFile,
  onRestoreFile,
  canEdit,
  canRestore,
  canDownload,
}: Props) {
  const [ownPermissions, setOwnPermissions] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setOwnPermissions(data?.permissions || []))
      .catch(() => undefined);
  }, []);
  const has = (permission: string) =>
    ownPermissions.includes("*") || ownPermissions.includes(permission);
  const allowEdit = canEdit ?? has("materials.write");
  const allowRestore = canRestore ?? has("materials.restore");
  const allowDownload = canDownload ?? has("materials.download");
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-xs leading-5 text-slate-500">
          支持 PDF、JPG/JPEG、PNG、WEBP，单个文件最大 20
          MB。文件按归属对象、材料分目录并自动规范命名。
        </p>
        {allowEdit && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus size={14} /> 增加材料
          </Button>
        )}
      </div>
      {materials.length === 0 ? (
        <EmptyState
          title="暂无所需材料"
          description="可以为当前对象增加专属材料。"
        />
      ) : (
        <div className="space-y-3">
          {materials.map((row) => {
            const materialId = String(row.id);
            const materialFiles = files.filter(
              (file) => file.material_id === row.id,
            );
            const activeFiles = materialFiles.filter(
              (file) => !file.status || file.status === "ACTIVE",
            );
            const historicalFiles = materialFiles.filter(
              (file) => file.status && file.status !== "ACTIVE",
            );
            const visibleFiles = historyOpen[materialId]
              ? materialFiles
              : activeFiles;
            const inputId = `material-file-${materialId}`;
            return (
              <div key={materialId} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {String(row.name)}
                    {Boolean(row.required) && (
                      <span className="ml-1 text-rose-500">*</span>
                    )}
                    {row.system_code && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] text-teal-700">
                        <LockKeyhole size={10} />
                        系统固定
                      </span>
                    )}
                  </span>
                  {row.expected_date && (
                    <span className="text-xs text-slate-400">
                      预计 {String(row.expected_date)}
                    </span>
                  )}
                  {allowEdit && (
                    <>
                      {!row.system_code && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onEdit(row)}
                            title="修改材料"
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(row)}
                            title="删除材料"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                      <label
                        htmlFor={inputId}
                        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-white px-3 text-xs font-medium hover:bg-slate-50 ${uploadingMaterialId === materialId ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <Upload size={14} />
                        {uploadingMaterialId === materialId
                          ? "上传中…"
                          : "上传文件"}
                      </label>
                      <input
                        id={inputId}
                        className="hidden"
                        type="file"
                        accept={MATERIAL_FILE_ACCEPT}
                        disabled={uploadingMaterialId === materialId}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          onUpload(materialId, file);
                        }}
                      />
                    </>
                  )}
                </div>
                {row.notes && (
                  <p className="mt-2 text-xs text-slate-500">
                    {String(row.notes)}
                  </p>
                )}
                {(activeFiles.length > 0 || historicalFiles.length > 0) && (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    {historicalFiles.length > 0 && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setHistoryOpen((current) => ({
                              ...current,
                              [materialId]: !current[materialId],
                            }))
                          }
                        >
                          <History size={14} />
                          {historyOpen[materialId]
                            ? "隐藏历史文件"
                            : `查看历史文件（${historicalFiles.length}）`}
                        </Button>
                      </div>
                    )}
                    {visibleFiles.length === 0 && (
                      <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                        当前没有有效文件，可上传新文件或从历史中恢复。
                      </p>
                    )}
                    {visibleFiles.map((file) => {
                      const active = !file.status || file.status === "ACTIVE";
                      const replaceInputId = `replace-file-${String(file.id)}`;
                      return (
                        <div
                          key={String(file.id)}
                          className={`flex items-center gap-2 rounded-lg p-2.5 ${active ? "bg-slate-50" : "border border-dashed bg-slate-50/50 text-slate-500"}`}
                        >
                          <FileText
                            size={16}
                            className="shrink-0 text-teal-700"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-xs font-medium">
                                {String(file.stored_name)}
                              </p>
                              {!active && (
                                <span className="rounded-full border px-2 py-0.5 text-[10px]">
                                  {file.status === "SUPERSEDED"
                                    ? "已被替换"
                                    : "已作废"}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400">
                              {formatFileSize(Number(file.size_bytes))} ·{" "}
                              {String(file.uploaded_at).slice(0, 10)}
                            </p>
                            {file.status_reason && (
                              <p className="mt-1 text-[10px] text-slate-500">
                                原因：{String(file.status_reason)}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onPreview(file)}
                            title="预览文件"
                          >
                            <Eye size={15} />
                          </Button>
                          {allowDownload && (
                            <Button asChild variant="ghost" size="icon">
                              <a
                                href={`/api/material-files/${encodeURIComponent(String(file.id))}?download=1`}
                                title="下载文件"
                              >
                                <Download size={15} />
                              </a>
                            </Button>
                          )}
                          {allowEdit && active && (
                            <>
                              <label
                                htmlFor={replaceInputId}
                                className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100 ${uploadingMaterialId === String(file.id) ? "pointer-events-none opacity-50" : ""}`}
                                title="替换此文件"
                              >
                                <Upload size={15} />
                              </label>
                              <input
                                id={replaceInputId}
                                className="hidden"
                                type="file"
                                accept={MATERIAL_FILE_ACCEPT}
                                disabled={
                                  uploadingMaterialId === String(file.id)
                                }
                                onChange={(event) => {
                                  const replacement = event.target.files?.[0];
                                  event.target.value = "";
                                  onReplace(
                                    String(file.id),
                                    String(file.stored_name),
                                    replacement,
                                  );
                                }}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  onVoidFile(
                                    String(file.id),
                                    String(file.stored_name),
                                    Number(file.version || 1),
                                  )
                                }
                                title="作废文件"
                              >
                                <Archive size={15} />
                              </Button>
                            </>
                          )}
                          {allowRestore && !active && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                onRestoreFile(
                                  String(file.id),
                                  String(file.stored_name),
                                  Number(file.version || 1),
                                )
                              }
                              title="恢复文件"
                            >
                              <RotateCcw size={15} />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
