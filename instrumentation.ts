export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    const { startSearchWorker } = await import("./lib/search-worker");
    startSearchWorker();
    const { startHealthMonitor } = await import("./lib/system-health");
    startHealthMonitor();
  }
}

export function onRequestError(_error: unknown, _request: unknown, context: {routePath: string}) {
  console.error(JSON.stringify({event:"request_error",route:context.routePath}));
}
