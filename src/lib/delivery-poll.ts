import { Resend } from "resend";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db, t } from "@/db";
import { getConfig } from "./config";
import { emitSse, logEvent } from "./bus";
import { sendaroGet } from "./sendaro";

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
  if (!cfg.resendApiKey && !cfg.sendaroApiKey) return;

  polling = true;
  try {
    if (cfg.resendApiKey) await pollResend(cfg.resendApiKey);
    await pollSendaro(cfg.sendaroApiKey);
  } finally {
    polling = false;
  }
}

async function pollResend(apiKey: string): Promise<void> {
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
        or(sql`${t.messages.outboundProvider} is null`, ne(t.messages.outboundProvider, "sendaro")),
        sql`${t.messages.sentAt} > now() - interval '48 hours'`
      )
    )
    .limit(20);
  if (pending.length === 0) return;

  const resend = new Resend(apiKey);
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
}

const SENDARO_DONE: Record<string, "delivered" | "bounced" | "complained" | "failed"> = {
  delivered: "delivered",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
  rejected: "failed",
  cancelled: "failed",
};

async function pollSendaro(apiKey: string | null): Promise<void> {
  if (!apiKey) return;
  const pending = await db
    .select({
      id: t.messages.id,
      conversationId: t.messages.conversationId,
      providerIds: t.messages.providerIds,
    })
    .from(t.messages)
    .where(
      and(
        eq(t.messages.direction, "outbound"),
        eq(t.messages.status, "sent"),
        eq(t.messages.outboundProvider, "sendaro"),
        sql`${t.messages.sentAt} > now() - interval '48 hours'`
      )
    )
    .limit(20);

  for (const msg of pending) {
    const ids = msg.providerIds ?? [];
    if (ids.length === 0) continue;
    try {
      const statuses: { status: string; error: string | null }[] = [];
      for (const id of ids) {
        const email = await sendaroGet(apiKey, id);
        if (!email) {
          statuses.length = 0;
          break;
        }
        statuses.push(email);
      }
      if (statuses.length !== ids.length) continue;
      const newStatus = combineSendaro(statuses.map((s) => s.status));
      if (!newStatus) continue;
      const error = statuses.find((s) => s.error)?.error;
      await db
        .update(t.messages)
        .set({
          status: newStatus,
          ...(newStatus === "delivered" ? { deliveredAt: new Date() } : {}),
          ...(newStatus !== "delivered" ? { error: error ? `Sendaro: ${error}` : `Sendaro: ${newStatus}` } : {}),
        })
        .where(eq(t.messages.id, msg.id));
      await logEvent(`delivery.${newStatus}`, {
        conversationId: msg.conversationId,
        messageId: msg.id,
        payload: { via: "sendaro", ids, source: "poll" },
      });
      emitSse("message.status", {
        conversationId: msg.conversationId,
        messageId: msg.id,
        status: newStatus,
      });
    } catch {
      // transient — next poll
    }
  }
}

function combineSendaro(statuses: string[]): "delivered" | "bounced" | "complained" | "failed" | null {
  if (statuses.some((s) => s === "queued" || s === "sending" || s === "sent" || s === "delayed")) {
    return null;
  }
  if (statuses.some((s) => s === "complained")) return "complained";
  if (statuses.some((s) => s === "bounced")) return "bounced";
  if (statuses.some((s) => SENDARO_DONE[s] === "failed")) return "failed";
  if (statuses.every((s) => s === "delivered")) return "delivered";
  return null;
}
