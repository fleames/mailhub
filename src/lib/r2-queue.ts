import {
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getR2 } from "./storage";
import { ingestRawEmail } from "./ingest";

/**
 * Pull-mode inbound: the Cloudflare Email Worker buffers every message into
 * R2 under queue/ (see workers/email-inbound). This poller drains that queue,
 * so the hub can run on a local PC with no public endpoint — mail simply
 * accumulates in R2 while the PC is off and is ingested on the next poll.
 *
 * Duplicate safety: ingest dedupes on (Message-ID, mailbox), so a message
 * that was also push-delivered is skipped, not doubled.
 */

const PREFIX = "queue/";
let draining = false;

export async function drainInboundQueue(): Promise<number> {
  const r2 = await getR2();
  if (!r2 || draining) return 0;
  draining = true;
  let ingested = 0;
  try {
    const list = await r2.client.send(
      new ListObjectsV2Command({
        Bucket: r2.bucket,
        Prefix: PREFIX,
        MaxKeys: 25,
      })
    );

    for (const obj of list.Contents ?? []) {
      if (!obj.Key) continue;
      try {
        const res = await r2.client.send(
          new GetObjectCommand({ Bucket: r2.bucket, Key: obj.Key })
        );
        const bytes = await res.Body?.transformToByteArray();
        if (!bytes) continue;

        const result = await ingestRawEmail({
          raw: Buffer.from(bytes),
          envelopeTo: res.Metadata?.to || null,
          envelopeFrom: res.Metadata?.from || null,
        });

        // Ingest persists the raw in both success and dead-letter branches,
        // so the queue copy is redundant either way — delete it.
        await r2.client.send(
          new DeleteObjectCommand({ Bucket: r2.bucket, Key: obj.Key })
        );
        if (result.ok) ingested++;
      } catch (err) {
        console.error(`Queue drain failed for ${obj.Key}:`, err);
      }
    }
  } catch (err) {
    console.error("Queue list failed:", err);
  } finally {
    draining = false;
  }
  return ingested;
}
