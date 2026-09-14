import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const path = resolve(process.argv[2] || ".env");
let content = readFileSync(path, "utf8");
const parsed = new Map();
for (const line of content.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) parsed.set(match[1], match[2].trim());
}
const ownerPassword = parsed.get("POSTGRES_PASSWORD") || "";
if (!ownerPassword || ownerPassword.includes("请在") || ownerPassword.includes("请设置")) {
  throw new Error(".env 中必须先设置强随机 POSTGRES_PASSWORD。");
}

const defaults = {
  APP_UID: String(process.getuid?.() ?? 10001),
  APP_GID: String(process.getgid?.() ?? 10001),
  POSTGRES_MIGRATOR_USER: "migra_migrator",
  POSTGRES_RUNTIME_USER: "migra_runtime",
  POSTGRES_BACKUP_USER: "migra_backup",
};
const additions = [];
for (const [name, value] of Object.entries(defaults)) {
  if (!parsed.get(name)) additions.push(name + "=" + value);
}
for (const name of ["POSTGRES_MIGRATOR_PASSWORD", "POSTGRES_RUNTIME_PASSWORD", "POSTGRES_BACKUP_PASSWORD"]) {
  if (!parsed.get(name)) additions.push(name + "=" + randomBytes(24).toString("base64url"));
}
if (additions.length) {
  if (!content.endsWith("\n")) content += "\n";
  content += "\n# 由 npm run docker:prepare 生成；分别用于迁移、Web 运行和只读备份。\n";
  content += additions.join("\n") + "\n";
  writeFileSync(path, content, { mode: 0o600 });
}
chmodSync(path, 0o600);
process.stdout.write("Docker 数据库角色配置已准备，.env 权限为 0600。\n");
