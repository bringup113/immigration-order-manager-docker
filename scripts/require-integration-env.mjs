import { existsSync } from "node:fs";

const missing = [];
if (!process.env.MIGRA_BASE_URL) missing.push("MIGRA_BASE_URL");
const credentialFile = process.env.MIGRA_TEST_CREDENTIAL_FILE;
const hasCredentials = Boolean(process.env.MIGRA_TEST_USERNAME && process.env.MIGRA_TEST_PASSWORD);
if (!hasCredentials && !(credentialFile && existsSync(credentialFile))) missing.push("MIGRA_TEST_USERNAME + MIGRA_TEST_PASSWORD 或 MIGRA_TEST_CREDENTIAL_FILE");
if (missing.length) {
  console.error(`集成测试缺少环境变量：${missing.join(", ")}`);
  process.exit(2);
}
