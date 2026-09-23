"use client";

import { MobileSecurity } from "@/components/mobile/mobile-security";
import { MobileShell } from "@/components/mobile/mobile-shell";

export default function MobileSecurityPage() {
  return <MobileShell title="登录与安全" backHref="/m/me"><MobileSecurity /></MobileShell>;
}
