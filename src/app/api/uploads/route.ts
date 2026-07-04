import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { putObject } from "@/lib/storage";

/** Upload a compose attachment; returns a storage key used at send time. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Max attachment size is 25 MB" }, { status: 413 });
  }

  const safeName = (file.name || "attachment").replace(/[/\\<>:"|?*\x00-\x1f]/g, "_").slice(0, 180);
  const key = `up/${randomUUID()}/${safeName}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");

  return NextResponse.json({
    storageKey: key,
    filename: safeName,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
}
