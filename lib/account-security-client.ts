import { fetchApiJson } from "@/lib/api-client";

export type AccountSession = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: number;
};

export type AccountMfaState = {
  enabled: boolean;
  required: boolean;
};

type MfaResponse = {
  secret?: unknown;
  otpauth?: unknown;
  reauthToken?: unknown;
  recoveryCodes?: unknown;
};

export async function loadAccountSecurity() {
  const [mfa, sessionResult] = await Promise.all([
    fetchApiJson<AccountMfaState>("/api/auth/mfa", { cache: "no-store" }),
    loadAccountSessions(),
  ]);
  return { mfa, sessions: sessionResult };
}

export async function loadAccountSessions() {
  const result = await fetchApiJson<{ sessions?: AccountSession[] }>(
    "/api/auth/sessions",
    { cache: "no-store" },
  );
  return result.sessions || [];
}

export function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
) {
  return fetchApiJson("/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

function postMfa(body: Record<string, unknown>) {
  return fetchApiJson<MfaResponse>("/api/auth/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function beginAccountMfa(options?: {
  password: string;
  currentCode: string;
}) {
  return postMfa({ action: "begin", ...options });
}

export function enableAccountMfa(code: string, reauthToken: string) {
  return postMfa({ action: "enable", code, reauthToken });
}

export function manageAccountMfa(
  action: "disable" | "recoveryCodes",
  password: string,
  code: string,
) {
  return postMfa({ action, password, code });
}

export function recoveryCodesFrom(response: MfaResponse) {
  return Array.isArray(response.recoveryCodes)
    ? response.recoveryCodes.map(String)
    : [];
}

export async function revokeAccountSessions(
  action: "revokeOthers" | "revokeOne",
  sessionId?: string,
) {
  return fetchApiJson<{ count?: number }>("/api/auth/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, sessionId }),
  });
}
