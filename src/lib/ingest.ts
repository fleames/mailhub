import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, t } from "@/db";
import type { Address } from "@/db/schema";
import { putObject } from "./storage";
import { makeSnippet, normalizeSubject } from "./utils";
import { scoreSpam } from "./spam";
import { upsertContact } from "./contacts";
import { emitSse, logEvent } from "./bus";
import { notifyNewEmail } from "./notify";
import { getConfig } from "./config";

/**
 * Inbound ingestion pipeline. Raw-first: the raw MIME is persisted to object
 * storage BEFORE any parsing, so a parser bug can never lose mail. Parse
 * failures become dead-letter messages (status: ingest_failed) that can be
 * reprocessed from the stored raw.
 */

export function addressesOf(obj: AddressObject | AddressObject[] | undefined): Address[] {
  if (!obj) return [];
  const list = Array.isArray(obj) ? obj : [obj];
  const out: Address[] = [];
  for (const o of list) {
    for (const v of o.value) {
      if (v.address) out.push({ email: v.address.toLowerCase(), name: v.name || undefined });
      // Groups nest their members under v.group
      if (v.group) {
        for (const g of v.group) {
          if (g.address) out.push({ email: g.address.toLowerCase(), name: g.name || undefined });
        }
      }
    }
  }
  return out;
}

function headersRecord(parsed: ParsedMail): Record<string, string> {
  const out: Record<string, string> = {};
  let total = 0;
  for (const { key, line } of parsed.headerLines) {
    const value = line.slice(line.indexOf(":") + 1).trim();
    if (total + value.length > 65536) break;
    total += value.length;
    out[key] = out[key] ? `${out[key]}\n${value}` : value;
  }
  return out;
}

function refsOf(parsed: ParsedMail): string[] {
  const raw = parsed.references;
  const refs = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return refs.map((r) => r.trim()).filter(Boolean).slice(0, 50);
}

/** Resolve which of my domains/mailboxes this email targets. Auto-creates rows so nothing is ever dropped. */
async function resolveMailbox(rcpt: string | null, fallbackTo: Address[]) {
  let email = rcpt?.toLowerCase().trim() ?? null;

  if (!email) {
    const domainRows = await db.select().from(t.domains);
    const mine = new Set(domainRows.map((d) => d.name.toLowerCase()));
    email =
      fallbackTo.find((a) => mine.has(a.email.split("@")[1] ?? ""))?.email ?? null;
  }
  if (!email || !email.includes("@")) return { domain: null, mailbox: null };

  const [localPart, domainName] = [
    email.split("@")[0],
    email.split("@")[1].toLowerCase(),
  ];

  let [domain] = await db
    .select()
    .from(t.domains)
    .where(eq(t.domains.name, domainName));
  if (!domain) {
    const hue = Math.floor(Math.random() * 360);
    [domain] = await db
      .insert(t.domains)
      .values({ name: domainName, color: `hsl(${hue} 70% 55%)`, icon: "🌐" })
      .onConflictDoNothing()
      .returning();
    if (!domain) {
      [domain] = await db.select().from(t.domains).where(eq(t.domains.name, domainName));
    }
  }

  let [mailbox] = await db
    .select()
    .from(t.mailboxes)
    .where(and(eq(t.mailboxes.domainId, domain.id), eq(t.mailboxes.localPart, localPart)));
  if (!mailbox) {
    [mailbox] = await db
      .insert(t.mailboxes)
      .values({ domainId: domain.id, localPart })
      .onConflictDoNothing()
      .returning();
    if (!mailbox) {
      [mailbox] = await db
        .select()
        .from(t.mailboxes)
        .where(and(eq(t.mailboxes.domainId, domain.id), eq(t.mailboxes.localPart, localPart)));
    }
  }

  return { domain, mailbox };
}

/** Gmail-style threading: References/In-Reply-To first, subject+participant fallback. */
export async function findConversation(opts: {
  refs: string[];
  inReplyTo: string | null;
  normSubject: string;
  counterpart: string | null;
}): Promise<string | null> {
  const ids = [...opts.refs, ...(opts.inReplyTo ? [opts.inReplyTo] : [])].filter(Boolean);
  if (ids.length > 0) {
    const [hit] = await db
      .select({ conversationId: t.messages.conversationId })
      .from(t.messages)
      .where(inArray(t.messages.messageId, ids))
      .orderBy(desc(t.messages.date))
      .limit(1);
    if (hit) return hit.conversationId;
  }

  if (opts.normSubject && opts.counterpart) {
    const candidates = await db
      .select()
      .from(t.conversations)
      .where(
        and(
          eq(t.conversations.normalizedSubject, opts.normSubject),
          sql`${t.conversations.lastMessageAt} > now() - interval '60 days'`
        )
      )
      .orderBy(desc(t.conversations.lastMessageAt))
      .limit(5);
    const cp = opts.counterpart.toLowerCase();
    for (const c of candidates) {
      if ((c.participants as Address[]).some((p) => p.email === cp)) return c.id;
    }
  }
  return null;
}

