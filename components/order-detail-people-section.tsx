"use client";

import {
  AlertTriangle,
  LoaderCircle,
  Pencil,
  Plus,
  ScanLine,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import {
  ApplicantMeta,
  OrderMaterialsPanel,
  Panel,
  type Row,
} from "@/components/order-detail-ui";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";

type MaterialHandlers = {
  onAdd: () => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
  onUpload: (materialId: string, file?: File) => void;
  onReplace: (fileId: string, storedName: string, file?: File) => void;
  onPreview: (file: Row) => void;
  onVoidFile: (fileId: string, storedName: string, version: number) => void;
  onRestoreFile: (fileId: string, storedName: string, version: number) => void;
};

type Props = {
  applicants: Row[];
  selectedApplicant: Row | null;
  applicantMaterials: Row[];
  materialFiles: Row[];
  uploadingMaterialId: string;
  fileNotice: { text: string; error: boolean };
  scanningPassport: boolean;
  canWriteApplicants: boolean;
  canScanMrz: boolean;
  canReadMaterials: boolean;
  canWriteMaterials: boolean;
  canRestoreMaterials: boolean;
  canDownloadMaterials: boolean;
  onAddApplicant: () => void;
  onSelectApplicant: (id: string) => void;
  onEditApplicant: (row: Row) => void;
  onDeleteApplicant: (row: Row) => void;
  onScanPassport: () => void;
  materialHandlers: MaterialHandlers;
};

function applicantType(row: Row) {
  return row.applicant_type === "MAIN"
    ? "主申请人"
    : `附属申请人 · ${row.relationship || "其他"}`;
}

function mrzSummary(row: Row) {
  if (row.mrz_status === "VALID") return "MRZ 已通过";
  if (row.mrz_status === "MANUALLY_CONFIRMED") return "MRZ 已人工确认";
  return "MRZ 待识别";
}

function sexLabel(value: Row[string]) {
  if (value === "M") return "男";
  if (value === "F") return "女";
  if (value === "X") return "未指定";
  return "未填写";
}

export function OrderDetailPeopleSection({
  applicants,
  selectedApplicant,
  applicantMaterials,
  materialFiles,
  uploadingMaterialId,
  fileNotice,
  scanningPassport,
  canWriteApplicants,
  canScanMrz,
  canReadMaterials,
  canWriteMaterials,
  canRestoreMaterials,
  canDownloadMaterials,
  onAddApplicant,
  onSelectApplicant,
  onEditApplicant,
  onDeleteApplicant,
  onScanPassport,
  materialHandlers,
}: Props) {
  return (
    <TabsContent value="people" className="m-0 p-5">
      <div
        className={`grid items-start gap-5 ${
          canReadMaterials
            ? "xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"
            : "xl:grid-cols-1"
        }`}
      >
        <Panel
          title="申请人"
          action={
            canWriteApplicants ? (
              <Button variant="outline" size="sm" onClick={onAddApplicant}>
                <Plus size={15} /> 添加附属申请人
              </Button>
            ) : null
          }
        >
          <div className="space-y-3">
            {applicants.map((row) => {
              const selected = selectedApplicant?.id === row.id;

              return (
                <div
                  key={String(row.id)}
                  className={`flex items-center gap-2 rounded-xl border p-2 transition-colors ${
                    selected
                      ? "border-teal-300 bg-teal-50 ring-1 ring-teal-200"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectApplicant(String(row.id))}
                    className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                        selected
                          ? "bg-teal-600 text-white"
                          : "bg-slate-100 text-teal-700"
                      }`}
                    >
                      <UsersRound size={18} />
                    </span>

                    <div className="min-w-0">
                      <b>{String(row.name)}</b>

                      <p className="truncate text-xs text-slate-500">
                        {applicantType(row)} ·{" "}
                        {String(row.nationality || "未填国籍")}
                      </p>

                      <p className="mt-1 truncate text-xs text-slate-500">
                        护照：{String(row.passport_no || "待补录")} ·{" "}
                        {mrzSummary(row)}
                      </p>
                    </div>
                  </button>

                  {canWriteApplicants && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="修改申请人资料"
                        onClick={() => onEditApplicant(row)}
                      >
                        <Pencil size={15} />
                      </Button>

                      {row.applicant_type === "DEPENDENT" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-rose-600"
                          title="删除附属申请人"
                          onClick={() => onDeleteApplicant(row)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {selectedApplicant && (
          <div className="min-w-0 space-y-5">
            {scanningPassport && (
              <div
                className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle
                  className="shrink-0 animate-spin text-blue-600"
                  size={22}
                />

                <div className="min-w-0">
                  <p className="font-medium">
                    正在识别护照 MRZ…
                  </p>

                  <p className="mt-0.5 text-xs text-blue-700">
                    护照文件已上传，正在提取姓名、护照号码、出生日期和有效期，请稍候。
                  </p>
                </div>
              </div>
            )}

            <Panel
              title="身份与护照资料"
              action={
                canScanMrz ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={scanningPassport}
                    onClick={onScanPassport}
                  >
                    {scanningPassport ? (
                      <LoaderCircle className="animate-spin" size={15} />
                    ) : (
                      <ScanLine size={15} />
                    )}{" "}
                    {scanningPassport ? "正在识别…" : "识别当前护照"}
                  </Button>
                ) : null
              }
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ApplicantMeta
                  label="系统显示姓名"
                  value={selectedApplicant.name}
                />

                <ApplicantMeta
                  label="护照英文姓名"
                  value={[
                    selectedApplicant.surname,
                    selectedApplicant.given_names,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />

                <ApplicantMeta
                  label="护照号码"
                  value={selectedApplicant.passport_no}
                />

                <ApplicantMeta
                  label="国籍"
                  value={selectedApplicant.nationality}
                />

                <ApplicantMeta
                  label="出生日期"
                  value={selectedApplicant.birth_date}
                />

                <ApplicantMeta
                  label="性别"
                  value={sexLabel(selectedApplicant.sex)}
                />

                <ApplicantMeta
                  label="护照有效期"
                  value={selectedApplicant.passport_expiry}
                />

                <ApplicantMeta
                  label="签发国家/地区"
                  value={selectedApplicant.issuing_country}
                />

                <ApplicantMeta
                  label="证件类型"
                  value={selectedApplicant.document_code}
                />
              </div>

              <div
                className={`mt-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                  selectedApplicant.mrz_status === "VALID"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : selectedApplicant.mrz_status === "MANUALLY_CONFIRMED"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {selectedApplicant.mrz_status === "VALID" ? (
                  <ShieldCheck size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}

                <span>
                  {selectedApplicant.mrz_status === "VALID"
                    ? "MRZ 全部校验位通过"
                    : selectedApplicant.mrz_status === "MANUALLY_CONFIRMED"
                      ? "MRZ 存在未通过项，资料已经人工确认"
                      : "尚未识别当前护照 MRZ"}
                </span>
              </div>
            </Panel>

            {canReadMaterials && (
              <OrderMaterialsPanel
                title={`${String(selectedApplicant.name)}的材料`}
                notice={fileNotice}
                materials={applicantMaterials}
                files={materialFiles}
                uploadingMaterialId={uploadingMaterialId}
                canEdit={canWriteMaterials}
                canRestore={canRestoreMaterials}
                canDownload={canDownloadMaterials}
                {...materialHandlers}
              />
            )}
          </div>
        )}
      </div>
    </TabsContent>
  );
}