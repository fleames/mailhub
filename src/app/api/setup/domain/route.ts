import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { db, t } from "@/db";
import { getConfig } from "@/lib/config";
import {
  CfError,
  emailRoutingStatus,
  enableEmailRouting,
  ensureDnsRecord,
  setCatchAll,
} from "@/lib/cloudflare";
import { logEvent } from "@/lib/bus";

export const maxDuration = 120;

const schema = z.object({
  zoneId: z.string().min(10),
  zoneName: z.string().min(3),
});

type SetupStep = { step: string; ok: boolean; detail?: string };

type ResendRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status?: string;
};

function normalizeName(name: string, domain: string): string {
  if (!name || name === "@") return domain;
  if (name === domain || name.endsWith(`.${domain}`)) return name;
  return `${name}.${domain}`;
}

/** Find-or-create the domain in Resend and return its id + required DNS records. */
async function ensureResendDomain(
  resend: Resend,
  name: string
): Promise<{ id: string; status: string; records: ResendRecord[] }> {
  const created = await resend.domains.create({ name });
  if (created.data) {
    return {
      id: created.data.id,
      status: created.data.status ?? "pending",
      records: (created.data.records ?? []) as ResendRecord[],
    };
  }
  // Probably exists already — find it.
  const list = await resend.domains.list();
  const rows =
    (list.data as unknown as { data?: { id: string; name: string }[] })?.data ?? [];
  const existing = rows.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    throw new Error(created.error?.message ?? "Resend domain creation failed");
  }
  const full = await resend.domains.get(existing.id);
  const data = full.data as unknown as {
    id: string;
    status?: string;
    records?: ResendRecord[];
  } | null;
  if (!data) throw new Error(full.error?.message ?? "Could not load Resend domain");
  return { id: data.id, status: data.status ?? "pending", records: data.records ?? [] };
}

/**
 * Fully automatic per-domain setup:
 *   enable Email Routing → catch-all → worker → register domain in Resend →
 *   write its DKIM/SPF records into Cloudflare DNS → trigger verification →
 *   add the domain to MailHub.
 */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { zoneId, zoneName } = body.data;
  const domain = zoneName.toLowerCase();

  const cfg = await getConfig();
  if (!cfg.cfApiToken) {
    return NextResponse.json({ error: "Run the global setup first" }, { status: 400 });
  }
  const token = cfg.cfApiToken;

  const steps: SetupStep[] = [];
  const run = async (step: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      steps.push({ step, ok: true, detail: detail ?? undefined });
    } catch (err) {
      steps.push({ step, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  // Handled outside the generic `run` helper so a 2008 (conflicting MX records)
  // can be surfaced as a structured flag instead of just an error string.
  let mxConflict = false;
  try {
    const status = await emailRoutingStatus(token, zoneId);
    const detail = status.enabled
      ? `already enabled (${status.status})`
      : `enabled (${await enableEmailRouting(token, zoneId)})`;
    steps.push({ step: "Enable Email Routing", ok: true, detail });
  } catch (err) {
    if (err instanceof CfError && err.codes.includes(2008)) mxConflict = true;
    steps.push({
      step: "Enable Email Routing",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  await run("Catch-all → mailhub-inbound worker", async () => {
    await setCatchAll(token, zoneId);
  });

  if (cfg.resendApiKey) {
    const resend = new Resend(cfg.resendApiKey);
    let resendDomainId: string | null = null;

    await run("Register domain in Resend", async () => {
      const rd = await ensureResendDomain(resend, domain);
      resendDomainId = rd.id;

      let created = 0;
      let existed = 0;
      for (const rec of rd.records) {
        const result = await ensureDnsRecord(token, zoneId, {
          type: rec.type.toUpperCase(),
          name: normalizeName(rec.name, domain),
          content: rec.value,
          ...(rec.priority != null ? { priority: rec.priority } : {}),
        });
        if (result === "created") created++;
        else existed++;
      }
      return `${rd.records.length} DNS records (${created} added, ${existed} existing)`;
    });

    await run("Verify sending domain", async () => {
      if (!resendDomainId) throw new Error("No Resend domain id");
      await resend.domains.verify(resendDomainId);
      const check = await resend.domains.get(resendDomainId);
      const status =
        (check.data as unknown as { status?: string } | null)?.status ?? "pending";
      return status === "verified"
        ? "verified ✓"
        : `status: ${status} — DNS can take a few minutes; press Connect again to re-check`;
    });
  } else {
    steps.push({
      step: "Register domain in Resend",
      ok: false,
      detail: "No Resend API key — add it in the global setup",
    });
  }

  await run("Add domain to MailHub", async () => {
    const hue = Math.floor(Math.random() * 360);
    await db
      .insert(t.domains)
      .values({ name: domain, color: `hsl(${hue} 70% 55%)`, icon: "📬" })
      .onConflictDoNothing();
  });

  await logEvent("setup.domain", { payload: { domain, steps } });
  return NextResponse.json({ steps, ok: steps.every((s) => s.ok), mxConflict });
}
