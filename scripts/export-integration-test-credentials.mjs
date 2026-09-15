import { appendFileSync, readFileSync } from "node:fs";

const credentialPath = process.argv[2] || process.env.MIGRA_TEST_CREDENTIAL_FILE;
const githubEnvironmentPath = process.env.GITHUB_ENV;
if (!credentialPath || !githubEnvironmentPath) {
  throw new Error(
    "用法：在 GitHub Actions 中设置 GITHUB_ENV，并传入集成测试凭据文件。",
  );
}

const content = readFileSync(credentialPath, "utf8");
const username = content.match(/^账号：(\S+)$/m)?.[1];
const password = content.match(/^密码：(\S+)$/m)?.[1];
if (!username || !password) {
  throw new Error("集成测试凭据文件格式不正确。");
}

process.stdout.write(`::add-mask::${password}\n`);
appendFileSync(
  githubEnvironmentPath,
  `MIGRA_TEST_USERNAME=${username}\nMIGRA_TEST_PASSWORD=${password}\n`,
  "utf8",
);
process.stdout.write("集成测试凭据已注入后续 GitHub Actions 步骤。\n");
