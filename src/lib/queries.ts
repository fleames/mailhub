import { and, desc, eq, exists, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db, t } from "@/db";

/** Shared conversation-list query logic (sidebar folders, filters, search). */

export type Folder =
  | "all"
  | "unread"
  | "sent"
  | "archive"
  | "trash"
  | "spam"
  | "starred"
  | "snoozed"
  | "scheduled";

export function folderCondition(folder: Folder): SQL {
  const c = t.conversations;
  // "All Inbox" means received mail — a thread you started that nobody has
  // replied to yet belongs in Sent only, not here too (matches Gmail).
  const inbox = and(
    isNull(c.trashedAt),
    isNull(c.archivedAt),
    eq(c.isSpam, false),
    eq(c.hasInbound, true),
    sql`(${c.snoozedUntil} IS NULL OR ${c.snoozedUntil} <= now())`
  )!;
  switch (folder) {
    case "all":
      return inbox;
    case "unread":
      return and(inbox, gt(c.unreadCount, 0))!;
    case "starred":
      return and(isNull(c.trashedAt), eq(c.starred, true))!;
    case "sent":
      return and(isNull(c.trashedAt), eq(c.hasOutbound, true), eq(c.isSpam, false))!;
    case "archive":
      return and(isNull(c.trashedAt), isNotNull(c.archivedAt))!;
    case "trash":
      return isNotNull(c.trashedAt);
    case "spam":
      return and(isNull(c.trashedAt), eq(c.isSpam, true))!;
    case "snoozed":
      return and(isNull(c.trashedAt), sql`${c.snoozedUntil} > now()`)!;
    case "scheduled":
      return exists(
        db
          .select({ one: sql`1` })
          .from(t.messages)
          .where(
            and(
              eq(t.messages.conversationId, c.id),
              eq(t.messages.status, "queued"),
              sql`${t.messages.scheduledAt} > now()`
            )
          )
      );
  }
}

export type ListParams = {
  folder: Folder;
  domainId?: string | null;
  mailboxId?: string | null;
  connectedAccountId?: string | null;
  /** Combine every mailbox sharing this local part across all domains, e.g. "sales" -> sales@* */
  localPart?: string | null;
  tagId?: string | null;
  q?: string | null;
  cursor?: string | null; // ISO lastMessageAt
  limit?: number;
};

