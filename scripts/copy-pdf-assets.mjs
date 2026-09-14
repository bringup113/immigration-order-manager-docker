import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfTarget = join(root, "public", "pdf");
rmSync(pdfTarget, { recursive: true, force: true });
mkdirSync(pdfTarget, { recursive: true });
cpSync(
  join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  join(pdfTarget, "pdf.worker.min.mjs"),
);
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  const source = join(root, "node_modules/pdfjs-dist", directory);
  const destination = join(pdfTarget, directory);
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(source))
    cpSync(join(source, name), join(destination, name));
}
console.log("PDF 浏览器渲染资源已复制到 public/pdf。");
