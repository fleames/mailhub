import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { ingestRawEmail } from "@/lib/ingest";

/**
 * Inbound email endpoint. The Cloudflare Email Worker POSTs the raw MIME
 * here with `Authorization: Bearer <INBOUND_SECRET>` plus envelope headers.
 * Max size is guarded by the worker (Cloudflare caps messages at ~25MB).
 */

export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  const expected = env.INBOUND_SECRET;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  if (raw.length > 30 * 1024 * 1024) {
    return NextResponse.json({ error: "Message too large" }, { status: 413 });
  }

  const result = await ingestRawEmail({
    raw,
    envelopeTo: req.headers.get("x-envelope-to"),
    envelopeFrom: req.headers.get("x-envelope-from"),
  });

  // Always 200 once the raw is persisted — even parse failures are stored
  // as dead-letter messages. 5xx would make Cloudflare bounce the mail.
  return NextResponse.json(result);
}
