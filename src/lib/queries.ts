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
  const inbox = and(
    isNull(c.trashedAt),
    isNull(c.archivedAt),
    eq(c.isSpam, false),
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
  tagId?: string | null;
  q?: string | null;
  cursor?: string | null; // ISO lastMessageAt
  limit?: number;
};

export async function listConversations(params: ListParams) {
  const c = t.conversations;
  const conds: SQL[] = [folderCondition(params.folder)];

  if (params.domainId) conds.push(eq(c.domainId, params.domainId));
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

  return { ...row, domains: [...domains] };
}
