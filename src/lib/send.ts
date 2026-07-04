import { Resend } from "resend";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, t } from "@/db";
import type { Address, DraftAttachment } from "@/db/schema";
import { getConfig } from "./config";
import { getObject } from "./storage";
import { htmlToText, makeSnippet, normalizeSubject } from "./utils";
import { mergeParticipants } from "./ingest";
import { upsertContact } from "./contacts";
import { emitSse, logEvent } from "./bus";

/**
 * Outbound pipeline. Every send is a scheduled job: the default schedule is
 * now + undo-window, which is what makes "Undo send" free. Scheduled sending
 * is the same mechanism with a later run_at.
 */

export type ComposeInput = {
  mailboxId: string;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  html: string;
  attachments?: DraftAttachment[];
  replyToMessageId?: string | null;
  scheduledAt?: Date | null;
  draftId?: string | null;
};

export async function createOutbound(input: ComposeInput) {
  const cfg = await getConfig();

  const [mailbox] = await db
    .select({
      id: t.mailboxes.id,
      localPart: t.mailboxes.localPart,
      displayName: t.mailboxes.displayName,
      domainId: t.mailboxes.domainId,
      domainName: t.domains.name,
    })
    .from(t.mailboxes)
    .innerJoin(t.domains, eq(t.mailboxes.domainId, t.domains.id))
    .where(eq(t.mailboxes.id, input.mailboxId));
  if (!mailbox) throw new Error("Mailbox not found");

  const fromEmail = `${mailbox.localPart}@${mailbox.domainName}`;
  const messageId = `<${randomUUID()}@${mailbox.domainName}>`;
  const textBody = htmlToText(input.html);
  const snippet = makeSnippet(textBody);
  const scheduledAt =
    input.scheduledAt ?? new Date(Date.now() + cfg.undoSendSeconds * 1000);

  // Threading headers when replying
  let conversationId: string | null = null;
  let inReplyTo: string | null = null;
  let referencesIds: string[] = [];
  if (input.replyToMessageId) {
    const [replied] = await db
      .select()
      .from(t.messages)
      .where(eq(t.messages.id, input.replyToMessageId));
    if (replied) {
      conversationId = replied.conversationId;
      inReplyTo = replied.messageId;
      referencesIds = [
        ...(replied.referencesIds as string[]),
        ...(replied.messageId ? [replied.messageId] : []),
      ].slice(-50);
    }
  }

  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];

  if (!conversationId) {
    const [conv] = await db
      .insert(t.conversations)
      .values({
        subject: input.subject,
        normalizedSubject: normalizeSubject(input.subject),
        snippet,
        participants: mergeParticipants([], recipients),
        domainId: mailbox.domainId,
        mailboxId: mailbox.id,
        hasOutbound: true,
        lastMessageAt: new Date(),
        lastDirection: "outbound",
      })
      .returning();
    conversationId = conv.id;
  }

  const [msg] = await db
    .insert(t.messages)
    .values({
      conversationId,
      domainId: mailbox.domainId,
      mailboxId: mailbox.id,
      direction: "outbound",
      status: "queued",
      messageId,
      inReplyTo,
      referencesIds,
      fromEmail,
      fromName: mailbox.displayName,
      toJson: input.to,
      ccJson: input.cc ?? [],
      bccJson: input.bcc ?? [],
      subject: input.subject,
      snippet,
      textBody,
      htmlBody: input.html,
      scheduledAt,
      isRead: true,
      date: new Date(),
    })
    .returning();

  // Attach uploaded files (already in object storage from the upload endpoint)
  for (const att of input.attachments ?? []) {
    await db.insert(t.attachments).values({
      messageId: msg.id,
      filename: att.filename,
      contentType: att.contentType,
      sizeBytes: att.sizeBytes,
      r2Key: att.storageKey,
    });
  }

  const [conv] = await db
    .select()
    .from(t.conversations)
    .where(eq(t.conversations.id, conversationId));
  await db
    .update(t.conversations)
    .set({
      snippet,
      messageCount: sql`${t.conversations.messageCount} + 1`,
      attachmentCount: sql`${t.conversations.attachmentCount} + ${input.attachments?.length ?? 0}`,
      participants: mergeParticipants(conv.participants as Address[], recipients),
      hasOutbound: true,
      lastMessageAt: new Date(),
      lastDirection: "outbound",
      trashedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(t.conversations.id, conversationId));

  await db.insert(t.jobs).values({
    type: "send_message",
    payload: { messageId: msg.id },
    runAt: scheduledAt,
  });

  if (input.draftId) {
    await db.delete(t.drafts).where(eq(t.drafts.id, input.draftId));
  }

  await logEvent("message.queued", {
    conversationId,
    messageId: msg.id,
    payload: { to: input.to.map((a) => a.email), subject: input.subject, scheduledAt: scheduledAt.toISOString() },
  });
  emitSse("message.queued", { conversationId, messageId: msg.id, scheduledAt: scheduledAt.toISOString() });

  return { message: msg, conversationId, undoSeconds: input.scheduledAt ? 0 : cfg.undoSendSeconds };
}

