import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { promises as fs } from "fs";
import path from "path";
import { env } from "./env";
import { getConfig } from "./config";

/**
 * Object storage for raw MIME and attachments.
 * Uses Cloudflare R2 when configured (settings override env — the setup
 * wizard writes credentials into settings at runtime), local disk otherwise.
 */

let cached: { key: string; client: S3Client } | null = null;

export async function getR2(): Promise<{ client: S3Client; bucket: string } | null> {
  const cfg = await getConfig();
  if (!cfg.r2AccountId || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey || !cfg.r2Bucket) {
    return null;
  }
  const key = [cfg.r2AccountId, cfg.r2AccessKeyId, cfg.r2SecretAccessKey, cfg.r2Bucket].join("|");
  if (cached?.key !== key) {
    cached = {
      key,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: cfg.r2AccessKeyId,
          secretAccessKey: cfg.r2SecretAccessKey,
        },
      }),
    };
  }
  return { client: cached.client, bucket: cfg.r2Bucket };
}

function localPath(key: string): string {
  const safe = path
    .normalize(key)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/[<>:"|?*]/g, "_");
  const full = path.resolve(env.STORAGE_DIR, safe);
  const root = path.resolve(env.STORAGE_DIR);
  if (!full.startsWith(root)) throw new Error(`Invalid storage key: ${key}`);
  return full;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType = "application/octet-stream"
): Promise<void> {
  const r2 = await getR2();
  if (r2) {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  } else {
    const p = localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }
}

export async function getObject(key: string): Promise<Buffer | null> {
  const r2 = await getR2();
  if (r2) {
    try {
      const res = await r2.client.send(
        new GetObjectCommand({ Bucket: r2.bucket, Key: key })
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(localPath(key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const r2 = await getR2();
  if (r2) {
    await r2.client.send(
      new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })
    );
  } else {
    await fs.rm(localPath(key), { force: true });
  }
}

export async function storageBackend(): Promise<"r2" | "local"> {
  return (await getR2()) ? "r2" : "local";
}

/** Round-trip probe used by the setup wizard to prove derived credentials work. */
export async function probeR2(): Promise<{ ok: boolean; error?: string }> {
  const r2 = await getR2();
  if (!r2) return { ok: false, error: "R2 not configured" };
  const key = `probe/${Date.now()}.txt`;
  try {
    await r2.client.send(
      new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: Buffer.from("mailhub probe") })
    );
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
