"use client";

import Link from "next/link";

export function MobileCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function MobileMessage({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border p-4 text-sm ${tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-600"}`}>{children}</div>;
}

export function MobilePermission({ message = "当前账号没有查看此内容的权限。" }: { message?: string }) {
  return <MobileMessage tone="error"><p>{message}</p><Link className="mt-2 inline-block font-semibold underline" href="/m/me">返回我的</Link></MobileMessage>;
}
