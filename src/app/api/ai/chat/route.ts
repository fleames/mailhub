import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiChatConversation } from "@/lib/ai";

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20_000),
      })
    )
    .min(1)
    .max(60),
});

/** Free-form multi-turn chat with the configured AI provider — not tied to any email. */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  try {
    const reply = await aiChatConversation(body.data.messages);
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