/** Merge participant lists, dedupe by email, cap at 25. */
export function mergeParticipants(existing: Address[], incoming: Address[]): Address[] {
  const map = new Map(existing.map((p) => [p.email, p]));
  for (const p of incoming) {
    const prev = map.get(p.email);
    if (!prev) map.set(p.email, p);
    else if (!prev.name && p.name) map.set(p.email, p);
  }
  return [...map.values()].slice(0, 25);
}

export type IngestResult =
  | { ok: true; messageId: string; conversationId: string; deduped: boolean }
  | { ok: false; messageId: string; error: string };

export async function ingestRawEmail(opts: {
  raw: Buffer;
  envelopeTo?: string | null;
  envelopeFrom?: string | null;
}): Promise<IngestResult> {
  const now = new Date();
  const rawKey = `raw/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.eml`;

  // 1. Persist raw BEFORE parsing. This is the never-lose-data guarantee.
  await putObject(rawKey, opts.raw, "message/rfc822");

  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(opts.raw, { skipImageLinks: false });
  } catch (err) {
    return deadLetter(rawKey, opts, err instanceof Error ? err.message : String(err));
  }

  try {
    return await storeParsed(parsed, rawKey, opts);
  } catch (err) {
    console.error("Ingest storage failed:", err);
    return deadLetter(rawKey, opts, err instanceof Error ? err.message : String(err));
  }
}

async function deadLetter(
  rawKey: string,
  opts: { raw: Buffer; envelopeTo?: string | null; envelopeFrom?: string | null },
  error: string
): Promise<IngestResult> {
  const [conv] = await db
    .insert(t.conversations)
    .values({
      subject: "[Unparseable message]",
      normalizedSubject: "",
      snippet: `Ingest failed: ${error.slice(0, 140)}`,
      participants: opts.envelopeFrom ? [{ email: opts.envelopeFrom }] : [],
      unreadCount: 1,
      messageCount: 1,
      lastDirection: "inbound",
    })
    .returning();
  const [msg] = await db
    .insert(t.messages)
    .values({
      conversationId: conv.id,
      direction: "inbound",
      status: "ingest_failed",
      fromEmail: opts.envelopeFrom ?? "",
      subject: "[Unparseable message]",
      rawR2Key: rawKey,
      sizeBytes: opts.raw.length,
      error,
    })
    .returning();
  await logEvent("ingest.failed", { messageId: msg.id, payload: { error, rawKey } });
  emitSse("message.new", { conversationId: conv.id, messageId: msg.id });
  return { ok: false, messageId: msg.id, error };
}

