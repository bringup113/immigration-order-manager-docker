import { getDatabase, newId, nowIso } from "@/db/database";
import type { AppDatabase } from "@/db/driver";

const COOKIE_NAME = "migra_session";
const PASSWORD_ITERATIONS = 600_000;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_BLOCK_MS = 15 * 60_000;
const DUMMY_SALT = new Uint8Array([91, 42, 13, 207, 88, 31, 164, 73, 116, 6, 219, 55, 182, 102, 9, 241]);

export type AppUser = {
  id: string; username: string; displayName: string; roleId: string;
  roleCode: string; roleName: string; orderScope: "ALL" | "OWN"; permissions: string[]; mustChangePassword: boolean; mfaEnabled: boolean; mfaRequired: boolean;
};

export function isDockerDeployment() { return process.env.APP_DEPLOYMENT === "docker"; }
export function dockerSessionCookieName() { return COOKIE_NAME; }
export function normalizeUsername(value: string) { return value.trim().normalize("NFKC").toLowerCase(); }

function boundedEnvironmentNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
function sessionIdleMilliseconds() { return boundedEnvironmentNumber("SESSION_IDLE_MINUTES", 60, 5, 1_440) * 60_000; }
function sessionAbsoluteMilliseconds() { return boundedEnvironmentNumber("SESSION_ABSOLUTE_HOURS", 12, 1, 168) * 3_600_000; }
export function dockerSessionMaxAgeSeconds() { return Math.floor(sessionAbsoluteMilliseconds() / 1_000); }
function sessionRetentionMilliseconds() { return boundedEnvironmentNumber("SESSION_RETENTION_DAYS", 30, 1, 365) * 86_400_000; }
export function privilegedMfaPolicyEnabled() {
  return process.env.PUBLIC_DEPLOYMENT === "1" || process.env.REQUIRE_PRIVILEGED_MFA === "1";
}
function passwordLength(value: string) { return Array.from(value).length; }
export function validPasswordLength(value: string) {
  const length = passwordLength(value);
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}

function bytesToBase64(bytes: Uint8Array) { return Buffer.from(bytes).toString("base64url"); }
function base64ToBytes(value: string) { return new Uint8Array(Buffer.from(value, "base64url")); }

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new Uint8Array(salt).buffer as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations }, key, 256);
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

const dummyPasswordHash = derivePassword("migra-invalid-password-placeholder", DUMMY_SALT, PASSWORD_ITERATIONS);

async function verifyPasswordOrDummy(password: string, encoded?: string) {
  if (passwordLength(password) > PASSWORD_MAX_LENGTH) {
    await derivePassword("migra-overlong-password-placeholder", DUMMY_SALT, PASSWORD_ITERATIONS);
    return false;
  }
  if (encoded) return verifyPassword(password, encoded);
  return constantTimeEqual(await derivePassword(password, DUMMY_SALT, PASSWORD_ITERATIONS), await dummyPasswordHash);
}

function loginRateScopes(username: string, ip?: string) {
  const safeIp = (ip || "unknown").slice(0, 96);
  return [
    { key: `ip:${safeIp}`, limit: 20 },
    { key: `pair:${safeIp}:${normalizeUsername(username).slice(0, 128)}`, limit: 5 },
  ];
}

async function isLoginRateLimited(username: string, ip?: string) {
  const db = getDatabase();
  const now = nowIso();
  for (const scope of loginRateScopes(username, ip)) {
    const row = await db.prepare("SELECT blocked_until FROM auth_rate_limits WHERE rate_key=?").bind(scope.key).first();
    if (row?.blocked_until && String(row.blocked_until) > now) return true;
  }
  return false;
}

