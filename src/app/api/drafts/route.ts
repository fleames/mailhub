import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db
    .select({
      draft: t.drafts,
      mailbox: t.mailboxes,
      domain: t.domains,
    })
    .from(t.drafts)
    .leftJoin(t.mailboxes, eq(t.drafts.mailboxId, t.mailboxes.id))
    .leftJoin(t.domains, eq(t.mailboxes.domainId, t.domains.id))
    .orderBy(desc(t.drafts.updatedAt));
  return NextResponse.json(
    rows.map((r) => ({ ...r.draft, mailbox: r.mailbox, domain: r.domain }))
  );
}

const address = z.object({ email: z.string(), name: z.string().optional() });
const schema = z.object({
  id: z.string().uuid().optional(),
  mailboxId: z.string().uuid().nullable().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  replyToMessageId: z.string().uuid().nullable().optional(),
  to: z.array(address).default([]),
  cc: z.array(address).default([]),
  bcc: z.array(address).default([]),
  subject: z.string().default(""),
  bodyHtml: z.string().default(""),
  attachments: z
    .array(
      z.object({
        storageKey: z.string(),
        filename: z.string(),
        contentType: z.string(),
        sizeBytes: z.number(),
      })
    )
    .default([]),
});

/** Upsert a draft (autosave from the composer). */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const d = body.data;
  const values = {
    mailboxId: d.mailboxId ?? null,
    conversationId: d.conversationId ?? null,
    replyToMessageId: d.replyToMessageId ?? null,
    toJson: d.to,
    ccJson: d.cc,
    bccJson: d.bcc,
    subject: d.subject,
    bodyHtml: d.bodyHtml,
    attachmentsJson: d.attachments,
    updatedAt: new Date(),
  };

  if (d.id) {
    const [row] = await db
      .update(t.drafts)
      .set(values)
      .where(eq(t.drafts.id, d.id))
      .returning();
    if (row) return NextResponse.json(row);
  }
  const [row] = await db.insert(t.drafts).values(values).returning();
  return NextResponse.json(row);
}
