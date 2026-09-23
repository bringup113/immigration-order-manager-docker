"use client";

import Link from "next/link";
import { ArrowRight, LogOut, Monitor, ShieldCheck } from "lucide-react";
import { useCurrentUser } from "@/components/current-user-provider";
import { MobileInstallCard } from "@/components/mobile/mobile-pwa";
import { MobileCard } from "@/components/mobile/mobile-states";
import { MobileShell } from "@/components/mobile/mobile-shell";

export default function MobileMePage() {
  const { user } = useCurrentUser();
  const can = (permission: string) => user.permissions.includes("*") || user.permissions.includes(permission);
  const desktopHref = can("dashboard.read") ? "/" : can("orders.read") ? "/orders" : "/settings/profile";
  return <MobileShell title="我的"><div className="space-y-4">
    <MobileCard><p className="text-xs font-semibold tracking-widest text-teal-700">当前账号</p><h2 className="mt-2 text-xl font-semibold">{user.displayName}</h2><p className="mt-1 text-sm text-slate-500">{user.username} · {user.roleName}</p><p className="mt-3 text-xs text-slate-500">订单范围：{user.orderScope === "ALL" ? "全部订单" : "仅负责的订单"}</p></MobileCard>
    <MobileCard className="p-0"><Link href="/m/me/security" className="flex items-center gap-3 p-4"><ShieldCheck size={20} className="text-teal-700" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">登录与安全</span><span className="mt-1 block text-xs text-slate-500">修改密码、双重验证和登录设备</span></span><ArrowRight size={17} className="text-slate-400" /></Link></MobileCard>
    <MobileInstallCard />
    <MobileCard className="p-0"><Link href={desktopHref} className="flex items-center gap-3 p-4"><Monitor size={20} className="text-teal-700" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">切换到桌面版</span><span className="mt-1 block text-xs text-slate-500">完整建单、项目、代理和系统管理在桌面版使用</span></span><ArrowRight size={17} className="text-slate-400" /></Link></MobileCard>
    <form method="post" action="/api/auth/logout?return_to=%2Fm"><button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white p-4 text-sm font-semibold text-rose-700"><LogOut size={18} />退出登录</button></form>
    <p className="px-1 text-xs leading-5 text-slate-500">手机端可查看提醒和订单，并处理流程、跟进、收付款与材料；完整建单和管理配置在桌面版完成。添加到桌面请使用正式 HTTPS 地址，并按上方当前浏览器的提示操作。</p>
  </div></MobileShell>;
}
