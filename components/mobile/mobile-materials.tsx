"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Camera, Eye, FileUp, Images, ScanLine } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImagePreview } from "@/components/image-preview";
import type { Row } from "@/components/order-detail-ui";
import { MobileMessage } from "@/components/mobile/mobile-states";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiRequestError, fetchApiJson } from "@/lib/api-client";
import { describeMrzChecksum, type PassportIdentity, type PassportMrzCapture } from "@/lib/passport-mrz";
import { useMobileOrderMutation } from "@/hooks/use-mobile-order-mutation";

const imageTypes = "image/jpeg,image/png,image/webp";
const acceptedTypes = `${imageTypes},application/pdf`;
const maxFileSize = 20 * 1024 * 1024;

type Review = {
  applicantId: string;
  materialFileId: string;
  storedName: string;
  mimeType: string;
  capture: PassportMrzCapture;
  fields: PassportIdentity;
  initialFields: PassportIdentity;
};

type Props = {
  orderNo: string;
  version: number;
  applicants: Row[];
  materials: Row[];
  files: Row[];
  canWrite: boolean;
  canMrz: boolean;
  readPending: boolean;
  onReload: () => void;
  common?: boolean;
};

function text(row: Row, key: string) { return String(row[key] ?? ""); }
function activeFiles(files: Row[], materialId: string) {
  return files.filter((file) => text(file, "material_id") === materialId && (!file.status || file.status === "ACTIVE"));
}

function validateFile(file: File) {
  if (!file.size) return "不能上传空文件。";
  if (file.size > maxFileSize) return "单个文件不能超过 20 MB。";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["jpg", "jpeg", "png", "webp", "pdf"].includes(extension || ""))
    return "仅支持 PDF、JPG/JPEG、PNG 和 WEBP；手机拍照若生成 HEIC，请先转换为 JPEG。";
  return "";
}

