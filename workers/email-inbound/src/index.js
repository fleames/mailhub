/**
 * MailHub inbound worker — one worker serves ALL domains.
 *
 * Designed for a hub running on a LOCAL PC (not publicly reachable):
 *   1. Every email is durably buffered into R2 first (INBOX_QUEUE binding).
 *      The hub pulls and ingests the queue — works even if the PC was off for days.
 *   2. If MAILHUB_URL is set (e.g. via a Cloudflare Tunnel), the worker ALSO
 *      pushes directly for instant delivery and deletes the queued copy on success.
 *
 * Setup:
 *   npx wrangler r2 bucket create mailhub
 *   npx wrangler deploy
 *   npx wrangler secret put INBOUND_SECRET     # only needed for push mode
 *   npx wrangler secret put MAILHUB_URL        # optional: tunnel URL for push mode
 *   npx wrangler secret put FALLBACK_EMAIL     # optional: verified fallback address
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const key = `queue/${Date.now()}-${crypto.randomUUID()}.eml`;
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
        const res = await fetch(`${env.MAILHUB_URL}/api/inbound`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.INBOUND_SECRET}`,
            "Content-Type": "message/rfc822",
            "X-Envelope-To": message.to,
            "X-Envelope-From": message.from,
          },
          body: raw,
        });
        if (res.ok && buffered) {
          // Hub has it — drop the queued copy so the poller doesn't re-ingest.
          await env.INBOX_QUEUE.delete(key).catch(() => {});
        }
        if (res.ok) return;
      } catch {
        // Hub offline — the buffered copy will be pulled later.
      }
    }

    if (buffered) return; // safely queued; the hub will pull it

    // Nothing persisted anywhere — don't silently drop mail.
    if (env.FALLBACK_EMAIL) {
      await message.forward(env.FALLBACK_EMAIL);
    } else {
      message.setReject("MailHub buffer unavailable, please retry");
    }
  },
};
