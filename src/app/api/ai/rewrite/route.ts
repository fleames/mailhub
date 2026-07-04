import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { aiChat, rewritePrompt, translatePrompt, subjectPrompt } from "@/lib/ai";
import { htmlToText } from "@/lib/utils";

const schema = z.object({
  mode: z.enum(["rewrite", "translate", "subject"]),
  text: z.string().min(1).max(200_000),
  instruction: z.string().max(500).optional(),
  targetLang: z.string().max(50).optional(),
});

/** Draft assistance: rewrite / translate / generate subject. */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });
  const { mode, instruction, targetLang } = body.data;
  const text = htmlToText(body.data.text);

  try {
    const p =
      mode === "rewrite"
        ? rewritePrompt(text, instruction || "Improve clarity and tone; keep it concise.")
        : mode === "translate"
          ? translatePrompt(text, targetLang || "English")
          : subjectPrompt(text);
    const result = await aiChat(p.system, p.user, { maxTokens: mode === "subject" ? 60 : 1500 });
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
