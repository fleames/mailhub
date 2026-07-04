import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import type { Address } from "@/db/schema";
import { htmlToText } from "@/lib/utils";

/** Render a conversation as plain text for AI prompts. */
export async function threadAsText(conversationId: string): Promise<string | null> {
  const [conv] = await db
    .select()
    .from(t.conversations)
    .where(eq(t.conversations.id, conversationId));
  if (!conv) return null;

  const msgs = await db
    .select()
    .from(t.messages)
    .where(eq(t.messages.conversationId, conversationId))
    .orderBy(t.messages.date);

  const parts = [`Subject: ${conv.subject || "(no subject)"}`];
  for (const m of msgs) {
    const from = m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail;
    const to = (m.toJson as Address[]).map((a) => a.email).join(", ");
    const body = m.textBody?.trim() || htmlToText(m.htmlBody ?? "") || "(empty)";
    parts.push(
      `--- ${m.direction === "outbound" ? "ME" : "THEM"} | From: ${from} | To: ${to} | ${m.date.toISOString()}\n${body.slice(0, 6000)}`
    );
  }
  return parts.join("\n\n").slice(0, 40000);
}

export function tryJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "")) as T;
  } catch {
    return null;
  }
}
