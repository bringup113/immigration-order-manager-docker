import { useState } from "react";
import type { Row } from "@/components/order-detail-ui";
import type {
  ApplicantDraft,
  MaterialDraft,
  MrzReview,
  OrderDetailConfirmation,
  OrderDetailData,
  OrderDetailDialog,
} from "@/components/order-detail-types";
import {
  emptyPassportIdentity,
  recognizePassportFile,
} from "@/lib/passport-mrz";

type UseOrderPeopleMaterialsOptions = {
  orderNo: string;
  data: OrderDetailData | null;
  selectedApplicantId: string;
  permissions: string[];
  act: (payload: unknown) => Promise<void>;
  load: () => Promise<void>;
  setDialog: (dialog: OrderDetailDialog) => void;
  setMessage: (message: string) => void;
  askConfirmation: (confirmation: OrderDetailConfirmation) => void;
};

export function useOrderPeopleMaterials({
  orderNo,
  data,
  selectedApplicantId,
  permissions,
  act,
  load,
  setDialog,
  setMessage,
  askConfirmation,
}: UseOrderPeopleMaterialsOptions) {
  const [fileNotice, setFileNotice] = useState({ text: "", error: false });
  const [uploadingMaterialId, setUploadingMaterialId] = useState("");
  const [editingMaterialId, setEditingMaterialId] = useState("");
  const [editingApplicantId, setEditingApplicantId] = useState("");
  const [material, setMaterial] = useState<MaterialDraft>({
    applicantId: "",
    name: "",
    required: true,
    expectedDate: "",
    notes: "",
  });
  const [applicant, setApplicant] = useState<ApplicantDraft>({
    ...emptyPassportIdentity(),
    relationship: "",
  });
  const [mrzReview, setMrzReview] = useState<MrzReview | null>(null);
  const [scanningPassport, setScanningPassport] = useState(false);

  const can = (permission: string) =>
    permissions.includes("*") || permissions.includes(permission);
  const selectedApplicant =
    data?.applicants.find((item) => item.id === selectedApplicantId) ||
    data?.applicants[0] ||
    null;

  async function prepareMrzReview(
    applicantId: string,
    materialFileId: string,
    file: File,
  ) {
    setScanningPassport(true);
    setMessage("");
    try {
      const capture = await recognizePassportFile(file);
      const current = data?.applicants.find(
        (item) => String(item.id) === applicantId,
      );
      const fields = {
        ...capture.fields,
        name: String(current?.name || "").trim() || capture.fields.name,
      };
      setMrzReview({ applicantId, materialFileId, capture, fields });
      setDialog("mrz");
    } catch (reason) {
      setFileNotice({
        text:
          reason instanceof Error
            ? reason.message
            : "MRZ 识别失败，请人工核对申请人资料。",
        error: true,
      });
    } finally {
      setScanningPassport(false);
      setUploadingMaterialId("");
    }
  }

  async function uploadMaterialFile(materialId: string, file?: File) {
    if (!file) return;
    setUploadingMaterialId(materialId);
    setFileNotice({ text: "", error: false });
    try {
      const form = new FormData();
      form.set("orderNo", orderNo);
      form.set("materialId", materialId);
      form.set("file", file);
      const response = await fetch("/api/material-files", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "上传失败");
      setFileNotice({
        text: "文件已上传，并按申请人和材料自动归档、重命名。",
        error: false,
      });
      await load();
      const targetMaterial = data?.materials.find(
        (item) => String(item.id) === materialId,
      );
      if (
        targetMaterial?.system_code === "PASSPORT_BIO_PAGE" &&
        targetMaterial.applicant_id &&
        (file.type.startsWith("image/") || file.type === "application/pdf") &&
        can("applicants.mrz")
      ) {
        await prepareMrzReview(
          String(targetMaterial.applicant_id),
          String(result.id),
          file,
        );
      }
    } catch (reason) {
      setFileNotice({
        text: reason instanceof Error ? reason.message : "上传失败",
        error: true,
      });
    } finally {
      setUploadingMaterialId("");
    }
  }

  function replaceMaterialFile(fileId: string, fileName: string, file?: File) {
    if (!file) return;
    askConfirmation({
      title: "替换材料文件",
      description: `确定用新文件替换“${fileName}”吗？原文件会保留在历史记录中。`,
      confirmLabel: "确认替换",
      pendingLabel: "正在替换…",
      destructive: false,
      reasonLabel: "替换原因",
      reasonPlaceholder: "例如：申请人补交了清晰版本",
      onConfirm: async (reason) => {
        setUploadingMaterialId(fileId);
        setFileNotice({ text: "", error: false });
        try {
          const target = data?.materialFiles.find((item) => item.id === fileId);
          const form = new FormData();
          form.set("orderNo", orderNo);
          form.set("materialId", String(target?.material_id || ""));
          form.set("replaceFileId", fileId);
          form.set("reason", reason);
          form.set("file", file);
          const response = await fetch("/api/material-files", {
            method: "POST",
            body: form,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "替换失败");
          setFileNotice({
            text: "文件已替换，原文件已移入历史记录。",
            error: false,
          });
          await load();
          const materialRow = data?.materials.find(
            (item) => item.id === target?.material_id,
          );
          if (
            materialRow?.system_code === "PASSPORT_BIO_PAGE" &&
            materialRow.applicant_id &&
            (file.type.startsWith("image/") ||
              file.type === "application/pdf") &&
            can("applicants.mrz")
          ) {
            await prepareMrzReview(
              String(materialRow.applicant_id),
              String(result.id),
              file,
            );
          }
        } finally {
          setUploadingMaterialId("");
        }
      },
    });
  }

  function changeMaterialFileStatus(
    fileId: string,
    fileName: string,
    version: number,
    action: "VOID" | "RESTORE",
  ) {
    const restoring = action === "RESTORE";
    askConfirmation({
      title: restoring ? "恢复历史文件" : "作废材料文件",
      description: restoring
        ? `确定恢复“${fileName}”吗？恢复后它会重新显示为当前有效文件。`
        : `确定作废“${fileName}”吗？文件不会物理删除，可在历史文件中查看或恢复。`,
      confirmLabel: restoring ? "确认恢复" : "确认作废",
      pendingLabel: restoring ? "正在恢复…" : "正在作废…",
      destructive: !restoring,
      reasonLabel: restoring ? "恢复原因" : "作废原因",
      reasonPlaceholder: restoring
        ? "请填写恢复该文件的原因"
        : "请填写作废该文件的原因",
      onConfirm: async (reason) => {
        const response = await fetch(
          `/api/material-files/${encodeURIComponent(fileId)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, reason, expectedVersion: version }),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || `${restoring ? "恢复" : "作废"}失败`);
        setFileNotice({
          text: `${fileName} 已${restoring ? "恢复" : "作废"}。`,
          error: false,
        });
        await load();
      },
    });
  }

  function addMaterial(applicantId: string) {
    setEditingMaterialId("");
    setMaterial({
      applicantId,
      name: "",
      required: true,
      expectedDate: "",
      notes: "",
    });
    setDialog("material");
  }

  function editMaterial(row: Row) {
    setEditingMaterialId(String(row.id));
    setMaterial({
      applicantId: String(row.applicant_id || ""),
      name: String(row.name),
      required: Boolean(row.required),
      expectedDate: String(row.expected_date || ""),
      notes: String(row.notes || ""),
    });
    setDialog("material");
  }

  function removeMaterial(row: Row) {
    const files =
      data?.materialFiles.filter((file) => file.material_id === row.id) ?? [];
    const suffix = files.length ? `，同时删除其中 ${files.length} 个文件` : "";
    askConfirmation({
      title: "删除订单材料",
      description: `确定删除“${String(row.name)}”${suffix}吗？此操作无法恢复。`,
      confirmLabel: "确认删除",
      pendingLabel: "正在删除…",
      onConfirm: async () => {
        await act({ action: "deleteMaterial", materialId: row.id });
        setFileNotice({
          text: `材料“${String(row.name)}”已删除。`,
          error: false,
        });
      },
    });
  }

  async function saveMaterial() {
    try {
      await act({
        action: editingMaterialId ? "updateMaterial" : "addMaterial",
        materialId: editingMaterialId || undefined,
        ...material,
      });
      setDialog(null);
      setEditingMaterialId("");
      setFileNotice({
        text: editingMaterialId ? "材料要求已修改。" : "材料要求已增加。",
        error: false,
      });
    } catch (reason) {
      setFileNotice({
        text: reason instanceof Error ? reason.message : "保存材料失败",
        error: true,
      });
    }
  }

  function openApplicant(row?: Row) {
    setEditingApplicantId(row ? String(row.id) : "");
    setApplicant(
      row
        ? {
            name: String(row.name || ""),
            surname: String(row.surname || ""),
            givenNames: String(row.given_names || ""),
            nationality: String(row.nationality || ""),
            passportNo: String(row.passport_no || ""),
            birthDate: String(row.birth_date || ""),
            sex: String(row.sex || "") as ApplicantDraft["sex"],
            passportExpiry: String(row.passport_expiry || ""),
            issuingCountry: String(row.issuing_country || ""),
            documentCode: String(row.document_code || ""),
            personalNumber: String(row.personal_number || ""),
            relationship: String(row.relationship || ""),
          }
        : { ...emptyPassportIdentity(), relationship: "其他" },
    );
    setMessage("");
    setDialog("applicant");
  }

  async function scanCurrentPassport() {
    if (!selectedApplicant) return;
    const materialRow = data?.materials.find(
      (item) =>
        item.applicant_id === selectedApplicant.id &&
        item.system_code === "PASSPORT_BIO_PAGE",
    );
    const file = data?.materialFiles.find(
      (item) =>
        item.material_id === materialRow?.id &&
        (!item.status || item.status === "ACTIVE"),
    );
    if (!file) {
      setFileNotice({ text: "请先上传该申请人的护照首页。", error: true });
      return;
    }
    try {
      setScanningPassport(true);
      const response = await fetch(
        `/api/material-files/${encodeURIComponent(String(file.id))}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("读取护照首页失败。");
      const blob = await response.blob();
      await prepareMrzReview(
        String(selectedApplicant.id),
        String(file.id),
        new File([blob], String(file.stored_name), {
          type: String(file.mime_type),
        }),
      );
    } catch (reason) {
      setFileNotice({
        text: reason instanceof Error ? reason.message : "读取护照首页失败。",
        error: true,
      });
      setScanningPassport(false);
    }
  }

  async function confirmMrzReview() {
    if (!mrzReview) return;
    setMessage("");
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderNo)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "confirmMrz",
            applicantId: mrzReview.applicantId,
            materialFileId: mrzReview.materialFileId,
            rawMrz: mrzReview.capture.rawMrz,
            fields: mrzReview.fields,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "MRZ 确认失败");
      setDialog(null);
      setMrzReview(null);
      setFileNotice({
        text: result.valid
          ? "MRZ 已确认，全部校验位通过。"
          : "MRZ 已人工确认；存在未通过的校验位，请以已核对资料为准。",
        error: false,
      });
      await load();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "MRZ 确认失败");
    }
  }

  async function saveApplicant() {
    try {
      await act({
        action: editingApplicantId ? "updateApplicant" : "addApplicant",
        applicantId: editingApplicantId || undefined,
        ...applicant,
      });
      setDialog(null);
      setEditingApplicantId("");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "申请人资料保存失败",
      );
    }
  }

  function removeApplicant(row: Row) {
    askConfirmation({
      title: "删除附属申请人",
      description: `确定删除“${String(row.name)}”吗？该申请人的材料要求及已上传文件也会一并删除，且无法恢复。`,
      confirmLabel: "确认删除",
      pendingLabel: "正在删除…",
      onConfirm: async () => {
        await act({ action: "deleteApplicant", applicantId: row.id });
      },
    });
  }

  return {
    selectedApplicant,
    fileNotice,
    uploadingMaterialId,
    editingMaterialId,
    setEditingMaterialId,
    editingApplicantId,
    setEditingApplicantId,
    material,
    setMaterial,
    applicant,
    setApplicant,
    mrzReview,
    setMrzReview,
    scanningPassport,
    uploadMaterialFile,
    replaceMaterialFile,
    changeMaterialFileStatus,
    addMaterial,
    editMaterial,
    removeMaterial,
    saveMaterial,
    openApplicant,
    scanCurrentPassport,
    confirmMrzReview,
    saveApplicant,
    removeApplicant,
  };
}
