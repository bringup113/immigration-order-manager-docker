import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DomainError } from "@/lib/domain";

export function storageRoot() {
  const dataDirectory = resolve(process.env.DATA_DIRECTORY || join(process.cwd(), "data"));
  return resolve(process.env.UPLOAD_ROOT || join(dataDirectory, "files"));
}

function storedPath(relativePath: string) {
  const root = storageRoot();
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new DomainError("文件路径不正确。");
  return target;
}

export async function saveStoredFile(relativePath: string, data: Uint8Array) {
  const target = storedPath(relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, { flag: "wx" });
}

export async function readStoredFile(relativePath: string) {
  try { return await readFile(storedPath(relativePath)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DomainError("文件不存在或已经被移除。", 404);
    throw error;
  }
}

export async function deleteStoredFile(relativePath: string) {
  try { await unlink(storedPath(relativePath)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function moveStoredFile(fromRelativePath: string, toRelativePath: string) {
  const source = storedPath(fromRelativePath);
  const target = storedPath(toRelativePath);
  if (source === target) return;
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
}

export async function quarantineStoredFile(relativePath: string) {
  const quarantinePath = `.quarantine/${crypto.randomUUID()}`;
  try {
    await moveStoredFile(relativePath, quarantinePath);
    return quarantinePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function openStoredFile(relativePath: string) {
  try { return await open(storedPath(relativePath), "r"); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code === "ENOENT") throw new DomainError("文件不存在或已经被移除。",404);
    throw error;
  }
}
export async function commitStoredUpload(temporaryPath:string,relativePath:string) {
  const target=storedPath(relativePath);
  await mkdir(dirname(target),{recursive:true});
  await rename(temporaryPath,target);
}
