import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db.execute(sql`
    SELECT tg.id, tg.name, tg.color, tg.created_at AS "createdAt",
      (SELECT count(*)::int FROM conversation_tags ct
       JOIN conversations c ON c.id = ct.conversation_id AND c.trashed_at IS NULL
       WHERE ct.tag_id = tg.id) AS "conversationCount"
    FROM tags tg ORDER BY tg.name
  `);
  return NextResponse.json([...rows]);
}

const schema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(50).default("#8b5cf6"),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db
    .insert(t.tags)
    .values(body.data)
    .onConflictDoNothing()
    .returning();
  if (!row) return NextResponse.json({ error: "Tag already exists" }, { status: 409 });
  return NextResponse.json(row);
}
