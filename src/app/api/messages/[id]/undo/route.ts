import { NextRequest, NextResponse } from "next/server";
import { cancelSend } from "@/lib/send";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const draft = await cancelSend(id);
  if (!draft) {
    return NextResponse.json(
      { error: "Too late — the message is already on its way." },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true, draft });
}
