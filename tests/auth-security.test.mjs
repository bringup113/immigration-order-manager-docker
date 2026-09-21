import assert from "node:assert/strict";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const baseUrl = process.env.MIGRA_BASE_URL;
const databaseUrl = process.env.MIGRA_DATABASE_URL;
const ownerUsername = process.env.MIGRA_TEST_USERNAME;
const ownerPassword = process.env.MIGRA_TEST_PASSWORD;
const enabled = Boolean(baseUrl && databaseUrl && ownerUsername && ownerPassword);

async function rawLogin(username, password, mfaCode = "") {
  const response = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    body: new URLSearchParams({ username, password, mfa_code: mfaCode, return_to: "/" }),
    redirect: "manual",
  });
  return response;
}

async function login(username, password, mfaCode = "") {
  const response = await rawLogin(username, password, mfaCode);
  assert.equal(response.status, 303, await response.text());
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /Max-Age=43200/i);
  return setCookie.split(";", 1)[0];
}

function encodedPassword(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
  return "pbkdf2-sha256$600000$" + salt.toString("base64url") + "$" + derived.toString("base64url");
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function post(path, cookie, body) {
  return fetch(baseUrl + path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("sessions support idle/absolute expiry, device revocation, password revocation, and 600k hash upgrade", { skip: !enabled }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = "auth_" + suffix;
  const firstPassword = "Session-" + suffix + "-Old!";
  const nextPassword = "Session-" + suffix + "-New!";
  let userId = "";
  try {
    const ownerCookie = await login(ownerUsername, ownerPassword);
    const created = await post("/api/admin/users", ownerCookie, {
      action: "create",
      username,
      displayName: "会话安全测试",
      password: firstPassword,
      roleId: "role_readonly",
    });
    assert.equal(created.status, 201, await created.clone().text());
    userId = (await created.json()).id;
    const legacySalt = randomBytes(16);
    const legacyHash = pbkdf2Sync(firstPassword, legacySalt, 310_000, 32, "sha256");
    const legacyEncoded = "pbkdf2-sha256$310000$" + legacySalt.toString("base64url") + "$" + legacyHash.toString("base64url");
    await database.query("UPDATE users SET must_change_password=0,password_hash=$2 WHERE id=$1", [userId, legacyEncoded]);

    const firstCookie = await login(username, firstPassword);
    const secondCookie = await login(username, firstPassword);
    const sessionsResponse = await fetch(baseUrl + "/api/auth/sessions", { headers: { cookie: secondCookie } });
    assert.equal(sessionsResponse.status, 200);
    const sessions = (await sessionsResponse.json()).sessions;
    assert.equal(sessions.length >= 2, true);
    assert.equal(sessions.filter((item) => Number(item.is_current) === 1).length, 1);
    const otherSession = sessions.find((item) => Number(item.is_current) !== 1);
    const revokedOne = await post("/api/auth/sessions", secondCookie, { action: "revokeOne", sessionId: otherSession.id });
    assert.equal(revokedOne.status, 200);
    assert.equal((await revokedOne.json()).count, 1);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: firstCookie } })).status, 401);

    const thirdCookie = await login(username, firstPassword);
    const revokedOthers = await post("/api/auth/sessions", thirdCookie, { action: "revokeOthers" });
    assert.equal(revokedOthers.status, 200);
    assert.equal((await revokedOthers.json()).count >= 1, true);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: secondCookie } })).status, 401);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: thirdCookie } })).status, 200);

    const tooLong = await post("/api/auth/password", thirdCookie, { currentPassword: firstPassword, newPassword: "x".repeat(129) });
    assert.equal(tooLong.status, 400);
    const fourthCookie = await login(username, firstPassword);
    const changed = await post("/api/auth/password", fourthCookie, { currentPassword: firstPassword, newPassword: nextPassword });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: thirdCookie } })).status, 401);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: fourthCookie } })).status, 401);
    await login(username, nextPassword);

    const hash = await database.query("SELECT password_hash FROM users WHERE id=$1", [userId]);
    assert.match(hash.rows[0].password_hash, /^pbkdf2-sha256\$600000\$/);

    const idleToken = "idle-" + suffix;
    const idleHash = createHash("sha256").update(idleToken).digest("base64url");
    await database.query(`INSERT INTO user_sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP - interval '2 hours',CURRENT_TIMESTAMP - interval '2 hours',CURRENT_TIMESTAMP + interval '1 hour')`,
      ["test_idle_" + suffix, userId, idleHash]);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: "migra_session=" + idleToken } })).status, 401);
    const idle = await database.query("SELECT revoked_at FROM user_sessions WHERE id=$1", ["test_idle_" + suffix]);
    assert.notEqual(idle.rows[0].revoked_at, null);

    const expiredToken = "expired-" + suffix;
    const expiredHash = createHash("sha256").update(expiredToken).digest("base64url");
    await database.query(`INSERT INTO user_sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP - interval '2 hours',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP - interval '1 minute')`,
      ["test_expired_" + suffix, userId, expiredHash]);
    assert.equal((await fetch(baseUrl + "/api/auth/me", { headers: { cookie: "migra_session=" + expiredToken } })).status, 401);
    await database.query(`INSERT INTO user_sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at,revoked_at)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP - interval '45 days',CURRENT_TIMESTAMP - interval '45 days',CURRENT_TIMESTAMP + interval '1 day',CURRENT_TIMESTAMP - interval '40 days')`,
      ["test_revoked_" + suffix, userId, createHash("sha256").update("revoked-" + suffix).digest("base64url")]);
    await login(username, nextPassword);
    const staleSessions = await database.query("SELECT id FROM user_sessions WHERE id IN ($1,$2)", ["test_expired_" + suffix, "test_revoked_" + suffix]);
    assert.equal(staleSessions.rowCount, 0);

    const audits = await database.query("SELECT action FROM audit_logs WHERE actor_user_id=$1", [userId]);
    for (const action of ["AUTH_PASSWORD_HASH_UPGRADE", "AUTH_SESSION_REVOKE", "AUTH_SESSION_REVOKE_OTHERS", "AUTH_PASSWORD_CHANGE", "AUTH_SESSION_CLEANUP"]) {
      assert.equal(audits.rows.some((row) => row.action === action), true, action);
    }
  } finally {
    if (userId) {
      await database.query("DELETE FROM audit_logs WHERE actor_user_id=$1 OR entity_id=$1", [userId]).catch(() => undefined);
      await database.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    }
    await database.end();
  }
});

