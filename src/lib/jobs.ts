import { sql } from "drizzle-orm";
import { db, t } from "@/db";
import { performSend } from "./send";
import { emitSse, logEvent } from "./bus";
import { notifyEvent } from "./notify";
import { drainInboundQueue } from "./r2-queue";
import { pollDeliveryStatus } from "./delivery-poll";
import { syncAllConnectedAccounts } from "./microsoft-graph";

/**
 * DB-backed job runner (no Redis). Handles scheduled/undoable sends,
 * snoozes, and reminders. Claims jobs with SKIP LOCKED so even multiple
 * app instances would not double-run.
 */

const TICK_MS = 5000;
const MAX_ATTEMPTS = 3;

type JobRow = typeof t.jobs.$inferSelect;

async function handle(job: JobRow): Promise<void> {
  const payload = job.payload as Record<string, string>;
  switch (job.type) {
    case "send_message":
      await performSend(payload.messageId);
      break;

    case "unsnooze": {
      await db.execute(sql`
        UPDATE conversations SET snoozed_until = NULL, updated_at = now()
        WHERE id = ${payload.conversationId} AND snoozed_until IS NOT NULL
      `);
      emitSse("conversation.unsnoozed", { conversationId: payload.conversationId });
      await logEvent("conversation.unsnoozed", { conversationId: payload.conversationId });
      break;
    }

    case "reminder": {
      await logEvent("reminder.fired", {
        conversationId: payload.conversationId ?? null,
        payload: { note: payload.note ?? "" },
      });
      emitSse("reminder.fired", {
        conversationId: payload.conversationId ?? "",
        note: payload.note ?? "Reminder",
      });
      void notifyEvent(`⏰ Reminder: ${payload.note ?? "(no note)"}`).catch(() => {});
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function tick(): Promise<void> {
  const claimed = await db.execute<JobRow>(sql`
    UPDATE jobs SET status = 'running', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, status, run_at as "runAt", attempts, last_error as "lastError", created_at as "createdAt"
  `);

  for (const job of claimed) {
    try {
      await handle(job as unknown as JobRow);
      await db.execute(sql`UPDATE jobs SET status = 'done' WHERE id = ${job.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Job ${job.type} (${job.id}) failed:`, msg);
      if ((job.attempts as unknown as number) >= MAX_ATTEMPTS) {
        await db.execute(
          sql`UPDATE jobs SET status = 'failed', last_error = ${msg} WHERE id = ${job.id}`
        );
      } else {
        await db.execute(sql`
          UPDATE jobs SET status = 'pending', last_error = ${msg},
            run_at = now() + (interval '30 seconds' * attempts)
          WHERE id = ${job.id}
        `);
      }
    }
  }
}

const QUEUE_POLL_MS = 60_000; // R2 inbound buffer (pull mode for a local PC)
const STATUS_POLL_MS = 5 * 60_000; // Resend delivery status (webhook fallback)
const GRAPH_POLL_MS = 60_000; // Connected Outlook/M365 account inbox sync

export function startJobRunner(): void {
  const g = globalThis as unknown as { mhJobsStarted?: boolean };
  if (g.mhJobsStarted) return;
  g.mhJobsStarted = true;

  console.log("[jobs] runner started");
  let lastQueuePoll = 0;
  let lastStatusPoll = 0;
  let lastGraphPoll = 0;

  const loop = async () => {
    try {
      await tick();

      if (Date.now() - lastQueuePoll >= QUEUE_POLL_MS) {
        lastQueuePoll = Date.now();
        const n = await drainInboundQueue();
        if (n > 0) console.log(`[jobs] drained ${n} queued email(s) from R2`);
      }
      if (Date.now() - lastStatusPoll >= STATUS_POLL_MS) {
        lastStatusPoll = Date.now();
        await pollDeliveryStatus();
      }
      if (Date.now() - lastGraphPoll >= GRAPH_POLL_MS) {
        lastGraphPoll = Date.now();
        const n = await syncAllConnectedAccounts();
        if (n > 0) console.log(`[jobs] synced ${n} new email(s) from connected accounts`);
      }
    } catch (err) {
      console.error("[jobs] tick failed:", err);
    } finally {
      setTimeout(loop, TICK_MS);
    }
  };
  // Small delay so migrations/boot settle first.
  setTimeout(loop, 3000);
}
