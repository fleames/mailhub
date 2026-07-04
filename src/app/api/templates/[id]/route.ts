import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

const schema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().max(998).optional(),
  bodyHtml: z.string().max(500_000).optional(),
  category: z.string().max(50).optional(),
  shortcut: z
    .string()
    .max(30)
    .regex(/^[a-z0-9-]*$/i, "Letters, numbers, and hyphens only")
    .nullable()
    .optional(),
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
  const values = {
    ...body.data,
    ...(body.data.shortcut !== undefined ? { shortcut: body.data.shortcut?.trim() || null } : {}),
  };
  const [row] = await db.update(t.templates).set(values).where(eq(t.templates.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.delete(t.templates).where(eq(t.templates.id, id));
  return NextResponse.json({ ok: true });
}
