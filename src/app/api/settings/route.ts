import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, t } from "@/db";
import { setSetting } from "@/lib/config";
import { setBlockedSenderDomains } from "@/lib/blocked-domains";
import { env } from "@/lib/env";
import { storageBackend } from "@/lib/storage";

const SECRET_KEYS = new Set([
  "resend_api_key",
  "resend_webhook_secret",
  "ai_api_key",
  "cf_api_token",
  "r2_secret_access_key",
]);
const MASK = "••••••••";

function mask(v: unknown): string {
  const s = String(v ?? "");
  return s.length > 4 ? `${MASK}${s.slice(-4)}` : MASK;
}

export async function GET(req: NextRequest) {
  const rows = await db.select().from(t.settings);
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    out[row.key] = SECRET_KEYS.has(row.key) && row.value ? mask(row.value) : row.value;
  }
  // Surface env-derived defaults so the settings UI shows effective config.
  out._env = {
    resendKeyFromEnv: Boolean(env.RESEND_API_KEY),
    aiKeyFromEnv: Boolean(env.AI_API_KEY),
    aiBaseUrl: env.AI_BASE_URL,
    aiModel: env.AI_MODEL,
    storageBackend: await storageBackend(),
    appUrl: env.APP_URL,
    // The exact redirect URI to register on the Azure App Registration —
    // derived from the request so it's correct whether this is the docker
    // deployment or the desktop app's embedded server, not just APP_URL.
    microsoftRedirectUri: `${new URL(req.url).origin}/api/oauth/microsoft/callback`,
  };
  return NextResponse.json(out);
}

const schema = z.record(z.string().max(100), z.unknown());

export async function PUT(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  for (const [key, value] of Object.entries(body.data)) {
    if (key.startsWith("_")) continue;
    // Don't overwrite a secret with its own mask echoed back from the UI.
    if (SECRET_KEYS.has(key) && typeof value === "string" && value.includes(MASK)) continue;
    if (key === "blocked_sender_domains") {
      const list = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : typeof value === "string"
          ? value.split(/[\n,]+/)
          : [];
      await setBlockedSenderDomains(list);
      continue;
    }
    await setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}
