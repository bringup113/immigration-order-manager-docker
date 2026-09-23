import { NextRequest, NextResponse } from "next/server";
import {
  authenticateDockerUser,
  createInitialDockerOwner,
  dockerOwnerSetupRequired,
  dockerSessionMaxAgeSeconds,
  dockerSessionCookieName,
  isDockerDeployment,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validPasswordLength,
  writeSecurityAudit,
} from "@/lib/docker-auth";
import { isAllowedMutationOrigin } from "@/lib/api-auth";
import { safeReturnPath } from "@/lib/safe-return-path";

export const dynamic = "force-dynamic";

const pageHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
};

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loginPage(returnTo: string, hasError = false, initialized = false) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>登录 · MIGRA</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3f6;color:#142238;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.card{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #dce5eb;border-radius:22px;box-shadow:0 24px 70px rgba(20,34,56,.12);padding:34px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.logo{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#18a99b;color:#fff;font-size:20px;font-weight:800}.brand b{display:block;font-size:17px}.brand small{color:#718096}.intro{margin:0 0 22px}.intro h1{font-size:24px;margin:0 0 8px}.intro p{font-size:14px;line-height:1.6;color:#64748b;margin:0}label{display:block;font-size:14px;font-weight:650;margin-bottom:8px}input{width:100%;height:46px;border:1px solid #cfdbe3;border-radius:12px;padding:0 14px;font-size:16px;outline:none}input:focus{border-color:#18a99b;box-shadow:0 0 0 3px rgba(24,169,155,.13)}button{width:100%;height:46px;margin-top:16px;border:0;border-radius:12px;background:#142238;color:#fff;font-size:15px;font-weight:700;cursor:pointer}.error,.notice{margin:0 0 14px;padding:10px 12px;border-radius:10px;font-size:13px}.error{background:#fff1f2;color:#be123c}.notice{background:#ecfdf5;color:#047857}
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="logo">M</span><span><b>MIGRA</b><small>移民订单管理</small></span></div>
    <div class="intro"><h1>登录系统</h1><p>请输入账号和密码。</p></div>
    ${initialized ? '<p class="notice">系统已经完成初始化，请使用系统所有者账号登录。</p>' : ""}
    ${hasError ? '<p class="error">用户名或密码不正确，或登录尝试过于频繁，请稍后再试。</p>' : ""}
    <form method="post" action="/api/auth/login">
      <input type="hidden" name="action" value="login">
      <input type="hidden" name="return_to" value="${escapeAttribute(returnTo)}">
      <label for="username">用户名</label>
      <input id="username" name="username" autocomplete="username" required autofocus placeholder="请输入用户名">
      <label for="password" style="margin-top:16px">密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" maxlength="128" required autofocus>
      <label for="mfa_code" style="margin-top:16px">双重验证码（如已启用）</label>
      <input id="mfa_code" name="mfa_code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码或恢复码">
      <button type="submit">进入系统</button>
    </form>
  </main>
</body>
</html>`;
}

function setupPage(returnTo: string, error = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>创建系统所有者 · MIGRA</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3f6;color:#142238;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.card{width:min(460px,calc(100% - 32px));margin:24px 0;background:#fff;border:1px solid #dce5eb;border-radius:22px;box-shadow:0 24px 70px rgba(20,34,56,.12);padding:34px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.logo{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:#18a99b;color:#fff;font-size:20px;font-weight:800}.brand b{display:block;font-size:17px}.brand small,.hint{color:#718096}.intro{margin:0 0 22px}.intro h1{font-size:24px;margin:0 0 8px}.intro p,.hint{font-size:13px;line-height:1.6;margin:0}label{display:block;font-size:14px;font-weight:650;margin:16px 0 8px}input{width:100%;height:46px;border:1px solid #cfdbe3;border-radius:12px;padding:0 14px;font-size:16px;outline:none}input:focus{border-color:#18a99b;box-shadow:0 0 0 3px rgba(24,169,155,.13)}button{width:100%;height:46px;margin-top:20px;border:0;border-radius:12px;background:#142238;color:#fff;font-size:15px;font-weight:700;cursor:pointer}.error{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fff1f2;color:#be123c;font-size:13px}
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="logo">M</span><span><b>MIGRA</b><small>移民订单管理</small></span></div>
    <div class="intro"><h1>创建系统所有者</h1><p>当前系统还没有账号。请创建第一个账号，该账号将拥有系统全部权限。</p></div>
    ${error ? `<p class="error">${escapeAttribute(error)}</p>` : ""}
    <form method="post" action="/api/auth/login">
      <input type="hidden" name="action" value="setup">
      <input type="hidden" name="return_to" value="${escapeAttribute(returnTo)}">
      <label for="username">用户名</label>
      <input id="username" name="username" autocomplete="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" required autofocus placeholder="3–40 位字母、数字或 ._-">
      <label for="display_name">显示姓名</label>
      <input id="display_name" name="display_name" autocomplete="name" maxlength="100" required placeholder="例如：Admin">
      <label for="password">密码</label>
      <input id="password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required>
      <p class="hint">密码长度为 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。</p>
      <label for="confirm_password">确认密码</label>
      <input id="confirm_password" name="confirm_password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}" required>
      <button type="submit">创建并进入系统</button>
    </form>
  </main>
</body>
</html>`;
}

