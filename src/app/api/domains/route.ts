import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db.execute(sql`
    SELECT d.id, d.name, d.color, d.icon, d.catch_all AS "catchAll", d.active,
      d.created_at AS "createdAt",
      (SELECT count(*)::int FROM mailboxes mb WHERE mb.domain_id = d.id) AS "mailboxCount",
      (SELECT count(*)::int FROM conversations c WHERE c.domain_id = d.id AND c.trashed_at IS NULL) AS "conversationCount",
      (SELECT coalesce(sum(m.size_bytes), 0)::float8 FROM messages m WHERE m.domain_id = d.id) AS "storageBytes"
    FROM domains d ORDER BY d.name
  `);
  return NextResponse.json([...rows]);
}

const schema = z.object({
  name: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a bare domain like example.com"),
  color: z.string().max(50).default("#22c55e"),
  icon: z.string().max(8).default("🌐"),
  catchAll: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db
    .insert(t.domains)
    .values({ ...body.data, name: body.data.name.toLowerCase() })
    .onConflictDoNothing()
    .returning();
  if (!row) return NextResponse.json({ error: "Domain already exists" }, { status: 409 });
  return NextResponse.json(row);
}
