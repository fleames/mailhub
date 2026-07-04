import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db, t } from "@/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const like = q ? `%${q}%` : null;
  const rows = await db
    .select()
    .from(t.contacts)
    .where(
      like
        ? sql`lower(${t.contacts.email}) LIKE ${like} OR lower(coalesce(${t.contacts.name}, '')) LIKE ${like} OR lower(coalesce(${t.contacts.company}, '')) LIKE ${like}`
        : sql`true`
    )
    .orderBy(desc(t.contacts.messageCount))
    .limit(200);
  return NextResponse.json(rows);
}