async function storeParsed(
  parsed: ParsedMail,
  rawKey: string,
  opts: { raw: Buffer; envelopeTo?: string | null; envelopeFrom?: string | null }
): Promise<IngestResult> {
  const from = addressesOf(parsed.from)[0] ?? {
    email: opts.envelopeFrom?.toLowerCase() ?? "unknown@unknown",
  };
  const to = addressesOf(parsed.to);
  const cc = addressesOf(parsed.cc);
  const subject = parsed.subject ?? "";
  const normSubject = normalizeSubject(subject);
  const textBody = parsed.text ?? null;
  const htmlBody = typeof parsed.html === "string" ? parsed.html : null;
  const headers = headersRecord(parsed);
  const refs = refsOf(parsed);
  const inReplyTo = parsed.inReplyTo?.trim() || null;
  const msgIdHeader = parsed.messageId?.trim() || null;
  const date = parsed.date ?? new Date();
  const snippet = makeSnippet(textBody, htmlBody);

  const { domain, mailbox } = await resolveMailbox(opts.envelopeTo ?? null, [...to, ...cc]);

  // Dedupe: same RFC Message-ID delivered to the same mailbox twice.
  if (msgIdHeader && mailbox) {
    const [dupe] = await db
      .select({ id: t.messages.id, conversationId: t.messages.conversationId })
      .from(t.messages)
      .where(and(eq(t.messages.messageId, msgIdHeader), eq(t.messages.mailboxId, mailbox.id)))
      .limit(1);
    if (dupe) return { ok: true, messageId: dupe.id, conversationId: dupe.conversationId, deduped: true };
  }

  const cfg = await getConfig();
  const spam = scoreSpam({
    headers,
    subject,
    textBody,
    htmlBody,
    fromEmail: from.email,
    envelopeFrom: opts.envelopeFrom,
  });
  const isSpam = spam.score >= cfg.spamThreshold;

  let conversationId = await findConversation({
    refs,
    inReplyTo,
    normSubject,
    counterpart: from.email,
  });
  let isNewConversation = false;

  if (!conversationId) {
    isNewConversation = true;
    const [conv] = await db
      .insert(t.conversations)
      .values({
        subject,
        normalizedSubject: normSubject,
        snippet,
        participants: mergeParticipants([], [from, ...to, ...cc]),
        domainId: domain?.id ?? null,
        mailboxId: mailbox?.id ?? null,
        isSpam,
        lastMessageAt: date,
        lastDirection: "inbound",
      })
      .returning();
    conversationId = conv.id;
  }

  const [msg] = await db
    .insert(t.messages)
    .values({
      conversationId,
      domainId: domain?.id ?? null,
      mailboxId: mailbox?.id ?? null,
      direction: "inbound",
      status: "received",
      messageId: msgIdHeader,
      inReplyTo,
      referencesIds: refs,
      fromEmail: from.email,
      fromName: from.name ?? null,
      toJson: to,
      ccJson: cc,
      replyTo: addressesOf(parsed.replyTo)[0]?.email ?? null,
      subject,
      snippet,
      textBody,
      htmlBody,
      headers,
      rawR2Key: rawKey,
      sizeBytes: opts.raw.length,
      spamScore: spam.score,
      spamReasons: spam.reasons,
      date,
    })
    .returning();

  // Attachments → object storage
  let attachmentCount = 0;
  let attachmentBytes = 0;
  for (const [i, att] of parsed.attachments.entries()) {
    const safeName = (att.filename ?? `attachment-${i + 1}`).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_").slice(0, 180);
    const key = `att/${msg.id}/${i}-${safeName}`;
    await putObject(key, att.content, att.contentType || "application/octet-stream");
    await db.insert(t.attachments).values({
      messageId: msg.id,
      filename: safeName,
      contentType: att.contentType || "application/octet-stream",
      sizeBytes: att.size ?? att.content.length,
      r2Key: key,
      contentId: att.contentId?.replace(/[<>]/g, "") ?? null,
      isInline: att.contentDisposition === "inline" && Boolean(att.contentId),
    });
    attachmentCount++;
    attachmentBytes += att.size ?? att.content.length;
  }

  // Conversation aggregates. New inbound mail resurfaces archived/snoozed threads
  // (Gmail behavior). Read-modify-write is fine: single-user app, no write races.
  const [conv] = await db
    .select()
    .from(t.conversations)
    .where(eq(t.conversations.id, conversationId));
  await db
    .update(t.conversations)
    .set({
      snippet,
      messageCount: sql`${t.conversations.messageCount} + 1`,
      unreadCount: sql`${t.conversations.unreadCount} + 1`,
      attachmentCount: sql`${t.conversations.attachmentCount} + ${attachmentCount}`,
      participants: mergeParticipants(conv.participants as Address[], [from, ...to, ...cc]),
      lastMessageAt: date,
      lastDirection: "inbound",
      archivedAt: null,
      snoozedUntil: null,
      updatedAt: new Date(),
      domainId: conv.domainId ?? domain?.id ?? null,
      mailboxId: conv.mailboxId ?? mailbox?.id ?? null,
      ...(conv.subject === "" ? { subject, normalizedSubject: normSubject } : {}),
    })
    .where(eq(t.conversations.id, conversationId));

  // The message is already fully stored at this point — a contact-tracking
  // hiccup must never turn a successfully ingested email into a dead-letter.
  try {
    await upsertContact(from, { newConversation: isNewConversation, contacted: false });
  } catch (err) {
    console.error("Post-ingest contact upsert failed (message was still stored):", err);
  }

  await logEvent("message.received", {
    conversationId,
    messageId: msg.id,
    payload: {
      from: from.email,
      subject,
      mailbox: mailbox ? `${mailbox.localPart}@${domain?.name}` : opts.envelopeTo,
      spamScore: spam.score,
      attachments: attachmentCount,
      bytes: opts.raw.length + attachmentBytes,
    },
  });

  emitSse("message.new", {
    conversationId,
    messageId: msg.id,
    from: from.name || from.email,
    subject,
    snippet,
    spam: isSpam,
  });

  if (!isSpam) {
    void notifyNewEmail({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      subject,
      mailbox: mailbox ? `${mailbox.localPart}@${domain?.name}` : (opts.envelopeTo ?? "unknown"),
      snippet,
      conversationId,
    }).catch(() => {});
  }

  return { ok: true, messageId: msg.id, conversationId, deduped: false };
}