async function recordLoginFailure(username: string, ip?: string) {
  const db = getDatabase();
  const now = new Date();
  const nowText = now.toISOString();
  for (const scope of loginRateScopes(username, ip)) {
    const row = await db.prepare("SELECT attempt_count,window_started_at FROM auth_rate_limits WHERE rate_key=?").bind(scope.key).first();
    const currentWindow = row?.window_started_at && now.getTime() - new Date(String(row.window_started_at)).getTime() < LOGIN_WINDOW_MS;
    const attempts = currentWindow ? Number(row?.attempt_count || 0) + 1 : 1;
    const windowStartedAt = currentWindow ? String(row?.window_started_at) : nowText;
    const blockedUntil = attempts >= scope.limit ? new Date(now.getTime() + LOGIN_BLOCK_MS).toISOString() : null;
    await db.prepare(`INSERT INTO auth_rate_limits (rate_key,attempt_count,window_started_at,blocked_until,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(rate_key) DO UPDATE SET attempt_count=excluded.attempt_count,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at`)
      .bind(scope.key, attempts, windowStartedAt, blockedUntil, nowText).run();
  }
  await db.prepare("DELETE FROM auth_rate_limits WHERE updated_at<?").bind(new Date(now.getTime() - 30 * 86_400_000).toISOString()).run();
}

async function clearSuccessfulLoginRate(username: string, ip?: string) {
  const db = getDatabase();
  await db.batch(loginRateScopes(username, ip).map((scope) => db.prepare("DELETE FROM auth_rate_limits WHERE rate_key=?").bind(scope.key)));
}

