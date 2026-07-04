import { Resend } from "resend";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { getConfig } from "./config";
import { emitSse, logEvent } from "./bus";

/**
 * Delivery-status polling for hubs without a public webhook endpoint
 * (local PC). Recently sent messages are checked against Resend's API and
 * promoted sent → delivered/bounced/complained. Webhooks, when reachable,
 * simply get there first — this is the fallback, and it's idempotent.
 */

const STATUS_MAP: Record<string, "delivered" | "bounced" | "complained" | "failed"> = {
  delivered: "delivered",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
};

let polling = false;

export async function pollDeliveryStatus(): Promise<void> {
  if (polling) return;
  const cfg = await getConfig();
  if (!cfg.resendApiKey) return;

  polling = true;
  try {
    const pending = await db
      .select({
        id: t.messages.id,
        conversationId: t.messages.conversationId,
        resendId: t.messages.resendId,
      })
      .from(t.messages)
      .where(
        and(
          eq(t.messages.direction, "outbound"),
          eq(t.messages.status, "sent"),
          isNotNull(t.messages.resendId),
          sql`${t.messages.sentAt} > now() - interval '48 hours'`
        )
      )
      .limit(20);
    if (pending.length === 0) return;

    const resend = new Resend(cfg.resendApiKey);
    for (const msg of pending) {
      try {
        const { data } = await resend.emails.get(msg.resendId!);
        const lastEvent = (data as { last_event?: string } | null)?.last_event;
        const newStatus = lastEvent ? STATUS_MAP[lastEvent] : undefined;
        if (!newStatus) continue;

        await db
          .update(t.messages)
          .set({
            status: newStatus,
            ...(newStatus === "delivered" ? { deliveredAt: new Date() } : {}),
            ...(newStatus !== "delivered" ? { error: `Resend: ${lastEvent}` } : {}),
          })
          .where(eq(t.messages.id, msg.id));

        await logEvent(`delivery.${newStatus}`, {
          conversationId: msg.conversationId,
          messageId: msg.id,
          payload: { resendId: msg.resendId, source: "poll" },
        });
        emitSse("message.status", {
          conversationId: msg.conversationId,
          messageId: msg.id,
          status: newStatus,
        });
      } catch {
        // transient API failure — retried on the next poll
      }
    }
  } finally {
    polling = false;
  }
}
