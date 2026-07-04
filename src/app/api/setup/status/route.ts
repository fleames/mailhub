import { NextResponse } from "next/server";
import { db, t } from "@/db";
import { getConfig } from "@/lib/config";
import { storageBackend, probeR2 } from "@/lib/storage";
import { bucketExists, listZones, workerExists } from "@/lib/cloudflare";
import { WORKER_NAME } from "@/lib/worker-script";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live setup state for the wizard: what's configured, what exists at Cloudflare. */
export async function GET() {
  const cfg = await getConfig();
  const backend = await storageBackend();
  const domains = await db.select({ name: t.domains.name }).from(t.domains);

  const out: Record<string, unknown> = {
    hasCfToken: Boolean(cfg.cfApiToken),
    hasResendKey: Boolean(cfg.resendApiKey),
    r2Ready: backend === "r2",
    bucket: cfg.r2Bucket ?? "mailhub",
    workerName: WORKER_NAME,
    connectedDomains: domains.map((d) => d.name),
  };

  if (backend === "r2") {
    const probe = await probeR2();
    out.r2Probe = probe.ok ? "ok" : probe.error;
  }

  if (cfg.cfApiToken && cfg.r2AccountId) {
    try {
      const [zones, worker, bucket] = await Promise.all([
        listZones(cfg.cfApiToken),
        workerExists(cfg.cfApiToken, cfg.r2AccountId),
        bucketExists(cfg.cfApiToken, cfg.r2AccountId, cfg.r2Bucket ?? "mailhub"),
      ]);
      out.zones = zones;
      out.workerDeployed = worker;
      out.bucketExists = bucket;
    } catch (err) {
      out.cfError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json(out);
}
