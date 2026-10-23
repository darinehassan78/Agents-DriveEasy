import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Access denied", robots: { index: false } };

export default function ForbiddenPage() {
  return (
    <Container className="py-20 text-center">
      <p className="text-sm font-semibold text-danger">403</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-muted">This area is for DriveEasy staff only.</p>
      <div className="mt-6 flex justify-center gap-2">
        <LinkButton href="/">Go home</LinkButton>
        <LinkButton href="/rentals" variant="secondary">
          My rentals
        </LinkButton>
      </div>
    </Container>
  );
}
