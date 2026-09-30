import { mrzDateToIso } from "@/lib/mrz-date";

export type PassportIdentity = {
  name: string;
  surname: string;
  givenNames: string;
  nationality: string;
  passportNo: string;
  birthDate: string;
  sex: "" | "M" | "F" | "X";
  passportExpiry: string;
  issuingCountry: string;
  documentCode: string;
  personalNumber: string;
};

export type PassportMrzCapture = {
  rawMrz: string;
  fields: PassportIdentity;
  checksums: Record<string, boolean>;
  valid: boolean;
  format: string;
  formatWarning?: string;
  sourcePage?: number;
  totalPages?: number;
};

export type PassportScanStage =
  | "archiving"
  | "pdf_parsing"
  | "image_preparing"
  | "uploading"
  | "receiving"
  | "validating"
  | "forwarding"
  | "queued"
  | "recognizing";

export type PassportScanProgress = {
  stage: PassportScanStage;
  uploadPercent?: number;
  page?: number;
  totalPages?: number;
  waiting?: number;
  includeUpload?: boolean;
  uploadOnly?: boolean;
  visibleStages?: PassportScanStage[];
};

type RecognizePassportOptions = {
  onStageChange?: (stage: PassportScanStage) => void;
  onProgress?: (progress: PassportScanProgress) => void;
  storedMaterialFileId?: string;
};

const checksumLabels: Record<string, string> = {
  documentNumber: "护照号码",
  documentNumberCheckDigit: "护照号码校验位",
  birthDate: "出生日期",
  birthDateCheckDigit: "出生日期校验位",
  expiryDate: "护照有效期",
  expirationDate: "护照有效期",
  expirationDateCheckDigit: "护照有效期校验位",
  personalNumber: "个人号码",
  personalNumberCheckDigit: "个人号码校验位",
  composite: "综合校验",
  compositeCheckDigit: "综合校验位",
};

const MRZ_MAX_PIXELS = 6_000_000;
const MRZ_MAX_EDGE = 3_200;
const MRZ_PASSTHROUGH_BYTES = 1_000_000;
const MRZ_TARGET_BYTES = 1_500_000;

async function encodeMrzJpeg(canvas: HTMLCanvasElement) {
  const encode = (quality: number) => new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("识别图片压缩失败。")),
      "image/jpeg",
      quality,
    ));
  const first = await encode(0.88);
  return first.size <= MRZ_TARGET_BYTES ? first : encode(0.8);
}

async function prepareMrzUploadImage(input: Blob) {
  if (input.type === "image/jpeg" && input.size <= MRZ_PASSTHROUGH_BYTES) return input;
  const bitmap = await createImageBitmap(input);
  const canvas = document.createElement("canvas");
  try {
    const pixelScale = Math.sqrt(MRZ_MAX_PIXELS / (bitmap.width * bitmap.height));
    const edgeScale = MRZ_MAX_EDGE / Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, pixelScale, edgeScale);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理识别图片。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const optimized = await encodeMrzJpeg(canvas);
    return optimized.size < input.size ? optimized : input;
  } finally {
    bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

export function describeMrzChecksum(key: string) {
  if (checksumLabels[key]) return checksumLabels[key];
  const base = key.replace(/CheckDigit$/i, "");
  return checksumLabels[base] ? `${checksumLabels[base]}校验位` : key;
}

export const emptyPassportIdentity = (): PassportIdentity => ({
  name: "", surname: "", givenNames: "", nationality: "", passportNo: "",
  birthDate: "", sex: "", passportExpiry: "", issuingCountry: "",
  documentCode: "", personalNumber: "",
});

function findMrzLines(value: unknown, depth = 0, seen = new Set<object>()): string[] | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const lines = value.filter((item): item is string => typeof item === "string")
      .map((line) => line.replace(/\s+/g, "").toUpperCase())
      .filter((line) => /^[A-Z0-9<]{30,44}$/.test(line));
    if (lines.length >= 2 && lines.length <= 3) return lines.slice(0, 3);
    for (const item of value) {
      const nested = findMrzLines(item, depth + 1, seen);
      if (nested) return nested;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/mrz|ligne|line|raw/i.test(key)) {
      const nested = findMrzLines(child, depth + 1, seen);
      if (nested) return nested;
    }
  }
  for (const child of Object.values(value)) {
    const nested = findMrzLines(child, depth + 1, seen);
    if (nested) return nested;
  }
  return undefined;
}

