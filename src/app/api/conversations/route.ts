import { NextRequest, NextResponse } from "next/server";
import { listConversations, type Folder } from "@/lib/queries";

const FOLDERS = new Set([
  "all", "unread", "sent", "archive", "trash", "spam", "starred", "snoozed", "scheduled",
]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const folder = sp.get("folder") ?? "all";
  if (!FOLDERS.has(folder)) {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  const result = await listConversations({
    folder: folder as Folder,
    domainId: sp.get("domain"),
    mailboxId: sp.get("mailbox"),
    connectedAccountId: sp.get("account"),
    localPart: sp.get("localPart"),
    tagId: sp.get("tag"),
    q: sp.get("q"),
    cursor: sp.get("cursor"),
    limit: sp.get("limit") ? parseInt(sp.get("limit")!, 10) : 50,
  });
  return NextResponse.json(result);
}
