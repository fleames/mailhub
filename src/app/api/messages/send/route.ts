import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOutbound } from "@/lib/send";

const address = z.object({ email: z.string().email(), name: z.string().optional() });

const schema = z
  .object({
    mailboxId: z.string().uuid().optional(),
    connectedAccountId: z.string().uuid().optional(),
    to: z.array(address).min(1),
    cc: z.array(address).optional(),
    bcc: z.array(address).optional(),
    subject: z.string().max(998),
    html: z.string().max(5_000_000),
    attachments: z
      .array(
        z.object({
          storageKey: z.string(),
          filename: z.string(),
          contentType: z.string(),
          sizeBytes: z.number(),
        })
      )
      .optional(),
    replyToMessageId: z.string().uuid().nullable().optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    draftId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Boolean(v.mailboxId) !== Boolean(v.connectedAccountId), {
    message: "Provide exactly one of mailboxId or connectedAccountId",
  });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  try {
    const result = await createOutbound({
      ...body.data,
      scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : null,
    });
    return NextResponse.json({
      ok: true,
      messageId: result.message.id,
      conversationId: result.conversationId,
      undoSeconds: result.undoSeconds,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
