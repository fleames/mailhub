import { getSetting, setSetting } from "./config";

const SETTING_KEY = "combined_inbox_webhooks";

export type CombinedInboxWebhooks = Record<string, { discordWebhookUrl?: string }>;

export async function getCombinedInboxWebhooks(): Promise<CombinedInboxWebhooks> {
  const raw = await getSetting<CombinedInboxWebhooks>(SETTING_KEY);
  return raw && typeof raw === "object" ? raw : {};
}

export async function setCombinedInboxDiscordWebhook(
  localPart: string,
  discordWebhookUrl: string | null
): Promise<void> {
  const key = localPart.trim().toLowerCase();
  if (!key) throw new Error("localPart is required");

  const map = { ...(await getCombinedInboxWebhooks()) };
  const trimmed = discordWebhookUrl?.trim() ?? "";

  if (trimmed) {
    map[key] = { ...map[key], discordWebhookUrl: trimmed };
  } else if (map[key]) {
    const { discordWebhookUrl: _, ...rest } = map[key];
    if (Object.keys(rest).length === 0) delete map[key];
    else map[key] = rest;
  }

  await setSetting(SETTING_KEY, map);
}

export async function getCombinedInboxDiscordWebhook(
  localPart: string
): Promise<string | null> {
  const map = await getCombinedInboxWebhooks();
  const url = map[localPart.trim().toLowerCase()]?.discordWebhookUrl;
  return url?.trim() ? url : null;
}
