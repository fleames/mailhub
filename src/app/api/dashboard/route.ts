import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { storageBackend } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const [stats] = await db.execute<Record<string, number>>(sql`
    SELECT
      (SELECT coalesce(sum(unread_count), 0)::int FROM conversations
        WHERE trashed_at IS NULL AND archived_at IS NULL AND is_spam = false) AS "unread",
      (SELECT count(*)::int FROM messages
        WHERE direction = 'inbound' AND date >= date_trunc('day', now())) AS "receivedToday",
      (SELECT count(*)::int FROM messages
        WHERE direction = 'outbound' AND status IN ('sent','delivered')
          AND sent_at >= date_trunc('day', now())) AS "sentToday",
      (SELECT count(*)::int FROM messages
        WHERE direction = 'outbound' AND status IN ('bounced','failed','complained')) AS "deliveryFailures",
      (SELECT count(*)::int FROM messages WHERE status = 'queued' AND scheduled_at > now()) AS "scheduled",
      (SELECT count(*)::int FROM contacts) AS "contacts",
      (SELECT coalesce(sum(size_bytes), 0)::float8 FROM messages) AS "messageBytes",
      (SELECT coalesce(sum(size_bytes), 0)::float8 FROM attachments) AS "attachmentBytes",
      (SELECT count(*)::int FROM messages WHERE status = 'ingest_failed') AS "ingestFailures"
  `);

  const topContacts = await db.execute(sql`
    SELECT id, email, name, company, message_count AS "messageCount",
      conversation_count AS "conversationCount", last_contacted_at AS "lastContactedAt"
    FROM contacts ORDER BY message_count DESC LIMIT 6
  `);

  const largestAttachments = await db.execute(sql`
    SELECT a.id, a.filename, a.content_type AS "contentType", a.size_bytes AS "sizeBytes",
      m.subject, m.conversation_id AS "conversationId"
    FROM attachments a JOIN messages m ON m.id = a.message_id
    ORDER BY a.size_bytes DESC LIMIT 6
  `);

  const domainActivity = await db.execute(sql`
    SELECT d.id, d.name, d.color, d.icon,
      count(m.id) FILTER (WHERE m.date >= now() - interval '7 days')::int AS "last7d",
      count(m.id)::int AS "total"
    FROM domains d
    LEFT JOIN messages m ON m.domain_id = d.id
    GROUP BY d.id ORDER BY "last7d" DESC, "total" DESC
  `);

  const failures = await db.execute(sql`
    SELECT m.id, m.subject, m.from_email AS "fromEmail", m.status, m.error,
      m.conversation_id AS "conversationId", m.date
    FROM messages m
    WHERE m.status IN ('bounced','failed','complained','ingest_failed')
    ORDER BY m.date DESC LIMIT 6
  `);

  const activity = await db.execute(sql`
    SELECT id, type, conversation_id AS "conversationId", payload, created_at AS "createdAt"
    FROM events ORDER BY created_at DESC LIMIT 12
  `);

  // Volume per day, last 14 days (for the activity chart)
  const volume = await db.execute(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
      count(m.id) FILTER (WHERE m.direction = 'inbound')::int AS inbound,
      count(m.id) FILTER (WHERE m.direction = 'outbound')::int AS outbound
    FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') AS day
    LEFT JOIN messages m ON date_trunc('day', m.date) = day
    GROUP BY day ORDER BY day
  `);

  return NextResponse.json({
    stats,
    topContacts: [...topContacts],
    largestAttachments: [...largestAttachments],
    domainActivity: [...domainActivity],
    failures: [...failures],
    activity: [...activity],
    volume: [...volume],
    storageBackend: await storageBackend(),
  });
}
