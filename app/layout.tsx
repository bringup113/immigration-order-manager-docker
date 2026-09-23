import { CurrentUserProvider } from "@/components/current-user-provider";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { safeReturnPath } from "@/lib/safe-return-path";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MIGRA V1.0 · 移民订单跟踪",
  description: "单机移民订单、项目流程、材料与订单收付款管理系统",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icons/migra-180.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MIGRA",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const returnTo = safeReturnPath(requestHeaders.get("x-migra-return-to"));
  const user = await requireChatGPTUser(returnTo);
  return (
    <html lang="zh-CN">
      <body className="antialiased"><CurrentUserProvider initialUser={user}>{children}</CurrentUserProvider></body>
    </html>
  );
}
