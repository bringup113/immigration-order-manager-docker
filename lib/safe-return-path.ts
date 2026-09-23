const APP_ORIGIN = "https://app.local";

const reservedPaths = new Set([
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
  "/api/auth/login",
  "/api/auth/logout",
]);

export function safeReturnPath(value: string | null | undefined, fallback = "/") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20]/u.test(value)
  )
    return fallback;

  let url: URL;
  try {
    url = new URL(value, APP_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== APP_ORIGIN || reservedPaths.has(url.pathname)) return fallback;
  if (url.pathname.startsWith("/api/auth/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
