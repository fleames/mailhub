"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-base px-6 text-center">
      <AlertTriangle className="h-9 w-9 text-danger" />
      <h1 className="text-base font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-mut">
        MailHub hit an unexpected error. Your mail is safe — try reloading this view.
      </p>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => (window.location.href = "/")}>Go to dashboard</Button>
      </div>
    </div>
  );
}
