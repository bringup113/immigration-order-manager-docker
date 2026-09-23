export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 0, code = "REQUEST_FAILED") {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function statusMessage(status: number) {
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号没有执行此操作的权限。";
  if (status === 404) return "请求的内容不存在。";
  if (status >= 500) return "服务器暂时无法处理请求，请稍后重试。";
  return "请求失败，请稍后重试。";
}

function statusCode(status: number) {
  if (status === 401) return "SESSION_EXPIRED";
  if (status === 403) return "PERMISSION_DENIED";
  return "REQUEST_FAILED";
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function readApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  const isJson = contentType.includes("application/json");
  let body: unknown = null;

  if (isJson) {
    try {
      body = await response.json();
    } catch {
      throw new ApiRequestError(
        response.ok ? "服务器返回了无法解析的数据。" : statusMessage(response.status),
        response.status,
        "INVALID_JSON",
      );
    }
  } else {
    const text = await response.text().catch(() => "");
    if (response.ok)
      throw new ApiRequestError(
        "服务器返回了非预期的数据格式。",
        response.status,
        "NON_JSON_RESPONSE",
      );
    body = text;
  }

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: unknown }).error || statusMessage(response.status))
        : statusMessage(response.status);
    throw new ApiRequestError(message, response.status, statusCode(response.status));
  }

  return body as T;
}

export async function fetchApiJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    return await readApiResponse<T>(await fetch(input, init));
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      error.status === 401 &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event("migra-session-expired"));
    throw error;
  }
}
