import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, t } from "@/db";
import { setSetting } from "@/lib/config";
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

export async function GET() {
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
    await setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}
