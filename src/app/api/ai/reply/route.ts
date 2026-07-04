import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiChat, suggestRepliesPrompt } from "@/lib/ai";
import { threadAsText, tryJson } from "../_lib";

const schema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const thread = await threadAsText(body.data.conversationId);
  if (!thread) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  try {
    const p = suggestRepliesPrompt(thread);
    const raw = await aiChat(p.system, p.user, { json: true, maxTokens: 1200 });
    const parsed = tryJson<{ replies: { tone: string; text: string }[] }>(raw);
    if (!parsed?.replies?.length) {
      return NextResponse.json({ replies: [{ tone: "reply", text: raw }] });
    }
    return NextResponse.json({ replies: parsed.replies.slice(0, 3) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
