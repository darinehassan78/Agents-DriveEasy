import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requirePageAdmin } from "@/lib/session";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · DriveEasy" } };

// Guards: src/proxy.ts (403/redirect before render), this layout (nothing of
// the admin shell renders for non-admins), and every page + server action.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Container className="py-6 sm:py-8">
      <Suspense fallback={<PageSkeleton label="Loading admin" />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </Container>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requirePageAdmin("/admin");
  return (
    <div data-testid="admin-shell" className="grid gap-6 lg:grid-cols-[13rem_1fr]">
      <AdminNav />
      <div className="min-w-0">
        <Suspense fallback={<PageSkeleton label="Loading admin page" />}>{children}</Suspense>
      </div>
    </div>
  );
}
