import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

const schema = z.object({
  name: z.string().max(200).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
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
    .update(t.contacts)
    .set(body.data)
    .where(eq(t.contacts.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.delete(t.contacts).where(eq(t.contacts.id, id));
  return NextResponse.json({ ok: true });
}
