import { fileDigest } from "./file-digest";
import { readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { getDatabase } from "@/db/database";
import type { AppDatabase } from "@/db/driver";

type FileRow = { id: string; relative_path: string; stored_name: string; size_bytes: number | string; sha256: string | null };

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if(entry.name === ".incoming") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function checkFileIntegrity(db: AppDatabase = getDatabase()) {
  const uploadRoot = resolve(process.env.UPLOAD_ROOT || resolve(process.cwd(), "data", "files"));
  const rows = await db.prepare("SELECT id,relative_path,stored_name,size_bytes,sha256 FROM material_files ORDER BY relative_path").all<FileRow>();
  const indexed = new Map(rows.results.map((row) => [String(row.relative_path), row]));
  const diskPaths = await walk(uploadRoot);
  const relativePaths = diskPaths.map((path) => relative(uploadRoot, path).split(sep).join("/")).sort();
  const diskSet = new Set(relativePaths);
  const missing: unknown[] = [];
  const missingChecksums: unknown[] = [];
  const sizeMismatches: unknown[] = [];
  const hashMismatches: unknown[] = [];

  for (const row of rows.results) {
    const relativePath = String(row.relative_path);
    if (!diskSet.has(relativePath)) {
      missing.push({ id: row.id, relativePath, storedName: row.stored_name });
      continue;
    }
    const path = resolve(uploadRoot, relativePath);
    const fileStat = await stat(path);
    const actualSha256 = await fileDigest(path);
    if (!row.sha256) missingChecksums.push({ id: row.id, relativePath, actualSha256 });
    else if (row.sha256.toLowerCase() !== actualSha256) hashMismatches.push({ id: row.id, relativePath, expectedSha256: row.sha256, actualSha256 });
    if (Number(row.size_bytes) !== fileStat.size) sizeMismatches.push({ id: row.id, relativePath, expectedBytes: Number(row.size_bytes), actualBytes: fileStat.size });
  }

  const orphans = relativePaths.filter((path) => !indexed.has(path)).map((relativePath) => ({
    relativePath,
    kind: relativePath.split("/").pop() === ".DS_Store" ? "PLATFORM_METADATA" : relativePath.startsWith(".quarantine/") ? "QUARANTINE" : "UNINDEXED_FILE",
  }));
  return {
    generatedAt: new Date().toISOString(),
    summary: { databaseRecords: rows.results.length, diskFiles: relativePaths.length, missingFiles: missing.length, orphanFiles: orphans.length, missingChecksums: missingChecksums.length, sizeMismatches: sizeMismatches.length, hashMismatches: hashMismatches.length },
    missing, orphans, missingChecksums, sizeMismatches, hashMismatches,
  };
}