function requestMetadata(request: NextRequest) {
  return {
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      undefined,
    userAgent: request.headers.get("user-agent") || undefined,
  };
}

function sessionResponse(
  request: NextRequest,
  token: string,
  returnTo: string,
) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: returnTo },
  });
  response.cookies.set(dockerSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      request.nextUrl.protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: dockerSessionMaxAgeSeconds(),
  });
  return response;
}

export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("return_to"));
  if (!isDockerDeployment()) {
    return NextResponse.redirect(
      new URL(
        `/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`,
        request.url,
      ),
    );
  }
  if (await dockerOwnerSetupRequired())
    return new NextResponse(setupPage(returnTo), { headers: pageHeaders });
  return new NextResponse(
    loginPage(
      returnTo,
      request.nextUrl.searchParams.get("error") === "1",
      request.nextUrl.searchParams.get("initialized") === "1",
    ),
    { headers: pageHeaders },
  );
}

export async function POST(request: NextRequest) {
  if (!isDockerDeployment())
    return NextResponse.json(
      { error: "当前登录方式不可用。" },
      { status: 404 },
    );
  if (!isAllowedMutationOrigin(request)) {
    await writeSecurityAudit({
      actorUsername: null,
      action: "SECURITY_ORIGIN_REJECT",
      result: "FAILURE",
      summary: "拒绝跨站登录请求",
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    }).catch(() => undefined);
    return NextResponse.json(
      { error: "已拒绝来自其他网站的登录请求。" },
      { status: 403 },
    );
  }
  const form = await request.formData();
  const returnTo = safeReturnPath(String(form.get("return_to") || "/"));
  const action = String(form.get("action") || "login");
  const username = String(form.get("username") || "");
  const password = String(form.get("password") || "");
  const metadata = requestMetadata(request);

  if (await dockerOwnerSetupRequired()) {
    if (action !== "setup")
      return new NextResponse(null, {
        status: 303,
        headers: {
          Location: `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`,
        },
      });
    const displayName = String(form.get("display_name") || "");
    const confirmPassword = String(form.get("confirm_password") || "");
    let validationError = "";
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username.trim()))
      validationError = "用户名需为 3–40 位字母、数字或 ._-。";
    else if (!displayName.trim() || Array.from(displayName.trim()).length > 100)
      validationError = "显示姓名需要填写，且不能超过 100 个字符。";
    else if (!validPasswordLength(password))
      validationError = `密码需要 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 个字符。`;
    else if (password !== confirmPassword)
      validationError = "两次输入的密码不一致。";
    if (validationError) {
      await writeSecurityAudit({
        actorUsername: username.trim() || null,
        action: "USER_BOOTSTRAP",
        result: "FAILURE",
        summary: "初始系统所有者资料校验失败",
        ...metadata,
      }).catch(() => undefined);
      return new NextResponse(setupPage(returnTo, validationError), {
        status: 400,
        headers: pageHeaders,
      });
    }
    try {
      const initialized = await createInitialDockerOwner({
        username,
        displayName,
        password,
        ...metadata,
      });
      if (initialized.status === "created")
        return sessionResponse(request, initialized.token, returnTo);
      await writeSecurityAudit({
        actorUsername: username.trim() || null,
        action: "USER_BOOTSTRAP",
        result: "FAILURE",
        summary: "拒绝重复初始化系统所有者",
        ...metadata,
      }).catch(() => undefined);
      return new NextResponse(null, {
        status: 303,
        headers: {
          Location: `/api/auth/login?initialized=1&return_to=${encodeURIComponent(returnTo)}`,
        },
      });
    } catch (error) {
      console.error(error);
      await writeSecurityAudit({
        actorUsername: username.trim() || null,
        action: "USER_BOOTSTRAP",
        result: "FAILURE",
        summary: "初始化系统所有者失败",
        ...metadata,
      }).catch(() => undefined);
      return new NextResponse(
        setupPage(returnTo, "系统所有者创建失败，请稍后重试。"),
        { status: 500, headers: pageHeaders },
      );
    }
  }

  if (action === "setup") {
    await writeSecurityAudit({
      actorUsername: username.trim() || null,
      action: "USER_BOOTSTRAP",
      result: "FAILURE",
      summary: "拒绝重复初始化系统所有者",
      ...metadata,
    }).catch(() => undefined);
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: `/api/auth/login?initialized=1&return_to=${encodeURIComponent(returnTo)}`,
      },
    });
  }
  const mfaCode = String(form.get("mfa_code") || "");
  const authenticated = await authenticateDockerUser(username, password, {
    ...metadata,
    mfaCode,
  });
  if (!authenticated) {
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: `/api/auth/login?error=1&return_to=${encodeURIComponent(returnTo)}`,
      },
    });
  }

  return sessionResponse(request, authenticated.token, returnTo);
}