test("MFA rebind requires the existing factor and recovery codes are consumed atomically", { skip: !enabled }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `mfa_${suffix}`;
  const password = `Mfa-${suffix}-Password!`;
  let userId = "";
  try {
    const ownerCookie = await login(ownerUsername, ownerPassword);
    const created = await post("/api/admin/users", ownerCookie, {
      action: "create",
      username,
      displayName: "MFA 安全测试",
      password,
      roleId: "role_readonly",
    });
    assert.equal(created.status, 201, await created.clone().text());
    userId = (await created.json()).id;
    await database.query("UPDATE users SET must_change_password=0 WHERE id=$1", [userId]);

    const cookie = await login(username, password);
    const begun = await post("/api/auth/mfa", cookie, { action: "begin" });
    assert.equal(begun.status, 200, await begun.clone().text());
    const first = await begun.json();
    const enabledMfa = await post("/api/auth/mfa", cookie, { action: "enable", code: totp(first.secret) });
    assert.equal(enabledMfa.status, 200, await enabledMfa.clone().text());

    assert.equal((await post("/api/auth/mfa", cookie, { action: "begin" })).status, 403);
    const rebind = await post("/api/auth/mfa", cookie, {
      action: "begin",
      password,
      currentCode: totp(first.secret),
    });
    assert.equal(rebind.status, 200, await rebind.clone().text());
    const replacement = await rebind.json();
    assert.equal((await post("/api/auth/mfa", cookie, { action: "enable", code: totp(replacement.secret) })).status, 403);
    const replaced = await post("/api/auth/mfa", cookie, {
      action: "enable",
      code: totp(replacement.secret),
      reauthToken: replacement.reauthToken,
    });
    assert.equal(replaced.status, 200, await replaced.clone().text());
    const recoveryCode = (await replaced.json()).recoveryCodes[0];

    const attempts = await Promise.all([
      rawLogin(username, password, recoveryCode),
      rawLogin(username, password, recoveryCode),
    ]);
    assert.equal(attempts.filter((response) => response.headers.has("set-cookie")).length, 1);
    assert.equal(attempts.filter((response) => response.headers.get("location")?.includes("error=1")).length, 1);
  } finally {
    if (userId) {
      await database.query("DELETE FROM audit_logs WHERE actor_user_id=$1 OR entity_id=$1", [userId]).catch(() => undefined);
      await database.query("DELETE FROM users WHERE id=$1", [userId]).catch(() => undefined);
    }
    await database.end();
  }
});

test("a lower custom role cannot manage a higher custom-role account", { skip: !enabled }, async () => {
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const lowRole = `role_low_${suffix}`;
  const highRole = `role_high_${suffix}`;
  const lowUser = `usr_low_${suffix}`;
  const highUser = `usr_high_${suffix}`;
  const lowName = `low_${suffix}`;
  const highName = `high_${suffix}`;
  const lowPassword = `Low-${suffix}-Password!`;
  const highPassword = `High-${suffix}-Password!`;
  try {
    await database.query(`INSERT INTO roles(id,code,name,is_system,active,order_scope,created_at,updated_at)
      VALUES($1,$1,$1,0,1,'OWN',now(),now()),($2,$2,$2,0,1,'ALL',now(),now())`, [lowRole, highRole]);
    for (const permission of ["users.write", "users.read", "roles.read"])
      await database.query("INSERT INTO role_permissions(role_id,permission) VALUES($1,$2)", [lowRole, permission]);
    for (const permission of ["orders.read", "finance.read", "audit.export"])
      await database.query("INSERT INTO role_permissions(role_id,permission) VALUES($1,$2)", [highRole, permission]);
    await database.query(`INSERT INTO users(id,username,username_normalized,display_name,password_hash,role_id,active,must_change_password,created_at,updated_at)
      VALUES($1,$2,$2,$2,$3,$4,1,0,now(),now()),($5,$6,$6,$6,$7,$8,1,0,now(),now())`,
      [lowUser, lowName, encodedPassword(lowPassword), lowRole, highUser, highName, encodedPassword(highPassword), highRole]);

    const cookie = await login(lowName, lowPassword);
    const reset = await post("/api/admin/users", cookie, {
      action: "resetPassword",
      userId: highUser,
      password: `Replacement-${suffix}!`,
    });
    assert.equal(reset.status, 403, await reset.clone().text());
    await login(highName, highPassword);
  } finally {
    await database.query("DELETE FROM audit_logs WHERE actor_user_id IN ($1,$2) OR entity_id IN ($1,$2)", [lowUser, highUser]).catch(() => undefined);
    await database.query("DELETE FROM users WHERE id IN ($1,$2)", [lowUser, highUser]).catch(() => undefined);
    await database.query("DELETE FROM roles WHERE id IN ($1,$2)", [lowRole, highRole]).catch(() => undefined);
    await database.end();
  }
});
