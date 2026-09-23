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

export async function recognizePassportFile(file: File): Promise<PassportMrzCapture> {
  const isPdf=file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!isPdf && !isImage) throw new Error("自动识别支持 PDF、JPG、JPEG、PNG 和 WEBP。");
  const { parse: parseMrz } = await import("mrz");
  const isoDate = (value: unknown) => {
    const text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (!/^\d{6}$/.test(text)) return "";
    const year = Number(text.slice(0, 2));
    const month = text.slice(2, 4);
    const day = text.slice(4, 6);
    const currentYear = new Date().getUTCFullYear() % 100;
    const fullYear = year <= currentYear + 10 ? 2000 + year : 1900 + year;
    return `${fullYear}-${month}-${day}`;
  };
  const sexCode = (value: unknown): PassportIdentity["sex"] => {
    const text = String(value || "").toLowerCase();
    return text === "m" || text === "male" ? "M" : text === "f" || text === "female" ? "F" : text ? "X" : "";
  };
  const extract=async(input:Blob,sourcePage?:number,totalPages?:number) => {
    const form = new FormData();
    form.append("file", input, "passport.jpg");
    const response = await fetch("/api/mrz/scan", { method: "POST", body: form });
    let result: Record<string, unknown> = {};
    try { result = await response.json() as Record<string, unknown>; } catch { /* handled below */ }
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : "MRZ 识别失败，请稍后重试。";
      throw new Error(message);
    }
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
        birthDate: isoDate(parsedFields.birthDate), sex: sexCode(parsedFields.sex),
        passportExpiry: isoDate(parsedFields.expirationDate),
        issuingCountry: String(parsedFields.issuingState || parsedFields.issuingCountry || ""),
        documentCode: String(parsedFields.documentCode || ""), personalNumber: String(parsedFields.personalNumber || ""),
      },
    } satisfies PassportMrzCapture;
  };
  if(!isPdf)return await extract(file);
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
      const page=await pdf.getPage(pageNumber);
      const canvas=document.createElement("canvas");
      try{
        const base=page.getViewport({scale:1});
        const scale=Math.min(3.5,Math.sqrt(12_000_000/(base.width*base.height)));
        const viewport=page.getViewport({scale});
        canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
        await page.render({canvas,viewport}).promise;
        const image=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("PDF 页面转换失败。")),"image/jpeg",0.95));
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
