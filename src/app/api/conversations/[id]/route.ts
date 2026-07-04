import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { getThread } from "@/lib/queries";
import { deleteObject } from "@/lib/storage";
import { emitSse, logEvent } from "@/lib/bus";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const thread = await getThread(id);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(thread);
}

const patchSchema = z.object({
  read: z.boolean().optional(),
  starred: z.boolean().optional(),
  archived: z.boolean().optional(),
  trashed: z.boolean().optional(),
  spam: z.boolean().optional(),
  snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  internalNotes: z.string().max(20000).nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const p = body.data;

  const [conv] = await db.select().from(t.conversations).where(eq(t.conversations.id, id));
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const set: Partial<typeof t.conversations.$inferInsert> = { updatedAt: new Date() };

  if (p.read !== undefined) {
    set.unreadCount = p.read ? 0 : Math.max(conv.unreadCount, 1);
    await db
      .update(t.messages)
      .set({ isRead: p.read })
      .where(eq(t.messages.conversationId, id));
  }
  if (p.starred !== undefined) set.starred = p.starred;
  if (p.archived !== undefined) set.archivedAt = p.archived ? new Date() : null;
  if (p.trashed !== undefined) set.trashedAt = p.trashed ? new Date() : null;
  if (p.spam !== undefined) set.isSpam = p.spam;
  if (p.internalNotes !== undefined) set.internalNotes = p.internalNotes;

  if (p.snoozedUntil !== undefined) {
    set.snoozedUntil = p.snoozedUntil ? new Date(p.snoozedUntil) : null;
    if (p.snoozedUntil) {
      await db.insert(t.jobs).values({
        type: "unsnooze",
        payload: { conversationId: id },
        runAt: new Date(p.snoozedUntil),
      });
    }
  }

  await db.update(t.conversations).set(set).where(eq(t.conversations.id, id));
  await logEvent("conversation.updated", { conversationId: id, payload: p as Record<string, unknown> });
  emitSse("conversation.updated", { conversationId: id });

  const [updated] = await db.select().from(t.conversations).where(eq(t.conversations.id, id));
  return NextResponse.json(updated);
}

/** Permanent delete (empty from trash). Removes DB rows and storage objects. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const msgs = await db
    .select({ id: t.messages.id, rawR2Key: t.messages.rawR2Key })
    .from(t.messages)
    .where(eq(t.messages.conversationId, id));

  const atts = msgs.length
    ? await db
        .select({ r2Key: t.attachments.r2Key })
        .from(t.attachments)
        .where(inArray(t.attachments.messageId, msgs.map((m) => m.id)))
    : [];

  await db.delete(t.conversations).where(eq(t.conversations.id, id));

  // Best-effort storage cleanup after DB commit
  for (const key of [
    ...msgs.map((m) => m.rawR2Key).filter((k): k is string => Boolean(k)),
    ...atts.map((a) => a.r2Key),
  ]) {
    void deleteObject(key).catch(() => {});
  }

  await logEvent("conversation.deleted", { conversationId: id });
  emitSse("conversation.deleted", { conversationId: id });
  return NextResponse.json({ ok: true });
}
