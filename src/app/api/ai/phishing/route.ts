import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";
import { aiChat, phishingPrompt } from "@/lib/ai";
import { htmlToText } from "@/lib/utils";
import { tryJson } from "../_lib";

const schema = z.object({ messageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, body.data.messageId));
  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const content = [
    `From: ${msg.fromName ?? ""} <${msg.fromEmail}>`,
    `Subject: ${msg.subject}`,
    `Auth-Results: ${(msg.headers as Record<string, string>)["authentication-results"] ?? "n/a"}`,
    `Heuristic score: ${msg.spamScore ?? 0}/10 (${(msg.spamReasons as string[]).join("; ") || "none"})`,
    "",
    msg.textBody?.slice(0, 6000) || htmlToText(msg.htmlBody ?? "").slice(0, 6000),
  ].join("\n");

  try {
    const p = phishingPrompt(content);
    const raw = await aiChat(p.system, p.user, { json: true, maxTokens: 500 });
    const parsed = tryJson<{ verdict: string; confidence: number; reasons: string[] }>(raw);
    return NextResponse.json(
      parsed ?? { verdict: "unknown", confidence: 0, reasons: [raw.slice(0, 300)] }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI failed" },
      { status: 502 }
    );
  }
}
