import assert from "node:assert/strict";
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const baseUrl = process.env.MIGRA_BASE_URL;
const databaseUrl = process.env.MIGRA_DATABASE_URL;
const ownerUsername = process.env.MIGRA_TEST_USERNAME;
const ownerPassword = process.env.MIGRA_TEST_PASSWORD;
const enabled = Boolean(baseUrl && databaseUrl && ownerUsername && ownerPassword);

async function login(username, password) {
  const response = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    body: new URLSearchParams({ username, password, return_to: "/" }),
    redirect: "manual",
  });
  assert.equal(response.status, 303, await response.text());
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /Max-Age=43200/i);
  return setCookie.split(";", 1)[0];
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
