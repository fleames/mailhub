import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

const schema = z.object({
  signatureId: z.string().uuid().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db
    .update(t.connectedAccounts)
    .set(body.data)
    .where(eq(t.connectedAccounts.id, id))
    .returning({ id: t.connectedAccounts.id });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Disconnects the account. Already-ingested mail stays put; only the OAuth link is removed. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.delete(t.connectedAccounts).where(eq(t.connectedAccounts.id, id));
  return NextResponse.json({ ok: true });
}
