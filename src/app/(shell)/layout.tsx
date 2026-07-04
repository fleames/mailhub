import { Suspense } from "react";
import { AppShell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
