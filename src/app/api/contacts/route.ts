import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db, t } from "@/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim().toLowerCase();
  const like = q ? `%${q}%` : null;
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(parseInt(sp.get("offset") ?? "0", 10) || 0, 0);

  const rows = await db
    .select()
    .from(t.contacts)
    .where(
      like
        ? sql`lower(${t.contacts.email}) LIKE ${like} OR lower(coalesce(${t.contacts.name}, '')) LIKE ${like} OR lower(coalesce(${t.contacts.company}, '')) LIKE ${like}`
        : sql`true`
    )
    .orderBy(desc(t.contacts.messageCount))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  return NextResponse.json({ items: rows.slice(0, limit), hasMore });
}
