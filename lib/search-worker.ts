import { getDatabase } from "@/db/database";
import { rebuildEntity, rebuildOrder } from "@/lib/order-search";

type Job = { entity_type: string; entity_id: string; requested_at: string };
let started = false;
let running = false;

export async function processSearchJobs() {
  if (running) return;
  running = true;
  const until = Date.now() + 500;
  try {
    for (let count = 0; count < 20 && Date.now() < until; count++) {
      let job: Job | null = null;
      try {
        const processed = await getDatabase().transaction(async (db) => {
          // One worker across all app instances, without locking queue rows while reading business tables.
          const lock = await db.prepare("SELECT pg_try_advisory_xact_lock(192736,1) AS acquired").first<{ acquired: boolean }>();
          if (!lock?.acquired) return false;
          job = await db.prepare("SELECT entity_type,entity_id,requested_at::text AS requested_at FROM search_jobs WHERE available_at<=now() ORDER BY available_at,requested_at LIMIT 1").first<Job>();
          if (!job) return false;
          if (job.entity_type === "order") await rebuildOrder(db, job.entity_id, job.requested_at);
          else await rebuildEntity(db, job.entity_type, job.entity_id);
          // A concurrent edit bumps requested_at. Never acknowledge that newer request.
          await db.prepare("DELETE FROM search_jobs WHERE entity_type=? AND entity_id=? AND requested_at=?")
            .bind(job.entity_type, job.entity_id, job.requested_at).run();
          return true;
        });
        if (!processed) break;
      } catch (error) {
        console.error("Search indexing failed", error instanceof Error ? error.message : "unknown error");
        const failed = job as Job | null;
        if (failed) await getDatabase().prepare(`UPDATE search_jobs SET attempts=attempts+1,
          available_at=now()+LEAST(300,5*(attempts+1))*interval '1 second'
          WHERE entity_type=? AND entity_id=? AND requested_at=?`)
          .bind(failed.entity_type, failed.entity_id, failed.requested_at).run();
        break;
      }
    }
  } finally { running = false; }
}

export function startSearchWorker() {
  if (started || !process.env.DATABASE_URL || process.env.SEARCH_WORKER_ENABLED === "0") return;
  started = true;
  const tick = () => void processSearchJobs().catch((error) => console.error("Search worker unavailable", error instanceof Error ? error.message : "unknown error"));
  const timer = setInterval(tick, 1000);
  timer.unref();
  tick();
}
