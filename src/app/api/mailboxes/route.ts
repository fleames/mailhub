import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db
    .select({ mailbox: t.mailboxes, domain: t.domains })
    .from(t.mailboxes)
    .innerJoin(t.domains, eq(t.mailboxes.domainId, t.domains.id))
    .orderBy(t.domains.name, t.mailboxes.localPart);
  return NextResponse.json(
    rows.map((r) => ({
      ...r.mailbox,
      domain: r.domain,
      email: `${r.mailbox.localPart}@${r.domain.name}`,
    }))
  );
}

const schema = z.object({
  domainId: z.string().uuid(),
  localPart: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._+-]+$/i, "Invalid local part"),
  displayName: z.string().max(100).nullable().optional(),
  signatureId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db
    .insert(t.mailboxes)
    .values({ ...body.data, localPart: body.data.localPart.toLowerCase() })
    .onConflictDoNothing()
    .returning();
  if (!row) return NextResponse.json({ error: "Mailbox already exists" }, { status: 409 });
  return NextResponse.json(row);
}
