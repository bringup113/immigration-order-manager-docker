"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useCurrentUser } from "@/components/current-user-provider";
import { MobileCard, MobileMessage } from "@/components/mobile/mobile-states";
import { fetchApiJson } from "@/lib/api-client";

type SessionRow = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: number;
};

type MfaState = {
  enabled: boolean;
  required: boolean;
};

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base outline-none focus:border-teal-600";
const primaryButton = "min-h-11 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50";
const secondaryButton = "min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-xs font-semibold text-slate-600">{label}</span>{children}</label>;
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

export function MobileSecurity() {
  const { user, refresh } = useCurrentUser();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  const [mfa, setMfa] = useState<MfaState>({ enabled: user.mfaEnabled, required: user.mfaRequired });
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaReauthToken, setMfaReauthToken] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaError, setMfaError] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionError, setSessionError] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadSessions() {
    const data = await fetchApiJson<{ sessions: SessionRow[] }>("/api/auth/sessions", { cache: "no-store" });
    setSessions(data.sessions || []);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchApiJson<MfaState>("/api/auth/mfa", { cache: "no-store" }),
      fetchApiJson<{ sessions: SessionRow[] }>("/api/auth/sessions", { cache: "no-store" }),
    ])
      .then(([mfaResult, sessionResult]) => {
        if (!active) return;
        setMfa(mfaResult);
        setSessions(sessionResult.sessions || []);
      })
      .catch((reason) => {
        if (!active) return;
        setSessionError(true);
        setSessionMessage(errorText(reason, "读取安全设置失败。"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function changePassword() {
    setPasswordMessage("");
    setPasswordError(false);
    if (newPassword !== confirmPassword) {
      setPasswordError(true);
      setPasswordMessage("两次输入的新密码不一致。");
      return;
    }
    setPasswordBusy(true);
    try {
      await fetchApiJson("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      // Changing the password invalidates every session. Use a full document
      // navigation so the new login page cannot retain stale client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/api/auth/login?return_to=%2Fm%2Fme%2Fsecurity");
    } catch (reason) {
      setPasswordError(true);
      setPasswordMessage(errorText(reason, "修改密码失败。"));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function postMfa(body: Record<string, unknown>) {
    return fetchApiJson<Record<string, unknown>>("/api/auth/mfa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function beginMfa() {
    setMfaBusy(true);
    setMfaMessage("");
    setMfaError(false);
    setRecoveryCodes([]);
    try {
      const data = await postMfa({
        action: "begin",
        ...(mfa.enabled ? { password: mfaPassword, currentCode: mfaCode } : {}),
      });
      const secret = String(data.secret || "");
      const QRCode = (await import("qrcode")).default;
      setMfaSecret(secret);
      setMfaReauthToken(String(data.reauthToken || ""));
      setMfaQrCode(await QRCode.toDataURL(String(data.otpauth || ""), {
        width: 240,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      }));
      setMfaPassword("");
      setMfaCode("");
    } catch (reason) {
      setMfaError(true);
      setMfaMessage(errorText(reason, "设置双重验证失败。"));
    } finally {
      setMfaBusy(false);
    }
  }

  async function enableMfa() {
    setMfaBusy(true);
    setMfaMessage("");
    setMfaError(false);
    try {
      const data = await postMfa({ action: "enable", code: mfaCode, reauthToken: mfaReauthToken });
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes.map(String) : []);
      setMfa({ enabled: true, required: false });
      setMfaSecret("");
      setMfaQrCode("");
      setMfaReauthToken("");
      setMfaCode("");
      setMfaMessage("双重验证已启用。恢复码只显示这一次，请安全保存。");
      await refresh();
    } catch (reason) {
      setMfaError(true);
      setMfaMessage(errorText(reason, "启用双重验证失败。"));
    } finally {
      setMfaBusy(false);
    }
  }

  async function manageMfa(action: "disable" | "recoveryCodes") {
    setMfaBusy(true);
    setMfaMessage("");
    setMfaError(false);
    try {
      const data = await postMfa({ action, password: mfaPassword, code: mfaCode });
      setMfaPassword("");
      setMfaCode("");
      if (action === "disable") {
        setMfa({ enabled: false, required: false });
        setRecoveryCodes([]);
        setMfaMessage("双重验证已关闭。");
        await refresh();
      } else {
        setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes.map(String) : []);
        setMfaMessage("恢复码已更新，旧恢复码全部失效。");
      }
    } catch (reason) {
      setMfaError(true);
      setMfaMessage(errorText(reason, "更新双重验证失败。"));
    } finally {
      setMfaBusy(false);
    }
  }

  async function revokeSessions(action: "revokeOthers" | "revokeOne", sessionId?: string) {
    setSessionsBusy(true);
    setSessionMessage("");
    setSessionError(false);
    try {
      const data = await fetchApiJson<{ count: number }>("/api/auth/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, sessionId }),
      });
      setSessionMessage(data.count ? `已注销 ${data.count} 个其他会话。` : "没有需要注销的其他会话。");
      await loadSessions();
    } catch (reason) {
      setSessionError(true);
      setSessionMessage(errorText(reason, "注销设备失败。"));
    } finally {
      setSessionsBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <MobileCard>
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 shrink-0 text-teal-700" size={20} />
          <div>
            <h2 className="font-semibold">修改密码</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              密码需要 10–128 个字符；修改后所有设备需要重新登录。
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <Field label="当前密码">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label="新密码">
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="再次输入新密码">
            <input
              className={inputClass}
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>
          {passwordMessage && (
            <MobileMessage tone={passwordError ? "error" : "neutral"}>
              {passwordMessage}
            </MobileMessage>
          )}
          <button
            type="button"
            className={`${primaryButton} w-full`}
            disabled={
              passwordBusy ||
              !currentPassword ||
              newPassword.length < 10 ||
              confirmPassword.length < 10
            }
            onClick={() => void changePassword()}
          >
            {passwordBusy ? "正在修改…" : "修改密码并重新登录"}
          </button>
        </div>
      </MobileCard>

      {!user.mustChangePassword && (
        <MobileCard>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 shrink-0 text-teal-700" size={20} />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">双重验证</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {mfa.required
                  ? "当前为公网安全模式，系统所有者必须启用。"
                  : "登录密码之后，再验证手机动态码。"}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                mfa.enabled
                  ? "bg-teal-50 text-teal-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {mfa.enabled ? "已启用" : mfa.required ? "必须启用" : "未启用"}
            </span>
          </div>

          {!mfa.enabled && !mfaSecret && (
            <button
              type="button"
              className={`${primaryButton} mt-4 w-full`}
              disabled={mfaBusy || loading}
              onClick={() => void beginMfa()}
            >
              {mfaBusy ? "正在准备…" : "开始设置"}
            </button>
          )}

          {mfaSecret && (
            <div className="mt-4 space-y-4">
              {mfaQrCode ? (
                <Image
                  src={mfaQrCode}
                  alt="MIGRA 双重验证二维码"
                  width={240}
                  height={240}
                  unoptimized
                  className="mx-auto rounded-xl border bg-white"
                />
              ) : (
                <div className="mx-auto grid size-[240px] place-items-center rounded-xl border text-sm text-slate-400">
                  二维码生成中…
                </div>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-teal-700">
                  无法扫码？显示手动设置密钥
                </summary>
                <code className="mt-2 block break-all rounded-xl bg-slate-50 p-3 text-sm font-semibold tracking-wider">
                  {mfaSecret}
                </code>
              </details>
              <Field label="验证器中的 6 位动态码">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={mfaBusy}
                  onClick={() => {
                    setMfaSecret("");
                    setMfaQrCode("");
                    setMfaReauthToken("");
                    setMfaCode("");
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={mfaBusy || mfaCode.length !== 6}
                  onClick={() => void enableMfa()}
                >
                  {mfaBusy ? "验证中…" : "验证并启用"}
                </button>
              </div>
            </div>
          )}

          {mfa.enabled && !mfaSecret && (
            <div className="mt-4 space-y-3">
              <Field label="当前密码">
                <input
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  value={mfaPassword}
                  onChange={(event) => setMfaPassword(event.target.value)}
                />
              </Field>
              <Field label="动态码或一条恢复码">
                <input
                  className={inputClass}
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                />
              </Field>
              <div className="grid gap-2">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={mfaBusy || !mfaPassword || !mfaCode}
                  onClick={() => void manageMfa("recoveryCodes")}
                >
                  重新生成恢复码
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={mfaBusy || !mfaPassword || !mfaCode}
                  onClick={() => void beginMfa()}
                >
                  更换验证器
                </button>
                <button
                  type="button"
                  className={`${secondaryButton} text-rose-700`}
                  disabled={mfaBusy || !mfaPassword || !mfaCode}
                  onClick={() => void manageMfa("disable")}
                >
                  关闭双重验证
                </button>
              </div>
            </div>
          )}

          {mfaMessage && (
            <div className="mt-4">
              <MobileMessage tone={mfaError ? "error" : "neutral"}>
                {mfaMessage}
              </MobileMessage>
            </div>
          )}
          {recoveryCodes.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">一次性恢复码</p>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-amber-950">
                {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-800">
                每条只能使用一次；请立即复制到安全位置。
              </p>
            </div>
          )}
        </MobileCard>
      )}

      <MobileCard>
        <div className="flex items-start gap-3">
          <MonitorSmartphone className="mt-0.5 shrink-0 text-teal-700" size={20} />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">登录设备</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              查看当前有效会话，发现异常设备时可立即注销。
            </p>
          </div>
        </div>
        <button
          type="button"
          className={`${secondaryButton} mt-4 flex w-full items-center justify-center gap-2`}
          disabled={sessionsBusy || loading}
          onClick={() => void revokeSessions("revokeOthers")}
        >
          <LogOut size={16} />退出其他所有设备
        </button>
        <div className="mt-4 divide-y rounded-xl border border-slate-200">
          {sessions.map((session) => (
            <div key={session.id} className="p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {session.is_current ? "当前设备" : "其他设备"}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    {session.user_agent || "未知浏览器"}
                    {session.ip ? ` · ${session.ip}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    最近使用：{new Date(session.last_seen_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                {!session.is_current && (
                  <button
                    type="button"
                    disabled={sessionsBusy}
                    onClick={() => void revokeSessions("revokeOne", session.id)}
                    className="shrink-0 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    退出
                  </button>
                )}
              </div>
            </div>
          ))}
          {!loading && sessions.length === 0 && (
            <p className="p-4 text-center text-sm text-slate-400">暂无有效会话</p>
          )}
          {loading && (
            <p className="p-4 text-center text-sm text-slate-400">正在读取…</p>
          )}
        </div>
        {sessionMessage && (
          <div className="mt-4">
            <MobileMessage tone={sessionError ? "error" : "neutral"}>
              {sessionMessage}
            </MobileMessage>
          </div>
        )}
      </MobileCard>
    </div>
  );
}
