import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db
    .select()
    .from(t.templates)
    .orderBy(t.templates.category, t.templates.name);
  return NextResponse.json(rows);
}

const schema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().max(998).default(""),
  bodyHtml: z.string().max(500_000).default(""),
  category: z.string().max(50).default(""),
  shortcut: z
    .string()
    .max(30)
    .regex(/^[a-z0-9-]*$/i, "Letters, numbers, and hyphens only")
    .nullable()
    .default(null),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [row] = await db
    .insert(t.templates)
    .values({ ...body.data, shortcut: body.data.shortcut?.trim() || null })
    .returning();
  return NextResponse.json(row);
}