/** Executed by the job runner when the undo window / schedule elapses. */
export async function performSend(messageDbId: string): Promise<void> {
  const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, messageDbId));
  if (!msg) return; // undone/deleted
  if (msg.status !== "queued") return;

  const cfg = await getConfig();
  if (!cfg.resendApiKey) {
    await markFailed(msg.id, msg.conversationId, "No Resend API key configured (Settings → Sending)");
    return;
  }

  await db.update(t.messages).set({ status: "sending" }).where(eq(t.messages.id, msg.id));

  const atts = await db.select().from(t.attachments).where(eq(t.attachments.messageId, msg.id));
  const attachments: { filename: string; content: Buffer }[] = [];
  for (const a of atts) {
    const content = await getObject(a.r2Key);
    if (content) attachments.push({ filename: a.filename, content });
  }

  const headers: Record<string, string> = { "Message-ID": msg.messageId! };
  if (msg.inReplyTo) headers["In-Reply-To"] = msg.inReplyTo;
  if ((msg.referencesIds as string[]).length > 0) {
    headers["References"] = (msg.referencesIds as string[]).join(" ");
  }

  const resend = new Resend(cfg.resendApiKey);
  const fmt = (a: Address) => (a.name ? `${a.name.replace(/[<>"]/g, "")} <${a.email}>` : a.email);

  try {
    const { data, error } = await resend.emails.send({
      from: msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail,
      to: (msg.toJson as Address[]).map(fmt),
      cc: (msg.ccJson as Address[]).length ? (msg.ccJson as Address[]).map(fmt) : undefined,
      bcc: (msg.bccJson as Address[]).length ? (msg.bccJson as Address[]).map(fmt) : undefined,
      replyTo: msg.replyTo ?? undefined,
      subject: msg.subject,
      html: msg.htmlBody ?? undefined,
      text: msg.textBody ?? htmlToText(msg.htmlBody ?? ""),
      headers,
      attachments: attachments.length ? attachments : undefined,
    });
    if (error) throw new Error(`${error.name}: ${error.message}`);

    // Resend has accepted the message — this is a real, successful send.
    // Nothing past this point may flip the status back to failed.
    await db
      .update(t.messages)
      .set({ status: "sent", sentAt: new Date(), resendId: data?.id ?? null })
      .where(eq(t.messages.id, msg.id));

    try {
      for (const a of msg.toJson as Address[]) {
        await upsertContact(a, { newConversation: false, contacted: true });
      }
      await logEvent("message.sent", {
        conversationId: msg.conversationId,
        messageId: msg.id,
        payload: { resendId: data?.id, to: (msg.toJson as Address[]).map((a) => a.email) },
      });
      emitSse("message.sent", { conversationId: msg.conversationId, messageId: msg.id });
    } catch (err) {
      // Best-effort bookkeeping only — the send itself already succeeded.
      console.error("Post-send bookkeeping failed (message was still sent):", err);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await markFailed(msg.id, msg.conversationId, errMsg);
    throw err; // let the job runner record the failure/retry
  }
}

async function markFailed(messageId: string, conversationId: string, error: string) {
  await db
    .update(t.messages)
    .set({ status: "failed", error })
    .where(eq(t.messages.id, messageId));
  await logEvent("message.failed", { conversationId, messageId, payload: { error } });
  emitSse("message.failed", { conversationId, messageId, error });
}

/** Undo send: cancel the pending job, remove the message, return its content for recomposing. */
export async function cancelSend(messageDbId: string) {
  const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, messageDbId));
  if (!msg || msg.status !== "queued") return null;

  await db
    .update(t.jobs)
    .set({ status: "canceled" })
    .where(
      and(
        eq(t.jobs.type, "send_message"),
        eq(t.jobs.status, "pending"),
        sql`${t.jobs.payload}->>'messageId' = ${messageDbId}`
      )
    );

  const atts = await db.select().from(t.attachments).where(eq(t.attachments.messageId, msg.id));
  await db.delete(t.messages).where(eq(t.messages.id, msg.id));

  // Fix conversation aggregates; drop the conversation if this was its only message.
  const [conv] = await db
    .select()
    .from(t.conversations)
    .where(eq(t.conversations.id, msg.conversationId));
  if (conv) {
    if (conv.messageCount <= 1 && !(await hasMessages(conv.id))) {
      await db.delete(t.conversations).where(eq(t.conversations.id, conv.id));
    } else {
      await db
        .update(t.conversations)
        .set({
          messageCount: sql`greatest(${t.conversations.messageCount} - 1, 0)`,
          attachmentCount: sql`greatest(${t.conversations.attachmentCount} - ${atts.length}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(t.conversations.id, conv.id));
    }
  }

  await logEvent("message.send_undone", { messageId: msg.id, payload: { subject: msg.subject } });
  emitSse("message.undone", { conversationId: msg.conversationId, messageId: msg.id });

  return {
    mailboxId: msg.mailboxId,
    to: msg.toJson,
    cc: msg.ccJson,
    bcc: msg.bccJson,
    subject: msg.subject,
    html: msg.htmlBody ?? "",
    attachments: atts.map((a) => ({
      storageKey: a.r2Key,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    })),
    replyToMessageId: null,
  };
}

async function hasMessages(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.messages)
    .where(eq(t.messages.conversationId, conversationId));
  return (row?.n ?? 0) > 0;
}
