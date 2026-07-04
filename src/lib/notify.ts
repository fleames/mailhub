import { getConfig } from "./config";
import { env } from "./env";

/** External notifications: Discord / Slack webhooks. Fire-and-forget. */

async function post(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error("Webhook notify failed:", err);
  }
}

export async function notifyNewEmail(opts: {
  from: string;
  subject: string;
  mailbox: string;
  snippet: string;
  conversationId: string;
}) {
  const cfg = await getConfig();
  if (!cfg.notifyOnInbound) return;
  const link = `${env.APP_URL}/mail/all?c=${opts.conversationId}`;
  const text = `📬 **${opts.mailbox}** — new email from **${opts.from}**\n**${opts.subject}**\n${opts.snippet.slice(0, 140)}`;

  if (cfg.discordWebhookUrl) {
    await post(cfg.discordWebhookUrl, {
      embeds: [
        {
          title: opts.subject || "(no subject)",
          description: opts.snippet.slice(0, 300),
          url: link,
          color: 0x6366f1,
          author: { name: `${opts.from} → ${opts.mailbox}` },
        },
      ],
    });
  }
  if (cfg.slackWebhookUrl) {
    await post(cfg.slackWebhookUrl, { text: `${text}\n${link}` });
  }
}

export async function notifyEvent(text: string) {
  const cfg = await getConfig();
  if (cfg.discordWebhookUrl) await post(cfg.discordWebhookUrl, { content: text });
  if (cfg.slackWebhookUrl) await post(cfg.slackWebhookUrl, { text });
}
