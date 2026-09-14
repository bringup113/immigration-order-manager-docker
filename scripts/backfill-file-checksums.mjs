import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少 DATABASE_URL，无法回填文件哈希。");
const uploadRoot = resolve(process.env.UPLOAD_ROOT || resolve(process.cwd(), "data", "files"));

function storedPath(relativePath) {
  const target = resolve(uploadRoot, relativePath);
  if (target !== uploadRoot && !target.startsWith(`${uploadRoot}${sep}`)) throw new Error(`文件路径越界：${relativePath}`);
  return target;
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query("SELECT id,relative_path,size_bytes FROM material_files WHERE sha256 IS NULL OR btrim(sha256)='' ORDER BY relative_path");
  const values = [];
  for (const row of result.rows) {
    const path = storedPath(String(row.relative_path));
    const fileStat = await stat(path);
    if (fileStat.size !== Number(row.size_bytes)) throw new Error(`文件大小不一致，已停止回填：${row.relative_path}`);
    const sha256 = await streamedDigest(path);
    values.push({ id: String(row.id), sha256 });
  }

  await client.query("BEGIN");
  try {
    for (const value of values) await client.query("UPDATE material_files SET sha256=$1 WHERE id=$2 AND (sha256 IS NULL OR btrim(sha256)='')", [value.sha256, value.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ checked: result.rows.length, updated: values.length, completedAt: new Date().toISOString() })}\n`);
} finally {
  await client.end();
}

async function streamedDigest(path) {
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(path,{highWaterMark:64*1024}))hash.update(chunk);
  return hash.digest("hex");
}
