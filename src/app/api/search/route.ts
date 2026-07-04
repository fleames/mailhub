import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Global search: FTS over messages (subject/body/sender, weighted),
 * trigram match on addresses and attachment filenames, contact lookup.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ messages: [], contacts: [] });
  const like = `%${q.toLowerCase()}%`;

  const messages = await db.execute(sql`
    SELECT
      m.id, m.conversation_id AS "conversationId", m.subject, m.snippet,
      m.from_email AS "fromEmail", m.from_name AS "fromName", m.date,
      m.direction, c.starred, c.is_spam AS "isSpam",
      d.name AS "domainName", d.color AS "domainColor", d.icon AS "domainIcon",
      ts_rank(m.search_vector, websearch_to_tsquery('simple', ${q})) AS rank
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN domains d ON d.id = m.domain_id
    WHERE
      m.search_vector @@ websearch_to_tsquery('simple', ${q})
      OR lower(m.from_email) LIKE ${like}
      OR lower(m.subject) LIKE ${like}
      OR EXISTS (
        SELECT 1 FROM attachments a
        WHERE a.message_id = m.id AND lower(a.filename) LIKE ${like}
      )
    ORDER BY rank DESC, m.date DESC
    LIMIT 40
  `);

  const contacts = await db.execute(sql`
    SELECT id, email, name, company, conversation_count AS "conversationCount"
    FROM contacts
    WHERE lower(email) LIKE ${like} OR lower(coalesce(name, '')) LIKE ${like}
    ORDER BY message_count DESC
    LIMIT 8
  `);

  return NextResponse.json({ messages: [...messages], contacts: [...contacts] });
}
