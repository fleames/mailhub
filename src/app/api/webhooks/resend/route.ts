import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { getConfig } from "@/lib/config";
import { emitSse, logEvent } from "@/lib/bus";

/**
 * Resend delivery webhooks (svix-signed): sent, delivered, bounced,
 * complained, delivery_delayed. Gives factual delivery status per message.
 */

function verifySvix(payload: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;

  // Guard against replay (5 min window)
  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const expected = Buffer.from(signed);

  return signatures.split(" ").some((part) => {
    const sig = part.split(",")[1];
    if (!sig) return false;
    const candidate = Buffer.from(sig);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

const STATUS_MAP: Record<string, "sent" | "delivered" | "bounced" | "complained" | "failed"> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

export async function POST(req: NextRequest) {
  const cfg = await getConfig();
  const payload = await req.text();

  if (cfg.resendWebhookSecret) {
    if (!verifySvix(payload, req.headers, cfg.resendWebhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    // No secret configured: reject rather than accept unauthenticated status updates.
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET not configured" },
      { status: 501 }
    );
  }

  const event = JSON.parse(payload) as {
    type: string;
    data?: { email_id?: string; bounce?: { message?: string } };
  };

  const resendId = event.data?.email_id;
  const newStatus = STATUS_MAP[event.type];
  if (!resendId || !newStatus) return NextResponse.json({ ok: true, ignored: true });

  const [msg] = await db
    .select()
    .from(t.messages)
    .where(eq(t.messages.resendId, resendId));
  if (!msg) return NextResponse.json({ ok: true, unknown: true });

  // Never regress delivered -> sent (webhooks can arrive out of order)
  if (msg.status === "delivered" && newStatus === "sent") {
    return NextResponse.json({ ok: true });
  }

  await db
    .update(t.messages)
    .set({
      status: newStatus,
      ...(newStatus === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(newStatus === "bounced" || newStatus === "failed"
        ? { error: event.data?.bounce?.message ?? event.type }
        : {}),
    })
    .where(eq(t.messages.id, msg.id));

  await logEvent(`delivery.${newStatus}`, {
    conversationId: msg.conversationId,
    messageId: msg.id,
    payload: { resendId, type: event.type },
  });
  emitSse("message.status", {
    conversationId: msg.conversationId,
    messageId: msg.id,
    status: newStatus,
  });

  return NextResponse.json({ ok: true });
}
