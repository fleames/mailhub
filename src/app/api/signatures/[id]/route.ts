import { NextRequest, NextResponse } from "next/server";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

const schema = z.object({
  name: z.string().min(1).max(100).optional(),
  html: z.string().max(100_000).optional(),
  isDefault: z.boolean().optional(),
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
  const [row] = await db.update(t.signatures).set(body.data).where(eq(t.signatures.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (body.data.isDefault) {
    await db.update(t.signatures).set({ isDefault: false }).where(ne(t.signatures.id, id));
  }
  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.delete(t.signatures).where(eq(t.signatures.id, id));
  return NextResponse.json({ ok: true });
}
