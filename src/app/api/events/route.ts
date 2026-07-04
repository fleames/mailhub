import { NextRequest, NextResponse } from "next/server";
import { and, desc, lt, type SQL } from "drizzle-orm";
import { db, t } from "@/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(sp.get("limit") ?? "50", 10) || 50, 200);
  const cursor = sp.get("cursor");

  const conds: SQL[] = [];
  if (cursor) {
    const d = new Date(cursor);
    if (!isNaN(d.getTime())) conds.push(lt(t.events.createdAt, d));
  }

  const rows = await db
    .select()
    .from(t.events)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(t.events.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  return NextResponse.json({
    items,
    nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  });
}
