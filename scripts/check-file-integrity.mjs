import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import pg from "pg";

const { Client } = pg;

function posixRelative(root, file) {
  return relative(root, file).split(sep).join("/");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    if(entry.name === ".incoming") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function digest(path) {
  return await streamedDigest(path);
}

function outputPath() {
  const index = process.argv.indexOf("--output");
  return index >= 0 ? process.argv[index + 1] : "";
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少 DATABASE_URL，无法读取文件索引。");
const uploadRoot = resolve(process.env.UPLOAD_ROOT || resolve(process.cwd(), "data", "files"));
const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const result = await client.query(`SELECT id,order_id,material_id,stored_name,relative_path,mime_type,size_bytes,sha256,uploaded_at
    FROM material_files ORDER BY relative_path`);
  const indexed = new Map(result.rows.map((row) => [String(row.relative_path), row]));
  const diskPaths = await walk(uploadRoot);
  const diskRelativePaths = diskPaths.map((path) => posixRelative(uploadRoot, path)).sort();
  const diskSet = new Set(diskRelativePaths);
  const missing = [];
  const missingChecksums = [];
  const sizeMismatches = [];
  const hashMismatches = [];

  for (const row of result.rows) {
    const relativePath = String(row.relative_path);
    if (!diskSet.has(relativePath)) {
      missing.push({ id: row.id, relativePath, storedName: row.stored_name });
      continue;
    }
    const absolutePath = resolve(uploadRoot, relativePath);
    const fileStat = await stat(absolutePath);
    const actualSha256 = await digest(absolutePath);
    if (!row.sha256) missingChecksums.push({ id: row.id, relativePath, actualSha256 });
    else if (String(row.sha256).toLowerCase() !== actualSha256) hashMismatches.push({ id: row.id, relativePath, expectedSha256: row.sha256, actualSha256 });
    if (Number(row.size_bytes) !== fileStat.size) sizeMismatches.push({ id: row.id, relativePath, expectedBytes: Number(row.size_bytes), actualBytes: fileStat.size });
  }

  const orphans = diskRelativePaths.filter((path) => !indexed.has(path)).map((relativePath) => ({
    relativePath,
    kind: relativePath.split("/").pop() === ".DS_Store" ? "PLATFORM_METADATA" : relativePath.startsWith(".quarantine/") ? "QUARANTINE" : "UNINDEXED_FILE",
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    uploadRoot,
    summary: {
      databaseRecords: result.rows.length,
      diskFiles: diskRelativePaths.length,
      missingFiles: missing.length,
      orphanFiles: orphans.length,
      missingChecksums: missingChecksums.length,
      sizeMismatches: sizeMismatches.length,
      hashMismatches: hashMismatches.length,
    },
    missing,
    orphans,
    missingChecksums,
    sizeMismatches,
    hashMismatches,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const target = outputPath();
  if (target) {
    const resolvedTarget = resolve(target);
    await mkdir(dirname(resolvedTarget), { recursive: true });
    await writeFile(resolvedTarget, json, { mode: 0o600 });
  }
  process.stdout.write(json);
  process.exitCode = missing.length || sizeMismatches.length || hashMismatches.length || missingChecksums.length || orphans.some(file => file.kind === "UNINDEXED_FILE") ? 2 : 0;
} finally {
  await client.end();
}

async function streamedDigest(path) {
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(path,{highWaterMark:64*1024}))hash.update(chunk);
  return hash.digest("hex");
}
