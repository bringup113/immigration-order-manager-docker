import { chmodSync, unlinkSync, writeFileSync } from "node:fs";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import pg from "pg";

const action = process.argv[2];
const credentialPath = process.argv[3];
const databaseUrl = process.env.MIGRA_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl || !credentialPath || !["create", "delete"].includes(action)) {
  throw new Error("用法：node scripts/integration-test-user.mjs create|delete <凭据文件>，并设置 MIGRA_DATABASE_URL。");
}
const id = "usr_integration_test";
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (action === "delete") {
    await client.query("DELETE FROM audit_logs WHERE actor_user_id=$1 OR entity_id=$1", [id]);
    await client.query("DELETE FROM users WHERE id=$1", [id]);
    try { unlinkSync(credentialPath); } catch {}
    process.stdout.write("集成测试用户已清理。\n");
  } else {
    const username = "migra_integration_test";
    const password = randomBytes(18).toString("base64url");
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
    const encoded = "pbkdf2-sha256$600000$" + salt.toString("base64url") + "$" + derived.toString("base64url");
    await client.query("DELETE FROM users WHERE id=$1", [id]);
    await client.query(`INSERT INTO users
      (id,username,username_normalized,display_name,password_hash,role_id,active,must_change_password,failed_attempts,created_at,updated_at)
      VALUES ($1,$2,$2,'集成测试所有者',$3,'role_owner',1,0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [id, username, encoded]);
    writeFileSync(credentialPath, "账号：" + username + "\n密码：" + password + "\n", { mode: 0o600 });
    chmodSync(credentialPath, 0o600);
    process.stdout.write("隔离集成测试用户已创建。\n");
  }
} finally {
  await client.end();
}
