"use client";

import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function postMfa(body: unknown) {
  const response = await fetch("/api/auth/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

type SessionRow = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  is_current: number;
};

export default function ProfilePage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaQrCode, setMfaQrCode] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionMessage, setSessionMessage] = useState("");

  async function loadSessions() {
    const response = await fetch("/api/auth/sessions", { cache: "no-store" });
    if (response.ok) setSessions((await response.json()).sessions || []);
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/mfa", { cache: "no-store" }).then(async (response) =>
        response.ok ? response.json() : null,
      ),
      fetch("/api/auth/sessions", { cache: "no-store" }).then(
        async (response) => (response.ok ? response.json() : null),
      ),
    ])
      .then(([mfa, activeSessions]) => {
        if (mfa) {
          setMfaEnabled(Boolean(mfa.enabled));
          setMfaRequired(Boolean(mfa.required));
        }
        if (activeSessions) setSessions(activeSessions.sessions || []);
      })
      .catch(() => undefined);
  }, []);

  async function savePassword() {
    setError(false);
    setMessage("");
    if (next !== confirm) {
      setError(true);
      setMessage("两次输入的新密码不一致。");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "修改失败");
      router.replace("/api/auth/login?return_to=/");
    } catch (reason) {
      setError(true);
      setMessage(reason instanceof Error ? reason.message : "修改失败");
    } finally {
      setSaving(false);
    }
  }

  async function beginMfa() {
    setMfaMessage("");
    setRecoveryCodes([]);
    try {
      const data = await postMfa({ action: "begin" });
      setMfaSecret(data.secret);
      setMfaCode("");
      setMfaQrCode(
        await QRCode.toDataURL(data.otpauth, {
          width: 240,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0f172a", light: "#ffffff" },
        }),
      );
    } catch (reason) {
      setMfaMessage(reason instanceof Error ? reason.message : "设置失败");
    }
  }
  async function enableMfa() {
    setMfaMessage("");
    try {
      const data = await postMfa({ action: "enable", code: mfaCode });
      setMfaEnabled(true);
      setMfaRequired(false);
      setMfaSecret("");
      setMfaQrCode("");
      setMfaCode("");
      setRecoveryCodes(data.recoveryCodes || []);
      setMfaMessage(
        "双重验证已启用。恢复码只显示这一次，请保存在电脑端安全位置。",
      );
    } catch (reason) {
      setMfaMessage(reason instanceof Error ? reason.message : "启用失败");
    }
  }
  async function disableMfa() {
    setMfaMessage("");
    try {
      await postMfa({
        action: "disable",
        password: mfaPassword,
        code: mfaCode,
      });
      setMfaEnabled(false);
      setMfaPassword("");
      setMfaCode("");
      setRecoveryCodes([]);
      setMfaMessage("双重验证已关闭。");
    } catch (reason) {
      setMfaMessage(reason instanceof Error ? reason.message : "关闭失败");
    }
  }
  async function regenerateRecoveryCodes() {
    setMfaMessage("");
    try {
      const data = await postMfa({
        action: "recoveryCodes",
        password: mfaPassword,
        code: mfaCode,
      });
      setRecoveryCodes(data.recoveryCodes || []);
      setMfaPassword("");
      setMfaCode("");
      setMfaMessage("恢复码已更新，旧恢复码全部失效。");
    } catch (reason) {
      setMfaMessage(reason instanceof Error ? reason.message : "生成失败");
    }
  }

  async function revokeSessions(
    action: "revokeOthers" | "revokeOne",
    sessionId?: string,
  ) {
    setSessionMessage("");
    const response = await fetch("/api/auth/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, sessionId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSessionMessage(data.error || "注销设备失败。");
      return;
    }
    setSessionMessage(
      data.count
        ? `已注销 ${data.count} 个其他会话。`
        : "没有需要注销的其他会话。",
    );
    await loadSessions();
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="账号安全"
        title="登录与安全"
        description="维护登录密码和双重验证"
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-6">
          <div className="mb-6 flex items-start gap-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
            <KeyRound className="mt-0.5" size={20} />
            <p>密码需要 10–128 个字符。修改后会注销全部登录设备。</p>
          </div>
          <div className="space-y-5">
            <Field label="当前密码">
              <Input
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>
            <Field label="新密码">
              <Input
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </Field>
            <Field label="再次输入新密码">
              <Input
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            {message && <Notice error={error}>{message}</Notice>}
            <Button
              disabled={
                saving || !current || next.length < 10 || confirm.length < 10
              }
              onClick={() => void savePassword()}
              className="bg-[#0f766e]"
            >
              {saving ? "正在修改…" : "修改密码并重新登录"}
            </Button>
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 text-teal-700" size={22} />
              <div>
                <h2 className="font-semibold">双重验证</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {mfaRequired
                    ? "当前为公网安全模式，系统所有者必须启用双重验证。"
                    : "登录密码之后，再验证手机动态码；其他账号可按需启用。"}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={`status ${mfaEnabled ? "green" : "amber"}`}
            >
              {mfaEnabled ? "已启用" : mfaRequired ? "必须启用" : "未启用"}
            </Badge>
          </div>
          {!mfaEnabled && !mfaSecret && (
            <Button
              className="mt-6 bg-[#0f766e]"
              onClick={() => void beginMfa()}
            >
              开始设置
            </Button>
          )}
          {!mfaEnabled && mfaSecret && (
            <div className="mt-6 space-y-4">
              <div className="grid gap-5 rounded-xl border bg-slate-50 p-4 sm:grid-cols-[240px_1fr] sm:items-center">
                {mfaQrCode ? (
                  <Image
                    src={mfaQrCode}
                    alt="MIGRA 双重验证设置二维码"
                    width={240}
                    height={240}
                    unoptimized
                    className="rounded-xl border bg-white"
                  />
                ) : (
                  <div className="grid size-[240px] place-items-center rounded-xl border bg-white text-sm text-slate-400">
                    二维码生成中…
                  </div>
                )}
                <div>
                  <p className="font-medium text-slate-800">
                    使用验证器扫描二维码
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    打开 Microsoft Authenticator、Google
                    Authenticator、1Password
                    等应用，选择添加账号并扫描左侧二维码。
                  </p>
                  <details className="mt-4">
                    <summary className="cursor-pointer text-xs font-medium text-teal-700">
                      无法扫码？显示手动设置密钥
                    </summary>
                    <code className="mt-3 block break-all rounded-lg border bg-white p-3 text-sm font-semibold tracking-wider text-slate-800">
                      {mfaSecret}
                    </code>
                    <p className="mt-2 text-xs text-slate-400">
                      类型选择“基于时间”，算法 SHA-1，6 位，每 30 秒更新。
                    </p>
                  </details>
                </div>
              </div>
              <Field label="手机中显示的 6 位验证码">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) =>
                    setMfaCode(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMfaSecret("");
                    setMfaQrCode("");
                  }}
                >
                  取消
                </Button>
                <Button
                  disabled={mfaCode.length !== 6}
                  className="bg-[#0f766e]"
                  onClick={() => void enableMfa()}
                >
                  验证并启用
                </Button>
              </div>
            </div>
          )}
          {mfaEnabled && (
            <div className="mt-6 space-y-4">
              <Field label="当前密码">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={mfaPassword}
                  onChange={(event) => setMfaPassword(event.target.value)}
                />
              </Field>
              <Field label="6 位动态码或一条恢复码">
                <Input
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!mfaPassword || !mfaCode}
                  onClick={() => void regenerateRecoveryCodes()}
                >
                  重新生成恢复码
                </Button>
                <Button
                  variant="outline"
                  className="text-rose-700"
                  disabled={!mfaPassword || !mfaCode}
                  onClick={() => void disableMfa()}
                >
                  关闭双重验证
                </Button>
              </div>
            </div>
          )}
          {mfaMessage && (
            <div className="mt-4">
              <Notice
                error={
                  !mfaMessage.includes("已") && !mfaMessage.includes("更新")
                }
              >
                {mfaMessage}
              </Notice>
            </div>
          )}
          {recoveryCodes.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                一次性恢复码
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-amber-950">
                {recoveryCodes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
              <p className="mt-3 text-xs text-amber-800">
                每条只能使用一次；重新生成后旧恢复码会全部失效。
              </p>
            </div>
          )}
        </section>
        <section className="panel p-6 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <MonitorSmartphone className="mt-0.5 text-teal-700" size={22} />
              <div>
                <h2 className="font-semibold">登录设备</h2>
                <p className="mt-1 text-sm text-slate-500">
                  会话在连续 60 分钟未使用或登录满 12
                  小时后自动失效；部署时可调整。
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => void revokeSessions("revokeOthers")}
            >
              <LogOut size={16} />
              退出其他所有设备
            </Button>
          </div>
          <div className="mt-5 divide-y rounded-xl border">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {session.is_current ? "当前设备" : "其他设备"}
                    </p>
                    {session.is_current ? (
                      <Badge variant="outline" className="status green">
                        当前
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {session.user_agent || "未知浏览器"}
                    {session.ip ? ` · ${session.ip}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    最近使用：
                    {new Date(session.last_seen_at).toLocaleString("zh-CN")} ·
                    登录：{new Date(session.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
                {!session.is_current && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void revokeSessions("revokeOne", session.id)}
                  >
                    退出此设备
                  </Button>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-400">
                暂无有效会话
              </p>
            )}
          </div>
          {sessionMessage && (
            <div className="mt-4">
              <Notice error={sessionMessage.includes("失败")}>
                {sessionMessage}
              </Notice>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Notice({
  error,
  children,
}: {
  error: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
    >
      {children}
    </p>
  );
}
