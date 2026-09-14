import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const dataDirectory = resolve(process.env.DATA_DIRECTORY || "/app/data");
mkdirSync(dataDirectory, { recursive: true });

function persistentValue(environmentName, filename, bytes) {
  const provided = process.env[environmentName]?.trim();
  if (provided) return { value: provided, generated: false };

  const path = `${dataDirectory}/${filename}`;
  if (existsSync(path)) return { value: readFileSync(path, "utf8").trim(), generated: false };

  const value = randomBytes(bytes).toString("base64url");
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  return { value, generated: true };
}

const secret = persistentValue("APP_AUTH_SECRET", ".auth-secret", 32);

process.env.APP_AUTH_SECRET = secret.value;
process.env.APP_DEPLOYMENT = "docker";
process.env.HOSTNAME ||= "0.0.0.0";
process.env.PORT ||= "3000";

console.log("\nMIGRA 移民订单管理系统");
console.log(`访问地址：http://服务器IP:${process.env.PUBLIC_PORT || process.env.PORT}`);
console.log("数据库中没有账号时，请在登录页创建系统所有者。");
console.log("");

const child = spawn(process.execPath, ["server.js"], {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
