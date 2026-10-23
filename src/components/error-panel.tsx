"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";

/** Shared body for error.tsx boundaries. Never shows internal error text. */
export function ErrorPanel({
  error,
  retry,
  title = "Something went wrong",
}: {
  error: unknown;
  retry?: () => void;
  title?: string;
}) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Container className="py-16">
      <div role="alert" className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-danger-soft text-danger" aria-hidden="true">
          !
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">
          We couldn&apos;t load this page. Please try again. If it keeps happening, contact the branch.
        </p>
        {digest && <p className="mt-2 font-mono text-xs text-muted">Reference: {digest}</p>}
        <div className="mt-6 flex justify-center gap-2">
          {retry && <Button onClick={() => retry()}>Try again</Button>}
          <Link href="/" className={buttonClasses("secondary")}>
            Go home
          </Link>
        </div>
      </div>
    </Container>
  );
}
