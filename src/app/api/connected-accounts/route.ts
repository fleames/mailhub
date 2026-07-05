import { NextResponse } from "next/server";
import { db, t } from "@/db";

export async function GET() {
  const rows = await db
    .select({
      id: t.connectedAccounts.id,
      provider: t.connectedAccounts.provider,
      emailAddress: t.connectedAccounts.emailAddress,
      displayName: t.connectedAccounts.displayName,
      status: t.connectedAccounts.status,
      signatureId: t.connectedAccounts.signatureId,
      lastSyncedAt: t.connectedAccounts.lastSyncedAt,
      lastError: t.connectedAccounts.lastError,
      createdAt: t.connectedAccounts.createdAt,
    })
    .from(t.connectedAccounts)
    .orderBy(t.connectedAccounts.createdAt);
  return NextResponse.json(rows);
}
