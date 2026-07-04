import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { getObject } from "@/lib/storage";

/** Download the original raw MIME (.eml). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const [msg] = await db.select().from(t.messages).where(eq(t.messages.id, id));
  if (!msg?.rawR2Key) {
    return NextResponse.json({ error: "No raw source stored" }, { status: 404 });
  }
  const raw = await getObject(msg.rawR2Key);
  if (!raw) return NextResponse.json({ error: "Raw object missing" }, { status: 404 });

  return new NextResponse(new Uint8Array(raw), {
    headers: {
      "Content-Type": "message/rfc822",
      "Content-Disposition": `attachment; filename="message-${id.slice(0, 8)}.eml"`,
    },
  });
}
