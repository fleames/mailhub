/**
 * The Cloudflare Email Worker source, embedded so the in-app setup wizard can
 * deploy it via the Workers API without wrangler.
 *
 * KEEP IN SYNC with workers/email-inbound/src/index.js (the copy for manual
 * `wrangler deploy`). The logic is identical.
 */
export const WORKER_NAME = "mailhub-inbound";

export const WORKER_SCRIPT = `
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const key = \`queue/\${Date.now()}-\${crypto.randomUUID()}.eml\`;
    let buffered = false;

    // 1. Durable buffer first — this is the "never lose mail" guarantee.
    if (env.INBOX_QUEUE) {
      try {
        await env.INBOX_QUEUE.put(key, raw, {
          customMetadata: { to: message.to || "", from: message.from || "" },
        });
        buffered = true;
      } catch (err) {
        console.error("R2 buffer failed:", err);
      }
    }

    // 2. Optional fast path: push straight to the hub (tunnel mode).
    if (env.MAILHUB_URL && env.INBOUND_SECRET) {
      try {
        const res = await fetch(\`\${env.MAILHUB_URL}/api/inbound\`, {
          method: "POST",
          headers: {
            Authorization: \`Bearer \${env.INBOUND_SECRET}\`,
            "Content-Type": "message/rfc822",
            "X-Envelope-To": message.to,
            "X-Envelope-From": message.from,
          },
          body: raw,
        });
        if (res.ok && buffered) {
          await env.INBOX_QUEUE.delete(key).catch(() => {});
        }
        if (res.ok) return;
      } catch {}
    }

    if (buffered) return;

    if (env.FALLBACK_EMAIL) {
      await message.forward(env.FALLBACK_EMAIL);
    } else {
      message.setReject("MailHub buffer unavailable, please retry");
    }
  },
};
`.trim();
