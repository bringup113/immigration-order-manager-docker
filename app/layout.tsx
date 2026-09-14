import { CurrentUserProvider } from "@/components/current-user-provider";
import type { Metadata } from "next";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MIGRA V1.0 · 移民订单跟踪",
  description: "单机移民订单、项目流程、材料与订单收付款管理系统",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireChatGPTUser("/");
  return (
    <html lang="zh-CN">
      <body className="antialiased"><CurrentUserProvider initialUser={user}>{children}</CurrentUserProvider></body>
    </html>
  );
}