export async function listConversations(params: ListParams) {
  const c = t.conversations;
  const conds: SQL[] = [folderCondition(params.folder)];

  if (params.domainId) conds.push(eq(c.domainId, params.domainId));
  if (params.mailboxId) conds.push(eq(c.mailboxId, params.mailboxId));
  if (params.connectedAccountId) conds.push(eq(c.connectedAccountId, params.connectedAccountId));
  if (params.localPart) {
    conds.push(
      sql`${c.mailboxId} IN (SELECT id FROM mailboxes WHERE local_part = ${params.localPart})`
    );
  }
  if (params.tagId) {
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(t.conversationTags)
          .where(
            and(
              eq(t.conversationTags.conversationId, c.id),
              eq(t.conversationTags.tagId, params.tagId)
            )
          )
      )
    );
  }
  if (params.q?.trim()) {
    const q = params.q.trim();
    const like = `%${q.toLowerCase()}%`;
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(t.messages)
          .where(
            and(
              eq(t.messages.conversationId, c.id),
              sql`(
                ${t.messages}."search_vector" @@ websearch_to_tsquery('simple', ${q})
                OR lower(${t.messages.fromEmail}) LIKE ${like}
                OR lower(${t.messages.subject}) LIKE ${like}
              )`
            )
          )
      )
    );
  }
  if (params.cursor) {
    conds.push(lt(c.lastMessageAt, new Date(params.cursor)));
  }

  const limit = Math.min(params.limit ?? 50, 100);
  const rows = await db
    .select({
      conversation: c,
      domain: t.domains,
      mailbox: t.mailboxes,
    })
    .from(c)
    .leftJoin(t.domains, eq(c.domainId, t.domains.id))
    .leftJoin(t.mailboxes, eq(c.mailboxId, t.mailboxes.id))
    .where(and(...conds))
    .orderBy(desc(c.lastMessageAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  // Tags for the page in one query
  const ids = page.map((r) => r.conversation.id);
  const tagRows = ids.length
    ? await db
        .select({
          conversationId: t.conversationTags.conversationId,
          tag: t.tags,
        })
        .from(t.conversationTags)
        .innerJoin(t.tags, eq(t.conversationTags.tagId, t.tags.id))
        .where(inArray(t.conversationTags.conversationId, ids))
    : [];
  const tagsByConv = new Map<string, (typeof tagRows)[number]["tag"][]>();
  for (const r of tagRows) {
    const list = tagsByConv.get(r.conversationId) ?? [];
    list.push(r.tag);
    tagsByConv.set(r.conversationId, list);
  }

  return {
    items: page.map((r) => ({
      ...r.conversation,
      domain: r.domain,
      mailbox: r.mailbox,
      tags: tagsByConv.get(r.conversation.id) ?? [],
    })),
    nextCursor: hasMore
      ? page[page.length - 1].conversation.lastMessageAt.toISOString()
      : null,
  };
}

export async function getThread(conversationId: string) {
  const [conv] = await db
    .select({
      conversation: t.conversations,
      domain: t.domains,
      mailbox: t.mailboxes,
    })
    .from(t.conversations)
    .leftJoin(t.domains, eq(t.conversations.domainId, t.domains.id))
    .leftJoin(t.mailboxes, eq(t.conversations.mailboxId, t.mailboxes.id))
    .where(eq(t.conversations.id, conversationId));
  if (!conv) return null;

  const msgs = await db
    .select()
    .from(t.messages)
    .where(eq(t.messages.conversationId, conversationId))
    .orderBy(t.messages.date);

  const atts = msgs.length
    ? await db
        .select()
        .from(t.attachments)
        .where(inArray(t.attachments.messageId, msgs.map((m) => m.id)))
    : [];
  const attsByMsg = new Map<string, typeof atts>();
  for (const a of atts) {
    const list = attsByMsg.get(a.messageId) ?? [];
    list.push(a);
    attsByMsg.set(a.messageId, list);
  }

  const tagRows = await db
    .select({ tag: t.tags })
    .from(t.conversationTags)
    .innerJoin(t.tags, eq(t.conversationTags.tagId, t.tags.id))
    .where(eq(t.conversationTags.conversationId, conversationId));

  return {
    ...conv.conversation,
    domain: conv.domain,
    mailbox: conv.mailbox,
    tags: tagRows.map((r) => r.tag),
    messages: msgs.map((m) => ({
      ...m,
      attachments: attsByMsg.get(m.id) ?? [],
    })),
  };
}

export async function sidebarCounts() {
  const [row] = await db.execute<{
    inbox_unread: number;
    spam: number;
    snoozed: number;
    scheduled: number;
    drafts: number;
    trash: number;
  }>(sql`
    SELECT
      (SELECT coalesce(sum(unread_count), 0)::int FROM conversations
        WHERE trashed_at IS NULL AND archived_at IS NULL AND is_spam = false
          AND (snoozed_until IS NULL OR snoozed_until <= now())) AS inbox_unread,
      (SELECT count(*)::int FROM conversations WHERE is_spam = true AND trashed_at IS NULL) AS spam,
      (SELECT count(*)::int FROM conversations WHERE snoozed_until > now() AND trashed_at IS NULL) AS snoozed,
      (SELECT count(*)::int FROM messages WHERE status = 'queued' AND scheduled_at > now()) AS scheduled,
      (SELECT count(*)::int FROM drafts) AS drafts,
      (SELECT count(*)::int FROM conversations WHERE trashed_at IS NOT NULL) AS trash
  `);

  const domains = await db.execute<{ id: string; unread: number }>(sql`
    SELECT d.id, coalesce(sum(c.unread_count) FILTER (WHERE c.trashed_at IS NULL AND c.archived_at IS NULL AND c.is_spam = false), 0)::int AS unread
    FROM domains d
    LEFT JOIN conversations c ON c.domain_id = d.id
    GROUP BY d.id
  `);

  const mailboxes = await db.execute<{ id: string; unread: number }>(sql`
    SELECT mb.id, coalesce(sum(c.unread_count) FILTER (WHERE c.trashed_at IS NULL AND c.archived_at IS NULL AND c.is_spam = false), 0)::int AS unread
    FROM mailboxes mb
    LEFT JOIN conversations c ON c.mailbox_id = mb.id
    GROUP BY mb.id
  `);

  const connectedAccounts = await db.execute<{ id: string; unread: number }>(sql`
    SELECT ca.id, coalesce(sum(c.unread_count) FILTER (WHERE c.trashed_at IS NULL AND c.archived_at IS NULL AND c.is_spam = false), 0)::int AS unread
    FROM connected_accounts ca
    LEFT JOIN conversations c ON c.connected_account_id = ca.id
    GROUP BY ca.id
  `);

  return {
    ...row,
    domains: [...domains],
    mailboxes: [...mailboxes],
    connectedAccounts: [...connectedAccounts],
  };
}

/**
 * Local parts that exist on 2+ domains — e.g. sales@launchpadly.co and
 * sales@northbeam.co both surface as one "sales" combined-inbox entry.
 * Purely computed from existing mailbox rows; nothing to configure.
 */
export async function mailboxGroups() {
  const rows = await db.execute<{ localPart: string; domainCount: number; unread: number }>(sql`
    SELECT
      mb.local_part AS "localPart",
      count(DISTINCT mb.domain_id)::int AS "domainCount",
      coalesce(sum(c.unread_count) FILTER (
        WHERE c.trashed_at IS NULL AND c.archived_at IS NULL AND c.is_spam = false
      ), 0)::int AS unread
    FROM mailboxes mb
    LEFT JOIN conversations c ON c.mailbox_id = mb.id
    GROUP BY mb.local_part
    HAVING count(DISTINCT mb.domain_id) > 1
    ORDER BY mb.local_part
  `);
  return [...rows];
}
