"use client";
import { useCurrentUser } from "@/components/current-user-provider";
export function usePermissions() {
  const {user}=useCurrentUser();
  return (permission:string) => user.permissions.includes("*") || user.permissions.includes(permission);
}
