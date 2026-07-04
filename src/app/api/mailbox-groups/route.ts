import { NextResponse } from "next/server";
import { mailboxGroups } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Local parts shared across 2+ domains — the "combine sales@* into one inbox" list. */
export async function GET() {
  return NextResponse.json(await mailboxGroups());
}
