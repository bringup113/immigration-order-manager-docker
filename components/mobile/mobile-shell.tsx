"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Home, Search, UserRound, BriefcaseBusiness, ArrowLeft } from "lucide-react";
import { useCurrentUser } from "@/components/current-user-provider";
import { MobilePwaRegistration } from "@/components/mobile/mobile-pwa";

const items = [
  { href: "/m", label: "工作台", icon: Home, permission: "dashboard.read" },
  { href: "/m/orders", label: "订单", icon: BriefcaseBusiness, permission: "orders.read" },
  { href: "/m/search", label: "搜索", icon: Search, permission: "orders.read" },
  { href: "/m/me", label: "我的", icon: UserRound, permission: "" },
];

export function MobileShell({
  title,
  children,
  backHref,
  action,
}: {
  title: string;
  children: React.ReactNode;
  backHref?: string;
  action?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useCurrentUser();
  const can = (permission: string) =>
    !permission || user.permissions.includes("*") || user.permissions.includes(permission);

  useEffect(() => {
    if (!user.mustChangePassword && !user.mfaRequired) return;
    if (pathname !== "/m/me/security") router.replace("/m/me/security");
  }, [pathname, router, user.mustChangePassword, user.mfaRequired]);

  if ((user.mustChangePassword || user.mfaRequired) && pathname !== "/m/me/security") {
    return <div className="grid min-h-dvh place-items-center bg-[#f7f9f9] px-6 text-center text-sm text-slate-500">正在进入登录与安全设置…</div>;
  }

  return (
    <div className="min-h-dvh bg-[#eaf0f2] text-slate-900">
      <MobilePwaRegistration />
      <div className="mx-auto min-h-dvh max-w-[520px] bg-[#f7f9f9] shadow-[0_0_48px_rgba(15,35,45,0.08)]">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
          {backHref && (
            <Link href={backHref} aria-label="返回" className="-ml-1 grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 active:bg-slate-100">
              <ArrowLeft size={21} />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {action}
        </header>
        <main className="min-h-[calc(100dvh-120px)] px-4 pb-[calc(90px+env(safe-area-inset-bottom))] pt-4">
          {children}
        </main>
        <nav aria-label="手机端主导航" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-[520px] grid-cols-4 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          {items.map(({ href, label, icon: Icon, permission }) => {
            if (!can(permission)) return <span key={href} />;
            const active = href === "/m" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium ${active ? "text-teal-700" : "text-slate-500"}`}>
                <Icon size={21} strokeWidth={active ? 2.3 : 1.8} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
