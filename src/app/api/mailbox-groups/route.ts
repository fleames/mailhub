import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setCombinedInboxDiscordWebhook } from "@/lib/combined-inbox";
import { mailboxGroups } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Local parts shared across 2+ domains — the "combine sales@* into one inbox" list. */
export async function GET() {
  return NextResponse.json(await mailboxGroups());
}

const patchSchema = z.object({
  localPart: z.string().min(1).max(200),
  discordWebhookUrl: z.string().max(500).nullable(),
});

export async function PATCH(req: NextRequest) {
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }

  const groups = await mailboxGroups();
  const key = body.data.localPart.trim().toLowerCase();
  if (!groups.some((g) => g.localPart === key)) {
    return NextResponse.json({ error: "Not a combined inbox" }, { status: 404 });
  }

  const url = body.data.discordWebhookUrl?.trim() ?? "";
  if (
    url &&
    !url.startsWith("https://discord.com/api/webhooks/") &&
    !url.startsWith("https://discordapp.com/api/webhooks/")
  ) {
    return NextResponse.json({ error: "Invalid Discord webhook URL" }, { status: 400 });
  }

  await setCombinedInboxDiscordWebhook(key, url || null);
  return NextResponse.json({ ok: true });
}
