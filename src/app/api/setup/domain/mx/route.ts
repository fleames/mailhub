import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { deleteDnsRecord, listMxRecords } from "@/lib/cloudflare";
import { logEvent } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Existing (non-Cloudflare) MX records block Email Routing from being
 * enabled (Cloudflare error 2008). These endpoints let the setup wizard show
 * exactly what's there and remove it only on explicit user action — deleting
 * someone's live MX records is a real, visible decision, not an automatic one.
 */

export async function GET(req: NextRequest) {
  const zoneId = req.nextUrl.searchParams.get("zoneId");
  if (!zoneId) return NextResponse.json({ error: "zoneId required" }, { status: 400 });

  const cfg = await getConfig();
  if (!cfg.cfApiToken) {
    return NextResponse.json({ error: "No Cloudflare token configured" }, { status: 400 });
  }
  try {
    const records = await listMxRecords(cfg.cfApiToken, zoneId);
    return NextResponse.json({ records });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list MX records" },
      { status: 502 }
    );
  }
}

const deleteSchema = z.object({
  zoneId: z.string().min(10),
  recordIds: z.array(z.string()).min(1).max(50),
});

export async function DELETE(req: NextRequest) {
  const body = deleteSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const cfg = await getConfig();
  if (!cfg.cfApiToken) {
    return NextResponse.json({ error: "No Cloudflare token configured" }, { status: 400 });
  }
  const token = cfg.cfApiToken;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of body.data.recordIds) {
    try {
      await deleteDnsRecord(token, body.data.zoneId, id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await logEvent("setup.mx_removed", { payload: { zoneId: body.data.zoneId, results } });
  return NextResponse.json({ results, ok: results.every((r) => r.ok) });
}
