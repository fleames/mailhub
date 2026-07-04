import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConfig, invalidateConfigCache, setSetting } from "@/lib/config";
import { probeR2 } from "@/lib/storage";
import {
  deployWorker,
  deriveS3Secret,
  ensureBucket,
  getAccounts,
  verifyToken,
} from "@/lib/cloudflare";
import { logEvent } from "@/lib/bus";

export const maxDuration = 120;

const schema = z.object({
  cfToken: z.string().min(20).optional(),
  resendKey: z.string().min(8).optional(),
});

export type SetupStep = { step: string; ok: boolean; detail?: string };

/**
 * One-time global setup, fully automatic:
 *   verify token → find account → create R2 bucket → derive S3 credentials
 *   from the token (CF scheme: key = token id, secret = sha256(token)) →
 *   probe them → deploy the email worker via the Workers API.
 */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }

  const cfg = await getConfig();
  const token = body.data.cfToken?.trim() || cfg.cfApiToken;
  if (!token) {
    return NextResponse.json({ error: "Paste a Cloudflare API token first" }, { status: 400 });
  }

  const steps: SetupStep[] = [];
  const run = async (step: string, fn: () => Promise<string | void>): Promise<boolean> => {
    try {
      const detail = await fn();
      steps.push({ step, ok: true, detail: detail ?? undefined });
      return true;
    } catch (err) {
      steps.push({ step, ok: false, detail: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };

  let tokenId = "";
  if (!(await run("Verify Cloudflare token", async () => {
    const v = await verifyToken(token);
    tokenId = v.id;
    return `token ${v.status}`;
  }))) {
    return NextResponse.json({ steps });
  }

  let accountId = "";
  if (!(await run("Find account", async () => {
    const accounts = await getAccounts(token);
    if (accounts.length === 0) throw new Error("Token can't list accounts — add 'Account Settings: Read'");
    accountId = accounts[0].id;
    return accounts.length > 1
      ? `using "${accounts[0].name}" (first of ${accounts.length})`
      : accounts[0].name;
  }))) {
    return NextResponse.json({ steps });
  }

  const bucket = cfg.r2Bucket ?? "mailhub";
  await run(`Create R2 bucket "${bucket}"`, async () => ensureBucket(token, accountId, bucket));

  await run("Derive + save R2 credentials", async () => {
    await setSetting("cf_api_token", token);
    await setSetting("r2_account_id", accountId);
    await setSetting("r2_access_key_id", tokenId);
    await setSetting("r2_secret_access_key", deriveS3Secret(token));
    await setSetting("r2_bucket", bucket);
    invalidateConfigCache();
  });

  await run("Probe R2 access (write/delete)", async () => {
    const probe = await probeR2();
    if (!probe.ok) {
      throw new Error(
        `${probe.error} — the token likely lacks "Workers R2 Storage: Edit" permission`
      );
    }
  });

  await run(`Deploy email worker`, async () => {
    await deployWorker(token, accountId, bucket);
    return "mailhub-inbound live";
  });

  if (body.data.resendKey?.trim()) {
    await run("Save Resend API key", async () => {
      await setSetting("resend_api_key", body.data.resendKey!.trim());
    });
  }

  await logEvent("setup.global", { payload: { steps } });
  return NextResponse.json({ steps, ok: steps.every((s) => s.ok) });
}