export async function hashPassword(password: string) {
  if (!validPasswordLength(password)) throw new Error(`密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
}

export async function verifyPassword(password: string, encoded: string) {
  if (passwordLength(password) > PASSWORD_MAX_LENGTH) return false;
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split("$");
  if (algorithm !== "pbkdf2-sha256" || !saltText || !expectedText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  return constantTimeEqual(await derivePassword(password, base64ToBytes(saltText), iterations), base64ToBytes(expectedText));
}

export function passwordHashNeedsUpgrade(encoded: string) {
  const [algorithm, iterationsText] = encoded.split("$");
  return algorithm !== "pbkdf2-sha256" || Number(iterationsText) < PASSWORD_ITERATIONS;
}

async function digest(value: string) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function randomToken() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))); }

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(bytes: Uint8Array) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let index = 0; index < bits.length; index += 5) result += BASE32_ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  return result;
}

function base32Decode(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("双重验证密钥格式不正确。");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return new Uint8Array(bytes);
}

async function mfaEncryptionKey() {
  const secret = process.env.APP_AUTH_SECRET?.trim();
  if (!secret) throw new Error("登录加密密钥尚未设置。");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`migra-mfa:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptMfaSecret(secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await mfaEncryptionKey(), new TextEncoder().encode(secret));
  return `v1$${bytesToBase64(iv)}$${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptMfaSecret(ciphertext: string) {
  const [version, iv, payload] = ciphertext.split("$");
  if (version !== "v1" || !iv || !payload) throw new Error("双重验证密钥无法读取。");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await mfaEncryptionKey(), base64ToBytes(payload));
  return new TextDecoder().decode(decrypted);
}

export function generateMfaSecret() { return base32Encode(crypto.getRandomValues(new Uint8Array(20))); }

async function totpCode(secret: string, counter: number) {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const offset = signature[signature.length - 1] & 15;
  const value = ((signature[offset] & 127) << 24) | (signature[offset + 1] << 16) | (signature[offset + 2] << 8) | signature[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secret: string, code: string) {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (const offset of [-1, 0, 1]) if (constantTimeEqual(new TextEncoder().encode(await totpCode(secret, counter + offset)), new TextEncoder().encode(normalized))) return true;
  return false;
}

export function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(5)), (value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export async function recoveryCodeHashes(codes: string[]) { return Promise.all(codes.map((code) => digest(`mfa-recovery:${code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`))); }

export async function verifyUserMfa(userId: string, secretCiphertext: string, recoveryHashesText: string | null, code: string) {
  if (await verifyTotp(await decryptMfaSecret(secretCiphertext), code)) return true;
  const normalized = code.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!normalized) return false;
  const suppliedHash = await digest(`mfa-recovery:${normalized}`);
  void recoveryHashesText;
  return getDatabase().transaction(async (db) => {
    const row = await db.prepare("SELECT mfa_recovery_hashes FROM users WHERE id=? FOR UPDATE").bind(userId).first();
    const hashes = JSON.parse(String(row?.mfa_recovery_hashes || "[]")) as string[];
    const index = hashes.findIndex((hash) => constantTimeEqual(new TextEncoder().encode(hash), new TextEncoder().encode(suppliedHash)));
    if (index < 0) return false;
    hashes.splice(index, 1);
    await db.prepare("UPDATE users SET mfa_recovery_hashes=?,updated_at=? WHERE id=?").bind(JSON.stringify(hashes), nowIso(), userId).run();
    return true;
  });
}

export async function dockerOwnerSetupRequired() {
  if (!isDockerDeployment()) return false;
  return !(await getDatabase().prepare("SELECT id FROM users LIMIT 1").first());
}

export type DockerOwnerSetupResult =
  | { status: "created"; token: string }
  | { status: "already_initialized" };

export async function createInitialDockerOwner(input: { username: string; displayName: string; password: string; ip?: string; userAgent?: string }): Promise<DockerOwnerSetupResult> {
  if (!isDockerDeployment()) throw new Error("当前初始化方式不可用。");
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error("用户名需为 3–40 位字母、数字或 ._-。");
  if (!displayName || Array.from(displayName).length > 100) throw new Error("显示姓名需要填写，且不能超过 100 个字符。");
  if (!validPasswordLength(input.password)) throw new Error(`密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`);

  const passwordHash = await hashPassword(input.password);
  const token = randomToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + sessionAbsoluteMilliseconds()).toISOString();
  const created = await getDatabase().transaction(async (tx) => {
    // Serialize first-run submissions so two browsers cannot create two owners.
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('migra_initial_owner'))").first();
    if (await tx.prepare("SELECT id FROM users LIMIT 1").first()) return false;
    const userId = newId("usr");
    await tx.prepare(`INSERT INTO users
      (id,username,username_normalized,display_name,password_hash,role_id,active,must_change_password,failed_attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,'role_owner',1,0,0,?,?)`)
      .bind(userId, username, normalizeUsername(username), displayName, passwordHash, now, now).run();
    await tx.prepare("INSERT INTO user_sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?,?)")
      .bind(newId("ses"), userId, await digest(token), now, now, expiresAt, input.ip || null, input.userAgent || null).run();
    await writeSecurityAudit({ actorUserId: userId, actorUsername: username, action: "USER_BOOTSTRAP", result: "SUCCESS", summary: "创建初始系统所有者", ip: input.ip, userAgent: input.userAgent }, tx);
    return true;
  });
  return created ? { status: "created", token } : { status: "already_initialized" };
}

async function permissionsForRole(roleId: string, roleCode: string) {
  if (roleCode === "OWNER") return ["*"];
  const result = await getDatabase().prepare("SELECT permission FROM role_permissions WHERE role_id=? ORDER BY permission").bind(roleId).all<{ permission: string }>();
  return result.results.map((row) => row.permission);
}

function toUser(row: Record<string, unknown>, permissions: string[]): AppUser {
  const mfaEnabled = Boolean(row.mfa_secret_ciphertext);
  const roleCode = String(row.role_code);
  return { id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    roleId: String(row.role_id), roleCode, roleName: String(row.role_name),
    orderScope: row.role_code === "OWNER" || row.order_scope !== "OWN" ? "ALL" : "OWN", permissions,
    mustChangePassword: Number(row.must_change_password) === 1, mfaEnabled,
    mfaRequired: privilegedMfaPolicyEnabled() && roleCode === "OWNER" && !mfaEnabled };
}

export async function authenticateDockerUser(username: string, password: string, metadata: { ip?: string; userAgent?: string; mfaCode?: string }) {
  const db = getDatabase();
  if (await isLoginRateLimited(username, metadata.ip)) {
    await verifyPasswordOrDummy(password);
    await writeSecurityAudit({ actorUsername: username || null, action: "AUTH_LOGIN", result: "FAILURE", summary: "登录请求过于频繁", ...metadata });
    return null;
  }
  const row = await db.prepare(`SELECT u.*,r.code AS role_code,r.name AS role_name,r.order_scope
    FROM users u JOIN roles r ON r.id=u.role_id WHERE u.username_normalized=?`).bind(normalizeUsername(username)).first();
  const now = new Date();
  const validPassword = await verifyPasswordOrDummy(password, row && Number(row.active) === 1 ? String(row.password_hash) : undefined);
  if (!row || Number(row.active) !== 1 || !validPassword) {
    if (row && Number(row.active) === 1) {
      await db.prepare("UPDATE users SET failed_attempts=failed_attempts+1,updated_at=? WHERE id=?").bind(now.toISOString(), row.id).run();
    }
    await recordLoginFailure(username, metadata.ip);
    await writeSecurityAudit({ actorUserId: row ? String(row.id) : null, actorUsername: username || null, action: "AUTH_LOGIN", result: "FAILURE", summary: "登录失败", ...metadata });
    return null;
  }
  if (row.mfa_secret_ciphertext && !await verifyUserMfa(String(row.id), String(row.mfa_secret_ciphertext), row.mfa_recovery_hashes ? String(row.mfa_recovery_hashes) : null, metadata.mfaCode || "")) {
    await recordLoginFailure(username, metadata.ip);
    await writeSecurityAudit({ actorUserId: String(row.id), actorUsername: String(row.username), action: "AUTH_MFA", result: "FAILURE", summary: "双重验证失败", ...metadata });
    return null;
  }
  const token = randomToken();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + sessionAbsoluteMilliseconds()).toISOString();
  const upgradedPasswordHash = passwordHashNeedsUpgrade(String(row.password_hash)) ? await hashPassword(password) : null;
  await db.transaction(async (tx) => {
    const cleanupBefore = new Date(now.getTime() - sessionRetentionMilliseconds()).toISOString();
    const cleaned = await tx.prepare("DELETE FROM user_sessions WHERE user_id=? AND (expires_at<? OR (revoked_at IS NOT NULL AND revoked_at<?))")
      .bind(row.id, createdAt, cleanupBefore).run();
    await tx.batch([
      tx.prepare(`UPDATE users SET failed_attempts=0,locked_until=NULL,last_login_at=?,updated_at=?,
        password_hash=COALESCE(?,password_hash),password_changed_at=CASE WHEN ?::text IS NULL THEN password_changed_at ELSE ? END WHERE id=?`)
        .bind(createdAt, createdAt, upgradedPasswordHash, upgradedPasswordHash, createdAt, row.id),
      tx.prepare("INSERT INTO user_sessions (id,user_id,token_hash,created_at,last_seen_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?,?)")
        .bind(newId("ses"), row.id, await digest(token), createdAt, createdAt, expiresAt, metadata.ip || null, metadata.userAgent || null),
    ]);
    if (upgradedPasswordHash) {
      await writeSecurityAudit({ actorUserId: String(row.id), actorUsername: String(row.username), action: "AUTH_PASSWORD_HASH_UPGRADE", result: "SUCCESS", summary: "登录时自动升级密码哈希", ...metadata }, tx);
    }
    if (Number(cleaned.meta?.changes || 0) > 0) {
      await writeSecurityAudit({ actorUserId: String(row.id), actorUsername: String(row.username), action: "AUTH_SESSION_CLEANUP", result: "SUCCESS", summary: `清理 ${cleaned.meta?.changes} 条过期会话`, ...metadata }, tx);
    }
    await writeSecurityAudit({ actorUserId: String(row.id), actorUsername: String(row.username), action: "AUTH_LOGIN", result: "SUCCESS", summary: "登录成功", ...metadata }, tx);
  });
  await clearSuccessfulLoginRate(username, metadata.ip);
  return { token, user: toUser(row, await permissionsForRole(String(row.role_id), String(row.role_code))) };
}

export async function verifyDockerSession(token: string | undefined, touchActivity = true) {
  if (!token) return null;
  const db = getDatabase();
  const tokenHash = await digest(token);
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - sessionIdleMilliseconds()).toISOString();
  const row = await db.prepare(`SELECT u.*,r.code AS role_code,r.name AS role_name,r.order_scope,s.id AS session_id,s.last_seen_at
    FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND u.active=1 AND r.active=1`)
    .bind(tokenHash, now.toISOString(), idleCutoff).first();
  if (!row) {
    await db.prepare("UPDATE user_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL AND (expires_at<=? OR last_seen_at<=?)")
      .bind(now.toISOString(), tokenHash, now.toISOString(), idleCutoff).run();
    return null;
  }
  if (touchActivity && Date.now() - new Date(String(row.last_seen_at)).getTime() > 15 * 60_000) {
    await db.prepare("UPDATE user_sessions SET last_seen_at=? WHERE id=?").bind(nowIso(), row.session_id).run();
  }
  return toUser(row, await permissionsForRole(String(row.role_id), String(row.role_code)));
}

export async function revokeDockerSession(token: string | undefined, db: AppDatabase = getDatabase()) {
  if (token) await db.prepare("UPDATE user_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(nowIso(), await digest(token)).run();
}

export async function listDockerSessions(userId: string, currentToken: string | undefined) {
  const currentHash = currentToken ? await digest(currentToken) : "";
  const result = await getDatabase().prepare(`SELECT id,created_at,last_seen_at,expires_at,ip,user_agent,
    CASE WHEN token_hash=? THEN 1 ELSE 0 END AS is_current
    FROM user_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? AND last_seen_at>?
    ORDER BY is_current DESC,last_seen_at DESC`)
    .bind(currentHash, userId, nowIso(), new Date(Date.now() - sessionIdleMilliseconds()).toISOString()).all();
  return result.results;
}
export async function revokeOtherDockerSessions(userId: string, currentToken: string | undefined, db: AppDatabase = getDatabase()) {
  const currentHash = currentToken ? await digest(currentToken) : "";
  return db.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL")
    .bind(nowIso(), userId, currentHash).run();
}

export async function revokeDockerSessionById(userId: string, sessionId: string, currentToken: string | undefined, db: AppDatabase = getDatabase()) {
  const currentHash = currentToken ? await digest(currentToken) : "";
  return db.prepare("UPDATE user_sessions SET revoked_at=? WHERE id=? AND user_id=? AND token_hash<>? AND revoked_at IS NULL")
    .bind(nowIso(), sessionId, userId, currentHash).run();
}

export function hasPermission(user: AppUser, permission: string) {
  return user.permissions.includes("*") || user.permissions.includes(permission);
}

export async function writeSecurityAudit(input: { actorUserId?: string | null; actorUsername?: string | null; action: string;
  result: "SUCCESS" | "FAILURE"; summary: string; ip?: string; userAgent?: string }, db: AppDatabase = getDatabase()) {
  await db.prepare(`INSERT INTO audit_logs
    (id,occurred_at,actor_user_id,actor_username_snapshot,action,entity_type,entity_id,entity_label,result,summary,changes_json,request_id,ip,user_agent)
    VALUES (?,?,?,?,?,'AUTH',NULL,NULL,?,?,NULL,?,?,?)`)
    .bind(newId("aud"), nowIso(), input.actorUserId || null, input.actorUsername || null, input.action,
      input.result, input.summary, newId("req"), input.ip || null, input.userAgent || null).run();
}
