"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Install capability and standalone mode only exist in the mounted browser. */

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { MobileCard, MobileMessage } from "@/components/mobile/mobile-states";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let pendingInstallPrompt: InstallPromptEvent | null = null;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function MobilePwaRegistration() {
  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      pendingInstallPrompt = event as InstallPromptEvent;
      window.dispatchEvent(new Event("migra-install-available"));
    };
    const installed = () => {
      pendingInstallPrompt = null;
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator && window.isSecureContext)
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/m" })
        .catch(() => undefined);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  return null;
}

export function MobileInstallCard() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [secure, setSecure] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setInstalled(isStandalone());
    setSecure(window.isSecureContext);
    setIsIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    setPrompt(pendingInstallPrompt);
    const installAvailable = () => setPrompt(pendingInstallPrompt);
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setMessage("MIGRA 已添加到手机桌面。");
    };
    window.addEventListener("migra-install-available", installAvailable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("migra-install-available", installAvailable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    pendingInstallPrompt = null;
    setPrompt(null);
    setMessage(choice.outcome === "accepted" ? "正在添加到手机桌面…" : "已取消安装，可稍后再试。");
  }

  return (
    <MobileCard>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Smartphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900">添加到手机桌面</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            添加后可像应用一样从桌面打开。订单和收付款仍只在联网时读取和保存。
          </p>
        </div>
      </div>
      {!secure && (
        <div className="mt-3">
          <MobileMessage tone="error">当前地址不是安全的 HTTPS，浏览器可能不允许安装。内网 HTTP 可继续作为普通网页使用。</MobileMessage>
        </div>
      )}
      {installed ? (
        <p className="mt-4 text-sm font-semibold text-teal-700">已从桌面应用模式打开</p>
      ) : prompt ? (
        <button type="button" onClick={() => void install()} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white">
          <Download size={17} />安装 MIGRA
        </button>
      ) : isIos ? (
        <ol className="mt-4 space-y-1 text-xs leading-5 text-slate-600">
          <li>1. 使用 Safari 打开当前页面。</li>
          <li>2. 点击“共享”，选择“添加到主屏幕”。</li>
          <li>3. 开启“作为网页 App 打开”后确认添加。</li>
        </ol>
      ) : (
        <p className="mt-4 text-xs leading-5 text-slate-500">请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。如果没有该选项，请确认正在使用正式 HTTPS 地址。</p>
      )}
      {message && <p role="status" className="mt-3 text-xs text-slate-600">{message}</p>}
    </MobileCard>
  );
}
