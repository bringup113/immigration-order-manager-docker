"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { Row } from "@/components/order-detail-ui";
import type {
  MrzReview,
  OrderDetailData,
  OrderDetailDialog,
} from "@/components/order-detail-types";
import {
  recognizePassportFile,
  type PassportScanProgress,
  type PassportScanStage,
} from "@/lib/passport-mrz";

type FileNotice = { text: string; error: boolean };

export function passportUploadStages(file: File): PassportScanStage[] {
  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  return isPdf
    ? [
        "archiving",
        "pdf_parsing",
        "image_preparing",
        "uploading",
        "receiving",
        "validating",
        "forwarding",
        "queued",
        "recognizing",
      ]
    : ["archiving", "validating", "forwarding", "queued", "recognizing"];
}

export function usePassportMrzWorkflow({
  orderNo,
  data,
  selectedApplicant,
  load,
  setDialog,
  setMessage,
  setFileNotice,
  setUploadingMaterialId,
}: {
  orderNo: string;
  data: OrderDetailData | null;
  selectedApplicant: Row | null;
  load: () => Promise<void>;
  setDialog: (dialog: OrderDetailDialog) => void;
  setMessage: (message: string) => void;
  setFileNotice: Dispatch<SetStateAction<FileNotice>>;
  setUploadingMaterialId: Dispatch<SetStateAction<string>>;
}) {
  const [mrzReview, setMrzReview] = useState<MrzReview | null>(null);
  const [scanningPassport, setScanningPassport] = useState(false);
  const [passportProgress, setPassportProgress] =
    useState<PassportScanProgress | null>(null);

  function beginPassportScan(
    file: File,
    stage: PassportScanStage = "archiving",
  ) {
    setScanningPassport(true);
    setPassportProgress({ stage, visibleStages: passportUploadStages(file) });
  }

  function cancelPassportScan() {
    setScanningPassport(false);
    setPassportProgress(null);
  }

  async function prepareMrzReview(
    applicantId: string,
    materialFileId: string,
    file: File,
    includeUpload = true,
    visibleStages?: PassportScanStage[],
  ) {
    setScanningPassport(true);
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    setPassportProgress({
      stage: isPdf ? "pdf_parsing" : "validating",
      includeUpload,
      visibleStages,
    });
    setMessage("");
    try {
      const capture = await recognizePassportFile(file, {
        storedMaterialFileId: materialFileId,
        onProgress: (progress) =>
          setPassportProgress({
            ...progress,
            includeUpload,
            visibleStages,
          }),
      });
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
      cancelPassportScan();
      setUploadingMaterialId("");
    }
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
      const mimeType = String(file.mime_type);
      setPassportProgress({
        stage: mimeType === "application/pdf" ? "pdf_parsing" : "validating",
      });
      let blob: Blob = new Blob([], { type: mimeType });
      if (mimeType === "application/pdf") {
        const response = await fetch(
          `/api/material-files/${encodeURIComponent(String(file.id))}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("读取护照首页失败。");
        blob = await response.blob();
      }
      await prepareMrzReview(
        String(selectedApplicant.id),
        String(file.id),
        new File([blob], String(file.stored_name), { type: mimeType }),
        mimeType === "application/pdf",
      );
    } catch (reason) {
      setFileNotice({
        text: reason instanceof Error ? reason.message : "读取护照首页失败。",
        error: true,
      });
      cancelPassportScan();
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

  return {
    mrzReview,
    setMrzReview,
    scanningPassport,
    passportProgress,
    beginPassportScan,
    cancelPassportScan,
    prepareMrzReview,
    scanCurrentPassport,
    confirmMrzReview,
  };
}
