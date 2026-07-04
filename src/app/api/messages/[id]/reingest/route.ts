import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { getObject } from "@/lib/storage";
import { ingestRawEmail } from "@/lib/ingest";

/** Re-run ingestion for a dead-letter message from its stored raw MIME. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, id));
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (msg.status !== "ingest_failed") {
    return NextResponse.json({ error: "Message is not a failed ingest" }, { status: 400 });
  }
  if (!msg.rawR2Key) {
    return NextResponse.json({ error: "No raw source stored" }, { status: 404 });
  }

  const raw = await getObject(msg.rawR2Key);
  if (!raw) return NextResponse.json({ error: "Raw object missing" }, { status: 404 });

  // Remove the dead-letter placeholder (and its single-message conversation), then re-ingest.
  const conversationId = msg.conversationId;
  await db.delete(t.messages).where(eq(t.messages.id, id));
  const remaining = await db
    .select({ id: t.messages.id })
    .from(t.messages)
    .where(eq(t.messages.conversationId, conversationId))
    .limit(1);
  if (remaining.length === 0) {
    await db.delete(t.conversations).where(eq(t.conversations.id, conversationId));
  }

  const result = await ingestRawEmail({ raw, envelopeFrom: msg.fromEmail || null });
  return NextResponse.json(result);
}
