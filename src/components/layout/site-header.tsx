import Link from "next/link";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/session";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "./logo";
import { NavBar } from "./nav-bar";

export function SiteHeader() {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-fg"
      >
        Skip to content
      </a>
      <Container className="flex h-16 items-center gap-4">
        <Link href="/" className="shrink-0 rounded-md" aria-label="DriveEasy home">
          <Logo />
        </Link>
        <Suspense fallback={<NavFallback />}>
          <UserNav />
        </Suspense>
      </Container>
    </header>
  );
}

async function UserNav() {
  const user = await getSessionUser();
  return <NavBar user={user ? { name: user.name, email: user.email, isAdmin: user.role === "admin" } : null} />;
}

function NavFallback() {
  return (
    <div className="ml-auto flex items-center gap-3">
      <Skeleton className="hidden h-5 w-56 md:block" />
      <Skeleton className="h-9 w-20" />
    </div>
  );
}
