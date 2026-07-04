import { Suspense } from "react";
import { MailClient } from "./mail-client";

export const dynamic = "force-dynamic";

export default async function MailPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = await params;
  return (
    <Suspense>
      <MailClient folder={folder} />
    </Suspense>
  );
}
