import { getConfig } from "./config";

/**
 * OpenAI-compatible chat client (DeepSeek by default).
 * All AI features are optional: without an API key they return a clear error.
 */

type Turn = { role: "system" | "user" | "assistant"; content: string };

async function chatCompletion(
  messages: Turn[],
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.aiApiKey) {
    throw new Error("No AI API key configured (Settings → AI)");
  }
  const url = `${cfg.aiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.aiApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.aiModel,
      messages,
      max_tokens: opts.maxTokens ?? 1200,
      temperature: opts.temperature ?? 0.4,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty response");
  return content.trim();
}

export async function aiChat(
  system: string,
  user: string,
  opts: { json?: boolean; maxTokens?: number } = {}
): Promise<string> {
  return chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    opts
  );
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Free-form multi-turn chat — the "quick access DeepSeek chat" panel, not tied to any email. */
export async function aiChatConversation(history: ChatTurn[]): Promise<string> {
  return chatCompletion(
    [
      {
        role: "system",
        content:
          "You are a helpful general-purpose assistant embedded in MailHub, a personal email client. Be concise and direct. You are not limited to email topics.",
      },
      // Cap context so a long-running chat can't blow past the model's window.
      ...history.slice(-30),
    ],
    { maxTokens: 1500, temperature: 0.6 }
  );
}

const clip = (s: string, n = 12000) => (s.length > n ? s.slice(0, n) + "\n[...truncated]" : s);

export function summarizePrompt(thread: string) {
  return {
    system:
      "You summarize email conversations. Be concise and factual. Output 2-4 sentences followed by a bullet list of action items if any exist. No preamble.",
    user: clip(thread),
  };
}

export function suggestRepliesPrompt(thread: string) {
  return {
    system:
      'You draft email replies. Given a conversation, propose 3 distinct replies (short/neutral, friendly, detailed). Respond with JSON: {"replies": [{"tone": string, "text": string}]}. Plain text replies, no subject lines, no signatures.',
    user: clip(thread),
  };
}

export function rewritePrompt(draft: string, instruction: string) {
  return {
    system:
      "You rewrite email drafts. Return ONLY the rewritten email body as plain text. Preserve the author's intent and any factual content.",
    user: `Instruction: ${instruction}\n\nDraft:\n${clip(draft, 8000)}`,
  };
}

export function translatePrompt(text: string, targetLang: string) {
  return {
    system: `You translate emails. Translate the given email to ${targetLang}. Return ONLY the translation.`,
    user: clip(text, 8000),
  };
}

export function phishingPrompt(email: string) {
  return {
    system:
      'You are an email security analyst. Assess the email for spam/phishing. Respond with JSON: {"verdict": "safe"|"suspicious"|"dangerous", "confidence": number, "reasons": string[]} where confidence is 0-100.',
    user: clip(email, 8000),
  };
}

export function subjectPrompt(body: string) {
  return {
    system:
      "Generate a concise, specific email subject line (max 9 words) for the given email body. Return ONLY the subject line, no quotes.",
    user: clip(body, 4000),
  };
}

export function autoTagPrompt(subject: string, snippet: string, tags: string[]) {
  return {
    system: `You classify emails into existing labels. Available labels: ${tags.join(", ")}. Respond with JSON: {"tags": string[]} using ONLY labels from the list (0-3 of them, best matches only).`,
    user: `Subject: ${subject}\n\n${clip(snippet, 2000)}`,
  };
}
