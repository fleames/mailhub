import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await db.delete(t.drafts).where(eq(t.drafts.id, id));
  return NextResponse.json({ ok: true });
}
