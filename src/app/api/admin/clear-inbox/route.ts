import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, t } from "@/db";
import { deleteObject } from "@/lib/storage";
import { emitSse, logEvent } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CONFIRM_PHRASE = "DELETE ALL MAIL";

/**
 * Wipes every conversation, message, attachment, draft, contact, job, and
 * activity-log entry — the entire mailbox contents. Domains, mailboxes,
 * tags, signatures, templates, and settings are never touched: they're
 * configuration, not mail, and clearing the inbox shouldn't undo setup.
 */

async function currentCounts() {
  const [row] = await db.execute<{
    conversations: number;
    messages: number;
    attachments: number;
    contacts: number;
    drafts: number;
    storageBytes: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM messages) AS messages,
      (SELECT count(*)::int FROM attachments) AS attachments,
      (SELECT count(*)::int FROM contacts) AS contacts,
      (SELECT count(*)::int FROM drafts) AS drafts,
      (
        (SELECT coalesce(sum(size_bytes), 0) FROM messages) +
        (SELECT coalesce(sum(size_bytes), 0) FROM attachments)
      )::float8 AS "storageBytes"
  `);
  return row;
}

export async function GET() {
  return NextResponse.json(await currentCounts());
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Confirmation phrase didn't match "${CONFIRM_PHRASE}"` },
      { status: 400 }
    );
  }

  const before = await currentCounts();

  // Collect every storage object we're about to orphan, before deleting the rows.
  const rawKeys = await db
    .select({ key: t.messages.rawR2Key })
    .from(t.messages);
  const attKeys = await db.select({ key: t.attachments.r2Key }).from(t.attachments);
  const draftRows = await db.select({ atts: t.drafts.attachmentsJson }).from(t.drafts);

  const storageKeys = [
    ...rawKeys.map((r) => r.key).filter((k): k is string => Boolean(k)),
    ...attKeys.map((r) => r.key),
    ...draftRows.flatMap((d) => d.atts.map((a) => a.storageKey)),
  ];

  // Mail data only. Deleting conversations cascades to messages, attachments,
  // and conversation_tags; jobs/events/drafts/contacts are cleared explicitly.
  // Domains, mailboxes, tags, signatures, templates, and settings are untouched.
  await db.transaction(async (tx) => {
    await tx.delete(t.jobs);
    await tx.delete(t.events);
    await tx.delete(t.drafts);
    await tx.delete(t.conversations);
    await tx.delete(t.contacts);
  });

  for (const key of storageKeys) {
    void deleteObject(key).catch(() => {});
  }

  await logEvent("admin.clear_inbox", { payload: { ...before } });
  emitSse("inbox.cleared", {});

  return NextResponse.json({ ok: true, cleared: before });
}