export function MobileMaterials({ orderNo, version, applicants, materials, files, canWrite, canMrz, readPending, onReload, common = false }: Props) {
  const [preview, setPreview] = useState<Row | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [discardReview, setDiscardReview] = useState(false);
  const [uploading, setUploading] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadUncertain, setUploadUncertain] = useState(false);
  const [selectedApplicantId, setSelectedApplicantId] = useState("");
  const [uploadTarget, setUploadTarget] = useState<{ material: Row; sectionName: string } | null>(null);
  const uploadInFlight = useRef(false);
  const mutation = useMobileOrderMutation(orderNo, version, readPending, onReload);
  const sections = common
    ? [{ id: "", name: "合同与付款", materials: materials.filter((item) => !item.applicant_id) }]
    : applicants.map((applicant) => ({ id: text(applicant, "id"), name: text(applicant, "name") || "未填写姓名", materials: materials.filter((item) => text(item, "applicant_id") === text(applicant, "id")) }));
  const activeApplicantId = common
    ? ""
    : sections.some((section) => section.id === selectedApplicantId)
      ? selectedApplicantId
      : sections[0]?.id ?? "";
  const visibleSections = common
    ? sections
    : sections.filter((section) => section.id === activeApplicantId);

  async function scanPassport(file: File, applicantId: string, materialFileId: string, storedName: string, mimeType: string) {
    setScanning(true);
    setError("");
    try {
      // PDF parsing and the MRZ parser are loaded only when the user scans a passport.
      const { recognizePassportFile } = await import("@/lib/passport-mrz");
      const capture = await recognizePassportFile(file);
      const current = applicants.find((item) => text(item, "id") === applicantId);
      const fields = { ...capture.fields, name: text(current ?? {}, "name").trim() || capture.fields.name };
      setReview({ applicantId, materialFileId, storedName, mimeType, capture,
        fields, initialFields: { ...fields } });
      setReviewChecked(false);
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : "MRZ 识别失败。"} 文件已保留，可人工填写申请人资料。`);
    } finally { setScanning(false); }
  }

  async function upload(material: Row, file?: File) {
    if (!file || !canWrite || readPending || uploading || uploadUncertain || uploadInFlight.current) return;
    const invalid = validateFile(file);
    if (invalid) { setError(invalid); return; }
    uploadInFlight.current = true;
    const materialId = text(material, "id");
    setUploading(materialId);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("orderNo", orderNo);
      form.set("materialId", materialId);
      form.set("file", file);
      const saved = await fetchApiJson<{ id: string; storedName: string }>("/api/material-files", { method: "POST", body: form });
      setNotice("文件已上传并归档。护照识别结果仍需人工确认。");
      onReload();
      if (material.system_code === "PASSPORT_BIO_PAGE" && material.applicant_id && canMrz)
        await scanPassport(file, text(material, "applicant_id"), saved.id, saved.storedName, file.type);
    } catch (reason) {
      if (!(reason instanceof ApiRequestError)) {
        setUploadUncertain(true);
        setError("无法确认文件是否上传成功。已刷新材料列表，请先核对，再决定是否重新上传；系统不会自动重试。");
        onReload();
      } else setError(reason.message);
    } finally { uploadInFlight.current = false; setUploading(""); }
  }

  async function scanExisting(material: Row, file: Row) {
    if (!canMrz || readPending || scanning) return;
    setScanning(true);
    setError("");
    try {
      const response = await fetch(`/api/material-files/${encodeURIComponent(text(file, "id"))}`, { cache: "no-store" });
      if (!response.ok) throw new Error("读取护照首页失败。");
      const blob = await response.blob();
      const image = new File([blob], text(file, "stored_name"), { type: text(file, "mime_type") });
      await scanPassport(image, text(material, "applicant_id"), text(file, "id"), text(file, "stored_name"), text(file, "mime_type"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取护照首页失败。");
    } finally { setScanning(false); }
  }

  function updateField(key: keyof PassportIdentity, value: string) {
    if (!review) return;
    setReview({ ...review, fields: { ...review.fields, [key]: value } });
    setReviewChecked(false);
  }

  function confirm() {
    if (!review || !reviewChecked) return;
    void mutation.submit({ action: "confirmMrz", applicantId: review.applicantId, materialFileId: review.materialFileId,
      rawMrz: review.capture.rawMrz, fields: review.fields }, {
      successMessage: review.capture.valid ? "护照资料已登记，MRZ 校验通过。" : "护照资料已按人工核对结果登记。",
      onSuccess: () => { setReview(null); setReviewChecked(false); },
    });
  }

  const reviewDirty = Boolean(review && (reviewChecked || JSON.stringify(review.fields) !== JSON.stringify(review.initialFields)));

  function closeReview() {
    if (mutation.pending) return;
    if (reviewDirty) setDiscardReview(true);
    else { setReview(null); setReviewChecked(false); }
  }

  function selectUploadFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    const target = uploadTarget;
    setUploadTarget(null);
    if (target) void upload(target.material, selected);
  }

  return <div className="space-y-3">
    <p className="px-1 text-xs leading-5 text-slate-500">
      支持 PDF、JPG/JPEG、PNG、WEBP，单个文件最多 20 MB。上传后按申请人与材料归档；
      相机生成 HEIC 时请转换为 JPEG。
    </p>
    {notice && <MobileMessage>{notice}</MobileMessage>}
    {error && <MobileMessage tone="error">{error}</MobileMessage>}
    {uploadUncertain && <button type="button" className="text-sm font-semibold text-teal-700 underline"
      onClick={() => { setUploadUncertain(false); setError(""); }}>
      已核对材料列表，继续操作
    </button>}
    {mutation.notice && <MobileMessage>{mutation.notice}</MobileMessage>}
    {mutation.error && <MobileMessage tone="error">{mutation.error}</MobileMessage>}
    {mutation.uncertain && <button type="button" className="text-sm font-semibold text-teal-700 underline"
      onClick={mutation.acknowledge}>已核对申请人资料，继续操作</button>}
    {!sections.length && <MobileMessage>暂无申请人；请先在电脑端建立申请人。</MobileMessage>}
    {!common && sections.length > 1 && <div role="tablist" aria-label="选择申请人"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {sections.map((section) => {
        const active = section.id === activeApplicantId;
        const isMain = applicants.find((item) => text(item, "id") === section.id)?.applicant_type === "MAIN";
        return <button key={section.id} type="button" role="tab" aria-selected={active}
          onClick={() => setSelectedApplicantId(section.id)}
          className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active
            ? "bg-teal-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
          {section.name}{isMain ? " · 主申请人" : ""}
        </button>;
      })}
    </div>}
    {visibleSections.map((section) => <section key={section.id || "common"}
      className="overflow-hidden rounded-2xl bg-white">
      <div className="border-b border-slate-100 px-4 py-4">
        <h2 className="font-semibold text-slate-900">
          {section.name}
          {!common && <span className="ml-2 text-xs font-normal text-slate-500">
            {applicants.find((item) => text(item, "id") === section.id)?.applicant_type === "MAIN"
              ? "主申请人" : "附属申请人"}
          </span>}
        </h2>
      </div>
      {section.materials.length ? <div>
        {section.materials.map((material) => {
          const materialId = text(material, "id");
          const currentFiles = activeFiles(files, materialId);
          const disabled = Boolean(uploading) || readPending || uploadUncertain;
          return <div key={materialId} className="border-t border-slate-100 px-4 py-3 first:border-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {text(material, "name")}
                  {Boolean(material.required) && <span className="ml-1 text-rose-600">*</span>}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {currentFiles.length ? `已上传 ${currentFiles.length} 个文件` : "待上传"}
                </p>
              </div>
              {canWrite && <button type="button" disabled={disabled}
                aria-label={`${section.name} ${text(material, "name")} 上传材料`}
                onClick={() => setUploadTarget({ material, sectionName: section.name })}
                className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-3 py-2 text-xs font-semibold text-teal-700 disabled:opacity-50">
                <FileUp size={15} />上传
              </button>}
            </div>
            {uploading === materialId && <p role="status" className="mt-2 text-xs text-teal-700">上传中…</p>}
            {currentFiles.map((file) => <div key={text(file, "id")}
              className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-slate-600">{text(file, "stored_name")}</span>
              <button type="button" onClick={() => setPreview(file)}
                className="flex min-h-11 shrink-0 items-center gap-1 px-1 font-semibold text-teal-700">
                <Eye size={14} />预览
              </button>
              {canMrz && material.system_code === "PASSPORT_BIO_PAGE" && <button type="button"
                disabled={scanning || readPending} onClick={() => void scanExisting(material, file)}
                className="flex min-h-11 shrink-0 items-center gap-1 px-1 font-semibold text-teal-700 disabled:opacity-50">
                <ScanLine size={14} />识别
              </button>}
            </div>)}
          </div>;
        })}
      </div> : <p className="px-4 py-5 text-sm text-slate-500">暂无所需材料。材料要求请在电脑端维护。</p>}
    </section>)}
    {scanning && <MobileMessage>正在识别护照 MRZ，请稍候…</MobileMessage>}
    <Dialog open={Boolean(uploadTarget)} onOpenChange={(open) => { if (!open && !uploading) setUploadTarget(null); }}>
      <DialogContent className="!bottom-0 !top-auto !w-full !max-w-[520px] !translate-y-0 rounded-b-none rounded-t-3xl p-5">
        <DialogHeader>
          <DialogTitle>上传{text(uploadTarget?.material ?? {}, "name")}</DialogTitle>
          <DialogDescription>选择手机上的材料来源。拍照与相册仅接受图片，选文件也支持 PDF。</DialogDescription>
        </DialogHeader>
        {uploadTarget && <div className="grid gap-3">
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 font-semibold text-slate-800">
            <Camera size={20} className="text-teal-700" />立即拍照
            <input aria-label={`${uploadTarget.sectionName} ${text(uploadTarget.material, "name")} 拍照上传`}
              className="sr-only" type="file" accept={imageTypes} capture="environment" onChange={selectUploadFile} />
          </label>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 font-semibold text-slate-800">
            <Images size={20} className="text-teal-700" />从相册选择
            <input aria-label={`${uploadTarget.sectionName} ${text(uploadTarget.material, "name")} 从相册上传`}
              className="sr-only" type="file" accept={imageTypes} onChange={selectUploadFile} />
          </label>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 font-semibold text-slate-800">
            <FileUp size={20} className="text-teal-700" />选择文件
            <input aria-label={`${uploadTarget.sectionName} ${text(uploadTarget.material, "name")} 选择文件上传`}
              className="sr-only" type="file" accept={acceptedTypes} onChange={selectUploadFile} />
          </label>
        </div>}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <DialogContent className="flex h-[90dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col p-3 sm:p-5">
        <DialogHeader>
          <DialogTitle className="pr-6 text-sm">{text(preview ?? {}, "stored_name")}</DialogTitle>
          <DialogDescription>仅供预览；无下载权限的账号不会显示下载操作。</DialogDescription>
        </DialogHeader>
        {preview && (text(preview, "mime_type").startsWith("image/")
          ? <div className="min-h-0 flex-1">
            <ImagePreview src={`/api/material-files/${encodeURIComponent(text(preview, "id"))}`}
              alt={text(preview, "stored_name")} />
          </div>
          : <iframe className="min-h-0 w-full flex-1 rounded-lg border"
            src={`/api/material-files/${encodeURIComponent(text(preview, "id"))}#toolbar=0`}
            title={`预览 ${text(preview, "stored_name")}`} />)}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(review)} onOpenChange={(open) => { if (!open) closeReview(); }}>
      <DialogContent className="!left-0 !top-0 !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-y-auto !rounded-none px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <DialogHeader>
          <DialogTitle>核对护照识别结果</DialogTitle>
          <DialogDescription>识别只是辅助。请逐项对照护照原件，确认后才会修改申请人资料。</DialogDescription>
        </DialogHeader>
        {review && <div className="space-y-4">
          <p className={`rounded-lg p-3 text-sm ${review.capture.valid
            ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>
            {review.capture.valid ? "MRZ 校验通过，仍需人工核对。" : "MRZ 有校验项未通过，必须仔细人工核对。"}
            {review.capture.formatWarning && ` ${review.capture.formatWarning}`}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              ["name", "系统显示姓名"], ["surname", "护照姓"], ["givenNames", "护照名"],
              ["passportNo", "护照号码"], ["nationality", "国籍"], ["birthDate", "出生日期"],
              ["passportExpiry", "护照有效期"], ["issuingCountry", "签发国家/地区"],
              ["documentCode", "证件类型"], ["personalNumber", "个人号码/可选数据"],
            ] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-slate-600">
              {label}
              <input className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900"
                type={key === "birthDate" || key === "passportExpiry" ? "date" : "text"}
                value={review.fields[key]} onChange={(event) => updateField(key, event.target.value)} />
            </label>)}
            <label className="text-xs font-medium text-slate-600">
              性别
              <select className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={review.fields.sex} onChange={(event) => updateField("sex", event.target.value)}>
                <option value="">未填写</option><option value="M">男</option>
                <option value="F">女</option><option value="X">未指定</option>
              </select>
            </label>
          </div>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">原始 MRZ 与校验位</summary>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-slate-100">
              {review.capture.rawMrz}
            </pre>
            <div className="mt-3 space-y-1">
              {Object.entries(review.capture.checksums).map(([key, passed]) => <p key={key}
                className={passed ? "text-teal-700" : "text-rose-700"}>
                {passed ? "✓" : "✕"} {describeMrzChecksum(key)}{passed ? "通过" : "未通过"}
              </p>)}
            </div>
          </details>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">对照已上传护照文件</summary>
            {review.mimeType.startsWith("image/")
              ? <div className="mt-3 h-80"><ImagePreview
                src={`/api/material-files/${encodeURIComponent(review.materialFileId)}`}
                alt={review.storedName} /></div>
              : <iframe className="mt-3 h-80 w-full"
                src={`/api/material-files/${encodeURIComponent(review.materialFileId)}#toolbar=0`}
                title="护照文件预览" />}
          </details>
          <label className="flex min-h-11 items-center gap-3 text-xs text-slate-700">
            <input type="checkbox" checked={reviewChecked}
              onChange={(event) => setReviewChecked(event.target.checked)} className="size-5 shrink-0" />
            我已对照护照原件逐项核对上述资料
          </label>
          {mutation.error && <MobileMessage tone="error">{mutation.error}</MobileMessage>}
          {mutation.uncertain && <button type="button" className="text-sm font-semibold text-teal-700 underline"
            onClick={mutation.acknowledge}>已核对申请人资料，继续操作</button>}
          <button type="button" disabled={!reviewChecked || mutation.disabled || !review.fields.name.trim()
            || !review.fields.passportNo.trim() || !review.fields.nationality.trim()
            || !review.fields.birthDate || !review.fields.passportExpiry}
            onClick={confirm}
            className="w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {mutation.pending ? "保存中…" : "确认并登记"}
          </button>
        </div>}
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={discardReview} onOpenChange={setDiscardReview}
      title="放弃护照核对结果？" description="当前修改或核对状态尚未登记，关闭后需要重新识别和核对。"
      confirmLabel="放弃并关闭" destructive pending={false}
      onConfirm={() => { setDiscardReview(false); setReview(null); setReviewChecked(false); }} />
  </div>;
}