export async function recognizePassportFile(
  file: File,
  options: RecognizePassportOptions = {},
): Promise<PassportMrzCapture> {
  const isPdf=file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error("自动识别支持 PDF、JPG、JPEG、PNG 和 WEBP。");
  const { parse: parseMrz } = await import("mrz");
  const report = (progress: PassportScanProgress) => {
    options.onStageChange?.(progress.stage);
    options.onProgress?.(progress);
  };
  const sexCode = (value: unknown): PassportIdentity["sex"] => {
    const text = String(value || "").toLowerCase();
    return text === "m" || text === "male" ? "M" : text === "f" || text === "female" ? "F" : text ? "X" : "";
  };
  const extract=async(input:Blob,sourcePage?:number,totalPages?:number) => {
    const useStoredFile = Boolean(options.storedMaterialFileId && !sourcePage);
    const pageProgress = sourcePage ? { page: sourcePage, totalPages } : {};
    let uploadInput = input;
    if (!useStoredFile) {
      report({ stage: "image_preparing", ...pageProgress });
      uploadInput = sourcePage ? input : await prepareMrzUploadImage(input);
    }
    const body = useStoredFile
      ? JSON.stringify({ materialFileId: options.storedMaterialFileId })
      : (() => {
          const form = new FormData();
          form.append("file", uploadInput, "passport.jpg");
          return form;
        })();
    report({ stage: useStoredFile ? "validating" : "uploading", ...pageProgress });
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = new XMLHttpRequest();
      let consumed = 0;
      let buffered = "";
      let settled = false;
      const consumeEvents = (final = false) => {
        const text = request.responseText || "";
        buffered += text.slice(consumed);
        consumed = text.length;
        const lines = buffered.split("\n");
        buffered = lines.pop() || "";
        if (final && buffered.trim()) {
          lines.push(buffered);
          buffered = "";
        }
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line) as Record<string, unknown>; }
          catch { continue; }
          if (event.type === "stage" && typeof event.stage === "string") {
            report({
              stage: event.stage as PassportScanStage,
              waiting: typeof event.waiting === "number" ? event.waiting : undefined,
              ...pageProgress,
            });
          } else if (event.type === "result" && event.payload && typeof event.payload === "object") {
            settled = true;
            resolve(event.payload as Record<string, unknown>);
          } else if (event.type === "error") {
            settled = true;
            reject(new Error(typeof event.error === "string" ? event.error : "MRZ 识别失败，请稍后重试。"));
          }
        }
      };
      request.open("POST", "/api/mrz/scan");
      if (useStoredFile) request.setRequestHeader("Content-Type", "application/json");
      request.timeout = 75_000;
      if (!useStoredFile) {
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable && event.total > 0) {
            report({
              stage: "uploading",
              uploadPercent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
              ...pageProgress,
            });
          }
        });
        request.upload.addEventListener("load", () =>
          report({ stage: "receiving", ...pageProgress }),
        );
      }
      request.addEventListener("progress", () => consumeEvents());
      request.addEventListener("load", () => {
        if (request.status < 200 || request.status >= 300) {
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(request.responseText || "{}") as Record<string, unknown>; }
          catch { /* handled below */ }
          const message = typeof payload.error === "string"
            ? payload.error
            : "MRZ 识别失败，请稍后重试。";
          reject(new Error(message));
          return;
        }
        consumeEvents(true);
        if (!settled) reject(new Error("MRZ 识别服务未返回完整结果，请稍后重试。"));
      });
      request.addEventListener("error", () =>
        reject(new Error("MRZ 识别请求失败，请检查网络后重试。")),
      );
      request.addEventListener("timeout", () =>
        reject(new Error("MRZ 识别超时，请稍后重试。")),
      );
      request.addEventListener("abort", () =>
        reject(new Error("MRZ 识别已取消。")),
      );
      request.send(body);
    });
    const lines = findMrzLines(result.mrz_lines) || findMrzLines(result);
    if (!lines?.length) throw new Error("没有识别到完整 MRZ。");
    // TD3 护照第一行以 P 开头，第二个字符可以是类型代码（例如
    // 中国普通护照常见的 PP），不能只接受 P<。
    const formatWarning = lines.length !== 2 || lines.some((line) => line.length !== 44) || !/^P[A-Z<]/.test(lines[0])
      ? "识别到的文字格式不像标准护照 MRZ（应为两行 44 个字符），请核对照片或人工填写。"
      : undefined;
    const parsed = parseMrz(lines, { autocorrect: true });
    const parsedFields = (parsed.fields || {}) as Record<string, unknown>;
    const checksumDetails = (parsed.details || []).filter((detail) => String(detail.field || "").toLowerCase().includes("checkdigit"));
    const checksums = Object.fromEntries(checksumDetails.map((detail) => [String(detail.field), Boolean(detail.valid)]));
    const surname = String(parsedFields.lastName || "").trim();
    const givenNames = String(parsedFields.firstName || "").trim();
    return {
      rawMrz: lines.join("\n"), format: String(parsed.format || "").toUpperCase(), formatWarning,
      valid: Boolean(parsed.valid) && !formatWarning,
      checksums, sourcePage, totalPages,
      fields: {
        name: [surname, givenNames].filter(Boolean).join(" "), surname, givenNames,
        nationality: String(parsedFields.nationality || ""),
        passportNo: String(parsed.documentNumber || parsedFields.documentNumber || "").replace(/\s+/g, "").toUpperCase(),
        birthDate: mrzDateToIso(parsedFields.birthDate, "birth"), sex: sexCode(parsedFields.sex),
        passportExpiry: mrzDateToIso(parsedFields.expirationDate, "expiry"),
        issuingCountry: String(parsedFields.issuingState || parsedFields.issuingCountry || ""),
        documentCode: String(parsedFields.documentCode || ""), personalNumber: String(parsedFields.personalNumber || ""),
      },
    } satisfies PassportMrzCapture;
  };
  if(!isPdf)return await extract(file);
  report({ stage: "pdf_parsing" });
  const pdfjs=await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc="/pdf/pdf.worker.min.mjs";
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:"/pdf/cmaps/",cMapPacked:true,
    standardFontDataUrl:"/pdf/standard_fonts/",wasmUrl:"/pdf/wasm/"});
  const pdf=await task.promise;
  const totalPages=pdf.numPages;
  const pageLimit=Math.min(totalPages,5);
  let lastError:unknown;
  let bestCapture: PassportMrzCapture | undefined;
  try{
    for(let pageNumber=1;pageNumber<=pageLimit;pageNumber+=1){
      report({ stage: "pdf_parsing", page: pageNumber, totalPages });
      const page=await pdf.getPage(pageNumber);
      const canvas=document.createElement("canvas");
      try{
        const base=page.getViewport({scale:1});
        const scale=Math.min(3,Math.sqrt(MRZ_MAX_PIXELS/(base.width*base.height)));
        const viewport=page.getViewport({scale});
        canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
        await page.render({canvas,viewport}).promise;
        const image=await encodeMrzJpeg(canvas);
        try {
          const capture = await extract(image, pageNumber, totalPages);
          if (!bestCapture || checksumScore(capture) > checksumScore(bestCapture)) bestCapture = capture;
          if (capture.valid) return capture;
        } catch(error){lastError=error;}
      }finally{canvas.width=1;canvas.height=1;page.cleanup();}
    }
  }finally{await task.destroy();}
  if (bestCapture) return bestCapture;
  const scope=totalPages>pageLimit?`前 ${pageLimit} 页`:`${pageLimit} 页`;
  throw new Error(`PDF ${scope}没有识别到完整 MRZ，请确认文件清晰且包含护照资料页，或人工填写。${lastError instanceof Error?` ${lastError.message}`:""}`);
}

function checksumScore(capture: PassportMrzCapture) {
  const values = Object.values(capture.checksums);
  return (capture.valid ? 1000 : 0) + values.filter(Boolean).length;
}
