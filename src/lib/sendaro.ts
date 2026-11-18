/**
 * Sendaro transactional send. One recipient per request, no attachments.
 * https://sendaro.email/docs
 */

const SENDARO_ORIGIN = "https://sendaro.email";
const HTML_LIMIT = 500_000;
const TEXT_LIMIT = 500_000;

export type SendaroSendInput = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  idempotencyKey: string;
};

type Accepted = { id: string; object: "email" };

export type SendaroEmail = {
  id: string;
  status: string;
  error: string | null;
};

export async function sendaroSend(apiKey: string, input: SendaroSendInput): Promise<Accepted> {
  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject.slice(0, 998),
  };
  if (input.html && input.html.length > HTML_LIMIT) {
    throw new Error(`Sendaro: HTML is too long (${input.html.length} characters; limit is ${HTML_LIMIT})`);
  }
  if (input.text && input.text.length > TEXT_LIMIT) {
    throw new Error(`Sendaro: text is too long (${input.text.length} characters; limit is ${TEXT_LIMIT})`);
  }
  if (input.html) body.html = input.html;
  if (input.text) body.text = input.text;
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.headers && Object.keys(input.headers).length > 0) body.headers = input.headers;

  const res = await fetch(`${SENDARO_ORIGIN}/api/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null);
  if ((res.status !== 202 && res.status !== 200) || !data?.id) {
    const code = data?.error || `HTTP ${res.status}`;
    const details = data?.details ? ` ${JSON.stringify(data.details).slice(0, 240)}` : "";
    throw new Error(`Sendaro: ${code}${details}`);
  }
  return data as Accepted;
}

export async function sendaroGet(apiKey: string, id: string): Promise<SendaroEmail | null> {
  const res = await fetch(`${SENDARO_ORIGIN}/api/emails/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.status) return null;
  return { id: data.id, status: data.status, error: data.error ?? null };
}
