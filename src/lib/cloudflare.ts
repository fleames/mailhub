import { createHash } from "crypto";
import { WORKER_NAME, WORKER_SCRIPT } from "./worker-script";

/**
 * Minimal Cloudflare API client for the setup wizard. One user-supplied API
 * token drives everything: R2 bucket creation, worker deployment, Email
 * Routing, catch-all rules, and DNS records.
 *
 * The same token also becomes the app's R2 S3 credential — per Cloudflare's
 * documented scheme, S3 access_key_id = the token's ID and secret_access_key
 * = SHA-256(token value).
 */

const CF = "https://api.cloudflare.com/client/v4";

type CfEnvelope<T> = {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
};

export class CfError extends Error {
  codes: number[];
  constructor(message: string, codes: number[] = []) {
    super(message);
    this.codes = codes;
  }
}

async function cf<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!data?.success) {
    const errs = data?.errors ?? [];
    throw new CfError(
      errs.map((e) => `${e.message} (${e.code})`).join("; ") ||
        `Cloudflare API ${res.status} on ${path}`,
      errs.map((e) => e.code)
    );
  }
  return data.result;
}

export async function verifyToken(token: string): Promise<{ id: string; status: string }> {
  return cf<{ id: string; status: string }>(token, "/user/tokens/verify");
}

export async function getAccounts(token: string): Promise<{ id: string; name: string }[]> {
  return cf<{ id: string; name: string }[]>(token, "/accounts?per_page=25");
}

export async function listZones(
  token: string
): Promise<{ id: string; name: string; status: string }[]> {
  return cf<{ id: string; name: string; status: string }[]>(
    token,
    "/zones?per_page=50&status=active"
  );
}

/** S3 secret for R2, derived from the API token value (documented CF scheme). */
export function deriveS3Secret(tokenValue: string): string {
  return createHash("sha256").update(tokenValue).digest("hex");
}

export async function bucketExists(
  token: string,
  accountId: string,
  name: string
): Promise<boolean> {
  try {
    await cf(token, `/accounts/${accountId}/r2/buckets/${name}`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureBucket(
  token: string,
  accountId: string,
  name: string
): Promise<"created" | "exists"> {
  try {
    await cf(token, `/accounts/${accountId}/r2/buckets`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    return "created";
  } catch (err) {
    // 10004: bucket already exists
    if (err instanceof CfError && (err.codes.includes(10004) || (await bucketExists(token, accountId, name)))) {
      return "exists";
    }
    throw err;
  }
}

export async function workerExists(token: string, accountId: string): Promise<boolean> {
  try {
    await cf(token, `/accounts/${accountId}/workers/scripts/${WORKER_NAME}/settings`);
    return true;
  } catch {
    return false;
  }
}

/** Deploy the embedded email worker with an R2 binding — no wrangler needed. */
export async function deployWorker(
  token: string,
  accountId: string,
  bucketName: string
): Promise<void> {
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-06-01",
    bindings: [{ type: "r2_bucket", name: "INBOX_QUEUE", bucket_name: bucketName }],
  };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append(
    "index.js",
    new Blob([WORKER_SCRIPT], { type: "application/javascript+module" }),
    "index.js"
  );
  await cf(token, `/accounts/${accountId}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    body: form,
  });
}

export async function emailRoutingStatus(
  token: string,
  zoneId: string
): Promise<{ enabled: boolean; status: string }> {
  try {
    const r = await cf<{ enabled: boolean; status: string }>(
      token,
      `/zones/${zoneId}/email/routing`
    );
    return { enabled: r.enabled, status: r.status ?? (r.enabled ? "ready" : "disabled") };
  } catch {
    return { enabled: false, status: "unknown" };
  }
}

export async function enableEmailRouting(token: string, zoneId: string): Promise<string> {
  try {
    const r = await cf<{ enabled: boolean; status?: string }>(
      token,
      `/zones/${zoneId}/email/routing/enable`,
      { method: "POST" }
    );
    return r.status ?? (r.enabled ? "ready" : "pending");
  } catch (err) {
    // 10000 here means the token lacks the settings-write scope this endpoint needs.
    if (err instanceof CfError && err.codes.includes(10000)) {
      throw new CfError(
        'Token lacks "Zone Settings: Edit" — edit the token in Cloudflare (its value stays the same), then press Re-run',
        err.codes
      );
    }
    // 2008: the zone already has MX records Cloudflare didn't create itself,
    // and refuses to enable routing until they're removed.
    if (err instanceof CfError && err.codes.includes(2008)) {
      throw new CfError(
        "Existing (non-Cloudflare) MX records are blocking Email Routing — remove them below, then press Re-run",
        err.codes
      );
    }
    throw err;
  }
}

/** Point the zone's catch-all at the mailhub worker. */
export async function setCatchAll(token: string, zoneId: string): Promise<void> {
  await cf(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: JSON.stringify({
      name: "MailHub catch-all",
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [WORKER_NAME] }],
    }),
  });
}

export type DnsRecordInput = {
  type: string;
  name: string;
  content: string;
  priority?: number;
};

export type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  priority?: number;
};

export async function listMxRecords(token: string, zoneId: string): Promise<DnsRecord[]> {
  return cf<DnsRecord[]>(token, `/zones/${zoneId}/dns_records?type=MX&per_page=100`);
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string
): Promise<void> {
  await cf(token, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
}

/** Create a DNS record; an identical existing record counts as success. */
export async function ensureDnsRecord(
  token: string,
  zoneId: string,
  rec: DnsRecordInput
): Promise<"created" | "exists"> {
  try {
    await cf(token, `/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({ ...rec, ttl: 1, proxied: false }),
    });
    return "created";
  } catch (err) {
    // 81057/81058: record already exists
    if (err instanceof CfError && err.codes.some((c) => c === 81057 || c === 81058)) {
      return "exists";
    }
    throw err;
  }
}
