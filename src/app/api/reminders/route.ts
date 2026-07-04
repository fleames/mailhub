import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, t } from "@/db";

const schema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  note: z.string().min(1).max(500),
  at: z.string().datetime({ offset: true }),
});

/** Follow-up reminders: fires a notification (SSE + webhooks) at the given time. */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const [job] = await db
    .insert(t.jobs)
    .values({
      type: "reminder",
      payload: {
        conversationId: body.data.conversationId ?? null,
        note: body.data.note,
      },
      runAt: new Date(body.data.at),
    })
    .returning();
  return NextResponse.json(job);
}
