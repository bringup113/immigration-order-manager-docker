/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { Plus, RefreshCw, Save, Shield, UserCheck, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState, LoadingState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type User = {
  id: string;
  username: string;
  display_name: string;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  role_id: string;
  role_code: string;
  role_name: string;
};
type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_system: number;
  active: number;
  order_scope: "ALL" | "OWN";
  user_count: number;
  permissions: string[];
};
type Group = { label: string; permissions: [string, string][] };
type Me = { roleCode: string; permissions: string[] };

const blankUser = {
  username: "",
  displayName: "",
  password: "",
  roleId: "role_readonly",
};
const blankRole = {
  id: "",
  name: "",
  description: "",
  orderScope: "OWN" as "ALL" | "OWN",
  permissions: [] as string[],
};

async function jsonFetch(url: string, options?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userOpen, setUserOpen] = useState(false);
  const [userForm, setUserForm] = useState(blankUser);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleForm, setRoleForm] = useState(blankRole);
  const [passwordTarget, setPasswordTarget] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const canUsers = Boolean(
    me?.permissions.includes("*") || me?.permissions.includes("users.write"),
  );
  const canRoles = Boolean(
    me?.permissions.includes("*") || me?.permissions.includes("roles.write"),
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [userData, roleData, meData] = await Promise.all([
        jsonFetch("/api/admin/users"),
        jsonFetch("/api/admin/roles"),
        jsonFetch("/api/auth/me"),
      ]);
      setUsers(userData);
      setRoles(roleData.roles);
      setGroups(roleData.groups);
      setMe(meData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function post(url: string, body: unknown) {
    setSaving(true);
    setNotice("");
    try {
      await jsonFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setNotice("操作已保存并写入操作日志。");
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }
  function openCreateUser() {
    setEditingUser(null);
    setUserForm(blankUser);
    setUserOpen(true);
  }
  function openEditUser(user: User) {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      displayName: user.display_name,
      password: "",
      roleId: user.role_id,
    });
    setUserOpen(true);
  }
  async function saveUser() {
    const ok = await post(
      "/api/admin/users",
      editingUser
        ? {
            action: "update",
            userId: editingUser.id,
            username: userForm.username,
            displayName: userForm.displayName,
            roleId: userForm.roleId,
          }
        : { action: "create", ...userForm },
    );
    if (ok) setUserOpen(false);
  }
  function openRole(role?: Role) {
    setRoleForm(
      role
        ? {
            id: role.id,
            name: role.name,
            description: role.description || "",
            orderScope: role.order_scope,
            permissions: role.permissions,
          }
        : blankRole,
    );
    setRoleOpen(true);
  }
  async function saveRole() {
    const ok = await post("/api/admin/roles", {
      action: roleForm.id ? "update" : "create",
      roleId: roleForm.id,
      name: roleForm.name,
      description: roleForm.description,
      orderScope: roleForm.orderScope,
      permissions: roleForm.permissions,
    });
    if (ok) setRoleOpen(false);
  }
  function togglePermission(code: string) {
    setRoleForm((value) => ({
      ...value,
      permissions: value.permissions.includes(code)
        ? value.permissions.filter((item) => item !== code)
        : [...value.permissions, code],
    }));
  }
  async function toggleUser(user: User) {
    if (user.active) {
      setError("");
      setToggleTarget(user);
      return;
    }
    await post("/api/admin/users", {
      action: "toggle",
      userId: user.id,
      active: true,
    });
  }
  async function confirmDisableUser() {
    if (!toggleTarget) return;
    const ok = await post("/api/admin/users", {
      action: "toggle",
      userId: toggleTarget.id,
      active: false,
    });
    if (ok) setToggleTarget(null);
  }
  return (
    <AppShell>
      <PageHeader
        eyebrow="系统管理"
        title="用户与角色"
        description="内置三种角色保持稳定，可按业务需要增加自定义角色"
        action={
          canUsers ? (
            <Button onClick={openCreateUser} className="bg-[#0f766e]">
              <Plus size={16} /> 新建用户
            </Button>
          ) : undefined
        }
      />
      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      {error && <ErrorState message={error} />}{" "}
      {loading ? (
        <LoadingState />
      ) : (
        <>
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h2 className="section-title">用户</h2>
                <p className="section-subtitle">停用账号会立即注销其全部会话</p>
              </div>
              <Badge variant="outline">{users.length} 个账号</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="table-head">
                    <th>用户</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>最后登录</th>
                    {canUsers && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr className="table-row" key={user.id}>
                      <td>
                        <b>{user.display_name}</b>
                        <p className="mt-1 text-xs text-slate-400">
                          {user.username}
                        </p>
                      </td>
                      <td>{user.role_name}</td>
                      <td>
                        <Badge
                          variant="outline"
                          className={`status ${user.active ? "green" : "amber"}`}
                        >
                          {user.active
                            ? user.must_change_password
                              ? "待修改密码"
                              : "启用"
                            : "停用"}
                        </Badge>
                      </td>
                      <td>
                        {user.last_login_at
                          ? new Date(user.last_login_at).toLocaleString("zh-CN")
                          : "从未登录"}
                      </td>
                      {canUsers && (
                        <td>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditUser(user)}
                            >
                              <Save size={14} /> 编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPasswordTarget(user);
                                setTempPassword("");
                              }}
                            >
                              <RefreshCw size={14} /> 重置密码
                            </Button>
                            {user.role_code !== "OWNER" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void toggleUser(user)}
                              >
                                {user.active ? (
                                  <UserX size={14} />
                                ) : (
                                  <UserCheck size={14} />
                                )}{" "}
                                {user.active ? "停用" : "启用"}
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel mt-5 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="section-title">角色与权限</h2>
                <p className="section-subtitle">
                  内置角色不可修改；系统所有者可以维护自定义角色
                </p>
              </div>
              {canRoles && (
                <Button variant="outline" onClick={() => openRole()}>
                  <Plus size={15} /> 自定义角色
                </Button>
              )}
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {roles
                .filter((role) => role.active)
                .map((role) => (
                  <article
                    key={role.id}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <div className="flex items-start justify-between">
                      <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700">
                        <Shield size={18} />
                      </span>
                      <Badge variant="outline">
                        {role.is_system ? "内置" : "自定义"}
                      </Badge>
                    </div>
                    <h3 className="mt-4 font-semibold">{role.name}</h3>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">
                      {role.description || "未填写说明"}
                    </p>
                    <p className="mt-3 text-xs text-slate-400">
                      订单范围：
                      {role.code === "OWNER" || role.order_scope === "ALL"
                        ? "全部订单"
                        : "本人订单"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {role.code === "OWNER"
                        ? "全部权限"
                        : `${role.permissions.length} 项权限`}{" "}
                      · {role.user_count || 0} 位用户
                    </p>
                    {canRoles && !role.is_system && (
                      <Button
                        className="mt-4 w-full"
                        variant="outline"
                        onClick={() => openRole(role)}
                      >
                        编辑权限
                      </Button>
                    )}
                  </article>
                ))}
            </div>
          </section>
        </>
      )}
      <Dialog open={userOpen} onOpenChange={setUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "编辑用户" : "新建用户"}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? "修改用户名后，当前有效会话保持登录；下次登录使用新用户名。"
                : "新用户首次登录必须修改临时密码。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="用户名">
              <Input
                value={userForm.username}
                onChange={(e) =>
                  setUserForm({ ...userForm, username: e.target.value })
                }
              />
              <p className="text-xs text-slate-500">
                3–40 位，只能使用字母、数字、点、下划线或短横线。
              </p>
            </Field>
            <Field label="显示姓名">
              <Input
                value={userForm.displayName}
                onChange={(e) =>
                  setUserForm({ ...userForm, displayName: e.target.value })
                }
              />
            </Field>
            {!editingUser && (
              <Field label="临时密码">
                <Input
                  type="password"
                  value={userForm.password}
                  onChange={(e) =>
                    setUserForm({ ...userForm, password: e.target.value })
                  }
                />
              </Field>
            )}
            <Field label="角色">
              <Select
                value={userForm.roleId}
                onValueChange={(roleId) => setUserForm({ ...userForm, roleId })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter(
                      (role) =>
                        role.active &&
                        (me?.roleCode === "OWNER" || role.code !== "OWNER"),
                    )
                    .map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUserOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                saving ||
                !userForm.displayName ||
                !/^[A-Za-z0-9._-]{3,40}$/.test(userForm.username) ||
                (!editingUser && userForm.password.length < 10)
              }
              onClick={() => void saveUser()}
              className="bg-[#0f766e]"
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {roleForm.id ? "编辑自定义角色" : "新建自定义角色"}
            </DialogTitle>
            <DialogDescription>
              数据范围控制能看到哪些订单；功能权限控制能在这些订单里做什么。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="角色名称">
              <Input
                value={roleForm.name}
                onChange={(e) =>
                  setRoleForm({ ...roleForm, name: e.target.value })
                }
              />
            </Field>
            <Field label="订单数据范围">
              <Select
                value={roleForm.orderScope}
                onValueChange={(orderScope) =>
                  setRoleForm({
                    ...roleForm,
                    orderScope: orderScope as "ALL" | "OWN",
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OWN">仅本人负责的订单</SelectItem>
                  <SelectItem value="ALL">全部订单</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="说明">
              <Textarea
                value={roleForm.description}
                onChange={(e) =>
                  setRoleForm({ ...roleForm, description: e.target.value })
                }
              />
            </Field>
          </div>
          <div className="grid max-h-[360px] gap-3 overflow-y-auto sm:grid-cols-2">
            {groups.map((group) => (
              <section key={group.label} className="rounded-xl border p-4">
                <h4 className="mb-3 text-sm font-semibold">{group.label}</h4>
                <div className="space-y-2">
                  {group.permissions.map(([code, label]) => (
                    <label
                      key={code}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={roleForm.permissions.includes(code)}
                        onChange={() => togglePermission(code)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                saving || !roleForm.name || !roleForm.permissions.length
              }
              onClick={() => void saveRole()}
              className="bg-[#0f766e]"
            >
              保存角色
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(passwordTarget)}
        onOpenChange={(open) => !open && setPasswordTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              重置 {passwordTarget?.display_name} 的密码
            </DialogTitle>
            <DialogDescription>
              保存后会注销该用户所有设备，并要求下次登录修改密码。
            </DialogDescription>
          </DialogHeader>
          <Field label="新临时密码">
            <Input
              type="password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordTarget(null)}>
              取消
            </Button>
            <Button
              disabled={saving || tempPassword.length < 10}
              onClick={async () => {
                if (
                  passwordTarget &&
                  (await post("/api/admin/users", {
                    action: "resetPassword",
                    userId: passwordTarget.id,
                    password: tempPassword,
                  }))
                )
                  setPasswordTarget(null);
              }}
              className="bg-[#0f766e]"
            >
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title="停用用户"
        description={
          <>
            确定停用“{toggleTarget?.display_name}
            ”吗？该账号的全部登录会话会立即失效，重新启用前无法再登录。
          </>
        }
        confirmLabel="确认停用"
        pending={saving}
        pendingLabel="正在停用…"
        error={error || undefined}
        onConfirm={() => void confirmDisableUser()}
      />
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
