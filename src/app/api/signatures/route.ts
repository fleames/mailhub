import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db.select().from(t.signatures).orderBy(desc(t.signatures.isDefault), t.signatures.name);
  return NextResponse.json(rows);
}

const schema = z.object({
  name: z.string().min(1).max(100),
  html: z.string().max(100_000),
  isDefault: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db.insert(t.signatures).values(body.data).returning();
  if (body.data.isDefault) {
    await db.update(t.signatures).set({ isDefault: false }).where(ne(t.signatures.id, row.id));
  }
  return NextResponse.json(row);
}
