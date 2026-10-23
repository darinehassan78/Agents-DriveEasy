import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SearchForm } from "@/components/search/search-form";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_TIME_ZONE, formatAED, utcToZonedDate } from "@/lib/format";
import { defaultTrip } from "@/lib/search-params";
import { listBranches, listCategories } from "@/server/catalog";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-soft to-bg">
        <Container className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[1fr_28rem] lg:items-center lg:gap-12">
          <div>
            <div className="reveal" style={{ "--i": 0 } as React.CSSProperties}>
              <Badge tone="brand">Dubai · Abu Dhabi · Sharjah</Badge>
            </div>
            <h1 style={{ "--i": 1 } as React.CSSProperties} className="reveal mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Rent a car across the UAE, the easy way.
            </h1>
            <p style={{ "--i": 2 } as React.CSSProperties} className="reveal mt-4 max-w-xl text-lg text-muted">
              Clear prices in AED with VAT included at checkout, free cancellation up to 48 hours before pick-up,
              and a digital voucher you show at the counter.
            </p>
            <ul style={{ "--i": 3 } as React.CSSProperties} className="reveal mt-6 grid max-w-xl gap-3 text-sm sm:grid-cols-3">
              {["No hidden fees", "Airport branches", "One-way rentals"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="size-5 text-brand" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div style={{ "--i": 2 } as React.CSSProperties} className="reveal-x rounded-2xl border border-line bg-surface p-5 shadow-lg sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Find your car</h2>
            <Suspense fallback={<SearchSkeleton />}>
              <HomeSearch />
            </Suspense>
          </div>
        </Container>
      </section>

      <Container className="py-12">
        <h2 className="text-2xl font-semibold tracking-tight">Cars for every trip</h2>
        <p className="mt-1 text-muted">Pick a category. Availability and prices depend on your dates and branch.</p>
        <Suspense fallback={<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div>}>
          <Categories />
        </Suspense>
      </Container>

      <Container className="pb-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Pick your dates", "Search by branch, date and time. Times are always local to the branch."],
            ["Add extras", "Child seat, GPS, an additional driver or full insurance cover."],
            ["Show your voucher", "Pay online, then show the QR voucher and your licence at pick-up."],
          ].map(([t, d], i) => (
            <div key={t} className="scroll-reveal rounded-xl border border-line bg-surface p-5" style={{ "--i": i } as React.CSSProperties}>
              <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-fg">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{t}</h3>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </Container>
    </>
  );
}

async function HomeSearch() {
  await connection();
  const branches = await listBranches();
  if (branches.length === 0) {
    return <p className="text-sm text-muted">No branches are open for bookings right now. Please check back soon.</p>;
  }
  const now = new Date();
  const tz = branches[0]?.timeZone ?? DEFAULT_TIME_ZONE;
  const trip = defaultTrip(now, tz);
  return (
    <SearchForm
      branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city }))}
      initial={{ pickupBranch: branches[0].id, ...trip }}
      minDate={utcToZonedDate(now, tz)}
    />
  );
}

async function Categories() {
  await connection();
  const categories = await listCategories();
  if (categories.length === 0) return null;
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {categories.map((c, i) => (
        <li key={c.id} className="scroll-reveal" style={{ "--i": i % 4 } as React.CSSProperties}>
          <Link
            href={`/search?category=${c.id}`}
            className="lift-card block h-full rounded-xl border border-line bg-surface p-5"
          >
            <h3 className="font-semibold">{c.name}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>
            <p className="mt-3 text-xs text-muted">Deposit {formatAED(c.depositFils, { whole: true })}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading search">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
