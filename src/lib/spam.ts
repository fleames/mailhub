/**
 * Lightweight spam heuristics for inbound mail.
 * Cloudflare has already done SPF/DKIM/DMARC evaluation upstream —
 * we read its Authentication-Results header rather than re-verifying.
 * Score 0–10; >= threshold (default 5) lands in Spam.
 */

export type SpamVerdict = { score: number; reasons: string[] };

const SPAMMY_TLDS = [".xyz", ".top", ".click", ".loan", ".work", ".gq", ".tk", ".ml", ".cf"];
const SPAM_PHRASES = [
  "act now", "winner", "you have been selected", "claim your", "100% free",
  "risk-free", "viagra", "casino", "lottery", "wire transfer", "inheritance",
  "prince", "crypto giveaway", "double your", "miracle", "weight loss",
];

export function scoreSpam(input: {
  headers: Record<string, string>;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  fromEmail: string;
  envelopeFrom?: string | null;
}): SpamVerdict {
  const reasons: string[] = [];
  let score = 0;

  const auth = (input.headers["authentication-results"] ?? "").toLowerCase();
  if (/spf=fail/.test(auth)) { score += 2; reasons.push("SPF failed"); }
  if (/spf=softfail/.test(auth)) { score += 1; reasons.push("SPF softfail"); }
  if (/dkim=fail/.test(auth)) { score += 2; reasons.push("DKIM failed"); }
  if (/dmarc=fail/.test(auth)) { score += 3; reasons.push("DMARC failed"); }

  const xSpam = (input.headers["x-spam-status"] ?? input.headers["x-spam-flag"] ?? "").toLowerCase();
  if (xSpam.startsWith("yes")) { score += 4; reasons.push("Upstream spam flag"); }

  const from = input.fromEmail.toLowerCase();
  if (SPAMMY_TLDS.some((tld) => from.endsWith(tld))) {
    score += 1; reasons.push("Suspicious sender TLD");
  }

  if (
    input.envelopeFrom &&
    input.envelopeFrom.includes("@") &&
    from &&
    input.envelopeFrom.split("@")[1]?.toLowerCase() !== from.split("@")[1]
  ) {
    score += 1; reasons.push("Envelope/From domain mismatch");
  }

  const subject = input.subject.toLowerCase();
  const letters = input.subject.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) {
    score += 1; reasons.push("ALL-CAPS subject");
  }
  if (/[$€£]{2,}|!!!|free money/i.test(input.subject)) {
    score += 1; reasons.push("Spammy subject punctuation");
  }

  const body = `${subject} ${(input.textBody ?? "").toLowerCase()}`.slice(0, 20000);
  const hits = SPAM_PHRASES.filter((p) => body.includes(p));
  if (hits.length > 0) {
    score += Math.min(hits.length, 3);
    reasons.push(`Spam phrases: ${hits.slice(0, 3).join(", ")}`);
  }

  if (!input.textBody && input.htmlBody) {
    const links = (input.htmlBody.match(/<a\s/gi) ?? []).length;
    const textLen = input.htmlBody.replace(/<[^>]+>/g, "").trim().length;
    if (links > 5 && textLen < 300) {
      score += 2; reasons.push("Link-heavy HTML with little text");
    }
  }

  return { score: Math.min(score, 10), reasons };
}
