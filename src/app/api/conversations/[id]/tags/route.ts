import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { emitSse } from "@/lib/bus";

const schema = z.object({ tagId: z.string().uuid(), add: z.boolean() });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { tagId, add } = body.data;

  if (add) {
    await db
      .insert(t.conversationTags)
      .values({ conversationId: id, tagId })
      .onConflictDoNothing();
  } else {
    await db
      .delete(t.conversationTags)
      .where(
        and(
          eq(t.conversationTags.conversationId, id),
          eq(t.conversationTags.tagId, tagId)
        )
      );
  }
  emitSse("conversation.updated", { conversationId: id });
  return NextResponse.json({ ok: true });
}
