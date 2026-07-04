import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { aiChat, autoTagPrompt } from "@/lib/ai";
import { emitSse } from "@/lib/bus";
import { threadAsText, tryJson } from "../_lib";

const schema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { conversationId } = body.data;

  const allTags = await db.select().from(t.tags);
  if (allTags.length === 0) {
    return NextResponse.json({ error: "Create some tags first (Settings → Tags)" }, { status: 400 });
  }

  const [conv] = await db.select().from(t.conversations).where(eq(t.conversations.id, conversationId));
  if (!conv) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const thread = (await threadAsText(conversationId)) ?? "";

  try {
    const p = autoTagPrompt(conv.subject, thread.slice(0, 3000), allTags.map((tg) => tg.name));
    const raw = await aiChat(p.system, p.user, { json: true, maxTokens: 200 });
    const parsed = tryJson<{ tags: string[] }>(raw);
    const names = (parsed?.tags ?? []).map((n) => n.toLowerCase());
    const matched = allTags.filter((tg) => names.includes(tg.name.toLowerCase()));

    if (matched.length > 0) {
      await db
        .insert(t.conversationTags)
        .values(matched.map((tg) => ({ conversationId, tagId: tg.id })))
        .onConflictDoNothing();
      emitSse("conversation.updated", { conversationId });
    }
    return NextResponse.json({ applied: matched.map((tg) => tg.name) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
