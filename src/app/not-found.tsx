import { LinkButton } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";

export default function NotFound() {
  return (
    <Container className="py-20 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-muted">The page you&apos;re looking for doesn&apos;t exist or is no longer available.</p>
      <div className="mt-6 flex justify-center gap-2">
        <LinkButton href="/">Go home</LinkButton>
        <LinkButton href="/search" variant="secondary">
          Find a car
        </LinkButton>
      </div>
    </Container>
  );
}
