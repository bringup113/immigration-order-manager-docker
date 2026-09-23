import { useRef, useState } from "react";
import { ApiRequestError, fetchApiJson } from "@/lib/api-client";

type MutationOptions = {
  successMessage: string;
  onSuccess?: () => void;
  onConflict?: () => void;
};

export function useMobileOrderMutation(orderNo: string, version: number, readPending: boolean, onReload: () => void) {
  const [pending, setPending] = useState(false);
  const [awaitingVersion, setAwaitingVersion] = useState<number | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const needsRefresh = awaitingVersion !== null && awaitingVersion === version;
  const disabled = pending || readPending || needsRefresh || uncertain || !Number.isSafeInteger(version) || version < 1;

  async function submit(payload: Record<string, unknown>, options: MutationOptions) {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await fetchApiJson<{ ok: boolean }>(`/api/orders/${encodeURIComponent(orderNo)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, expectedVersion: version }),
      });
      setAwaitingVersion(version);
      setUncertain(false);
      options.onSuccess?.();
      setNotice(options.successMessage);
      onReload();
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setAwaitingVersion(version);
        setUncertain(true);
        options.onConflict?.();
        setError("订单已被修改，正在刷新。请核对最新内容后再操作。");
        onReload();
      } else if (!(reason instanceof ApiRequestError)) {
        setAwaitingVersion(version);
        setUncertain(true);
        setError("无法确认是否已保存。正在刷新订单；请核对记录后再决定是否重试，系统不会自动重复提交。");
        onReload();
      } else {
        setError(reason.message);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return {
    pending, disabled, needsRefresh, uncertain, error, notice, submit,
    clearFeedback: () => { setError(""); setNotice(""); },
    acknowledge: () => { setAwaitingVersion(null); setUncertain(false); setError(""); },
  };
}
