import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Container, PageHeader } from "@/components/ui/page-header";
import { CardListSkeleton } from "@/components/ui/skeleton";
import { formatAED } from "@/lib/format";
import { listBranches } from "@/server/catalog";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Container className="py-6 sm:py-8">
      <PageHeader title="Our branches" description="Pick up at any branch and return to the same one or another for a one-way fee." />
      <Suspense fallback={<CardListSkeleton count={6} label="Loading branches" />}>
        <BranchList />
      </Suspense>
    </Container>
  );
}

async function BranchList() {
  await connection();
  const branches = await listBranches();
  if (branches.length === 0) return <EmptyState title="No branches yet" description="Branches will appear here once they open." />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {branches.map((b) => (
        <li key={b.id}>
          <article data-testid="branch-card" className="flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold">
                <Link href={`/branches/${b.id}`} className="hover:underline">
                  {b.name}
                </Link>
              </h2>
              {b.isAirport && <Badge tone="info">Airport</Badge>}
            </div>
            <p className="text-sm text-muted">
              {b.city}, {b.emirate}
            </p>
            <p className="mt-3 text-sm">{b.address}</p>
            <dl className="mt-3 space-y-1 text-sm text-muted">
              <div className="flex gap-2">
                <dt>Hours:</dt>
                <dd className="text-fg">{b.openingHours === "24h" ? "Open 24 hours" : b.openingHours}</dd>
              </div>
              {b.phone && (
                <div className="flex gap-2">
                  <dt>Phone:</dt>
                  <dd>
                    <a className="text-fg hover:underline" href={`tel:${b.phone.replace(/\s/g, "")}`}>
                      {b.phone}
                    </a>
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt>One-way drop-off fee:</dt>
                <dd className="text-fg">{formatAED(b.oneWayFeeFils, { whole: true })}</dd>
              </div>
            </dl>
            <div className="mt-auto flex gap-3 pt-4 text-sm font-medium">
              <Link className="text-brand hover:underline" href={`/search?pickupBranch=${b.id}`}>
                Find cars here
              </Link>
              <Link className="text-muted hover:text-fg hover:underline" href={`/branches/${b.id}`}>
                Details
              </Link>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
