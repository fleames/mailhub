import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, t } from "@/db";
import { getObject } from "@/lib/storage";

/** Stream an attachment. ?download=1 forces a download disposition. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const [att] = await db.select().from(t.attachments).where(eq(t.attachments.id, id));
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const content = await getObject(att.r2Key);
  if (!content) return NextResponse.json({ error: "Object missing" }, { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const safeName = att.filename.replace(/[^\w.\- ()[\]]/g, "_");

  // Never let a text/html attachment execute in our origin.
  const contentType = /^text\/html/i.test(att.contentType)
    ? "text/plain; charset=utf-8"
    : att.contentType;

  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
