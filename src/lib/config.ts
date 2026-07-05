import { eq, inArray } from "drizzle-orm";
import { db, t } from "@/db";
import { env } from "./env";

/**
 * Runtime configuration: DB settings override env vars.
 * Cached briefly so hot paths don't hit the DB per request.
 */

export type AppConfig = {
  resendApiKey: string | null;
  resendWebhookSecret: string | null;
  aiApiKey: string | null;
  aiBaseUrl: string;
  aiModel: string;
  undoSendSeconds: number;
  discordWebhookUrl: string | null;
  slackWebhookUrl: string | null;
  notifyOnInbound: boolean;
  browserNotifications: boolean;
  autoTagInbound: boolean;
  spamThreshold: number;
  // Cloudflare (setup wizard + R2; settings override env)
  cfApiToken: string | null;
  r2AccountId: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  r2Bucket: string | null;
  microsoftClientId: string | null;
};

const CONFIG_KEYS = [
  "resend_api_key",
  "resend_webhook_secret",
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "undo_send_seconds",
  "discord_webhook_url",
  "slack_webhook_url",
  "notify_on_inbound",
  "browser_notifications",
  "auto_tag_inbound",
  "spam_threshold",
  "cf_api_token",
  "r2_account_id",
  "r2_access_key_id",
  "r2_secret_access_key",
  "r2_bucket",
  "microsoft_client_id",
];

let cache: { value: AppConfig; at: number } | null = null;
const CACHE_MS = 15_000;

export async function getConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const rows = await db
    .select()
    .from(t.settings)
    .where(inArray(t.settings.key, CONFIG_KEYS));
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const str = (k: string, fallback: string | null = null): string | null => {
    const v = s[k];
    return typeof v === "string" && v.trim() !== "" ? v : fallback;
  };

  const value: AppConfig = {
    resendApiKey: str("resend_api_key", env.RESEND_API_KEY ?? null),
    resendWebhookSecret: str(
      "resend_webhook_secret",
      env.RESEND_WEBHOOK_SECRET ?? null
    ),
    aiApiKey: str("ai_api_key", env.AI_API_KEY ?? null),
    aiBaseUrl: str("ai_base_url", env.AI_BASE_URL)!,
    aiModel: str("ai_model", env.AI_MODEL)!,
    undoSendSeconds:
      typeof s.undo_send_seconds === "number"
        ? s.undo_send_seconds
        : env.UNDO_SEND_SECONDS,
    discordWebhookUrl: str("discord_webhook_url"),
    slackWebhookUrl: str("slack_webhook_url"),
    notifyOnInbound: s.notify_on_inbound !== false,
    browserNotifications: s.browser_notifications !== false,
    autoTagInbound: s.auto_tag_inbound === true,
    spamThreshold:
      typeof s.spam_threshold === "number" ? s.spam_threshold : 5,
    cfApiToken: str("cf_api_token"),
    r2AccountId: str("r2_account_id", env.R2_ACCOUNT_ID ?? null),
    r2AccessKeyId: str("r2_access_key_id", env.R2_ACCESS_KEY_ID ?? null),
    r2SecretAccessKey: str("r2_secret_access_key", env.R2_SECRET_ACCESS_KEY ?? null),
    r2Bucket: str("r2_bucket", env.R2_BUCKET ?? null),
    microsoftClientId: str("microsoft_client_id", env.MICROSOFT_CLIENT_ID ?? null),
  };

  cache = { value, at: Date.now() };
  return value;
}

export function invalidateConfigCache() {
  cache = null;
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(t.settings)
    .where(eq(t.settings.key, key));
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(t.settings)
    .values({ key, value: value as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: t.settings.key,
      set: { value: value as object, updatedAt: new Date() },
    });
  invalidateConfigCache();
}
