import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { aiChat, summarizePrompt } from "@/lib/ai";
import { threadAsText } from "../_lib";

const schema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const thread = await threadAsText(body.data.conversationId);
  if (!thread) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  try {
    const p = summarizePrompt(thread);
    const summary = await aiChat(p.system, p.user, { maxTokens: 500 });
    await db
      .update(t.conversations)
      .set({ aiSummary: summary, aiSummaryAt: new Date() })
      .where(eq(t.conversations.id, body.data.conversationId));
    return NextResponse.json({ summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
