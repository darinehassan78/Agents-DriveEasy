import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { FiltersForm } from "@/components/search/filters-form";
import { SearchForm } from "@/components/search/search-form";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Container, PageHeader } from "@/components/ui/page-header";
import { CardListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { VehicleCard } from "@/components/vehicles/vehicle-card";
import { formatDateTime, pluralize, utcToZonedDate } from "@/lib/format";
import {
  FUEL_TYPES,
  TRANSMISSIONS,
  defaultTrip,
  parseSearchParams,
  resolveTrip,
  toQuery,
  tripQuery,
} from "@/lib/search-params";
import { listBranches, listCategories, searchAvailableVehicles } from "@/server/catalog";
import { isDomainError } from "@/server/errors";

export const metadata: Metadata = { title: "Find a car" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Container className="py-6 sm:py-8">
      <PageHeader title="Find a car" description="Only cars that are free for your whole trip are shown." />
      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  await connection();
  const params = parseSearchParams(await searchParams);
  const [branches, categories] = await Promise.all([listBranches(), listCategories()]);
  const now = new Date();
  const trip = resolveTrip(params, branches, now);
  const pickupBranch = branches.find((b) => b.id === params.pickupBranch) ?? branches[0];
  const returnBranch = branches.find((b) => b.id === (params.returnBranch ?? params.pickupBranch)) ?? pickupBranch;

  if (!pickupBranch) {
    return <EmptyState title="No branches are open" description="Bookings are paused right now. Please check back soon." />;
  }

  const filters = {
    category: params.category,
    transmission: params.transmission,
    seats: params.seats,
    fuel: params.fuel,
    maxPrice: params.maxPrice,
    sort: params.sort,
  };
  const defaults = defaultTrip(now, pickupBranch.timeZone);
  const searchBar = (
    <Card className="mb-6">
      <CardBody>
        <SearchForm
          layout="bar"
          branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city }))}
          initial={{
            pickupBranch: pickupBranch.id,
            returnBranch: params.returnBranch,
            pickupAt: params.pickupAt ?? defaults.pickupAt,
            returnAt: params.returnAt ?? defaults.returnAt,
          }}
          minDate={utcToZonedDate(now, pickupBranch.timeZone)}
          submitLabel={trip.ok ? "Update search" : "Search cars"}
          hidden={{ ...filters, seats: filters.seats?.toString(), maxPrice: filters.maxPrice?.toString() }}
        />
      </CardBody>
    </Card>
  );

  if (!trip.ok) {
    return (
      <>
        {searchBar}
        {trip.reason === "missing" ? (
          <EmptyState title="Where and when?" description="Choose a branch and your pick-up and return times to see available cars." />
        ) : (
          <Alert tone="danger" title="Check your search">
            {trip.message}
          </Alert>
        )}
      </>
    );
  }

  let results;
  try {
    results = await searchAvailableVehicles(
      {
        pickupBranchId: trip.pickupBranchId,
        returnBranchId: trip.returnBranchId,
        pickupAt: trip.pickupAt,
        returnAt: trip.returnAt,
        categoryId: categories.some((c) => c.id === params.category) ? params.category : undefined,
        transmission: params.transmission,
        fuelType: params.fuel,
        minSeats: params.seats,
        maxDailyRateFils: params.maxPrice ? params.maxPrice * 100 : undefined,
        sort: params.sort ?? "price_asc",
      },
      now,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return (
      <>
        {searchBar}
        <Alert tone="danger" title="Check your search">
          {err.message}
        </Alert>
      </>
    );
  }

  const tripParams: Record<string, string | undefined> = {
    pickupBranch: params.pickupBranch,
    returnBranch: params.returnBranch !== params.pickupBranch ? params.returnBranch : undefined,
    pickupAt: params.pickupAt,
    returnAt: params.returnAt,
  };
  const tq = tripQuery(params);

  return (
    <>
      {searchBar}
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <aside aria-label="Filters">
          <details className="filters-details group rounded-xl border border-line bg-surface">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold lg:hidden">
              Filters and sorting
              <span aria-hidden="true" className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="border-t border-line p-4 lg:border-t-0">
              <FiltersForm
                values={filters}
                trip={tripParams}
                categories={categories.map((c) => ({ id: c.id, name: c.name }))}
                transmissions={TRANSMISSIONS}
                fuels={FUEL_TYPES}
                priceSteps={[100, 150, 200, 300, 500, 800]}
              />
            </div>
          </details>
        </aside>
        <section aria-labelledby="results-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="results-heading" className="text-lg font-semibold" aria-live="polite">
              {pluralize(results.length, "car")} available
            </h2>
            <p className="text-sm text-muted">
              {pickupBranch.name}, {formatDateTime(trip.pickupAt, pickupBranch.timeZone)} →{" "}
              {returnBranch.id !== pickupBranch.id ? `${returnBranch.name}, ` : ""}
              {formatDateTime(trip.returnAt, returnBranch.timeZone)}
            </p>
          </div>
          {results.length === 0 ? (
            <EmptyState
              title="No cars match"
              description="Try different dates, another branch, or fewer filters."
              action={
                <LinkButton href={`/search${toQuery(tripParams)}`} variant="secondary">
                  Clear filters
                </LinkButton>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((r) => (
                <VehicleCard
                  key={r.vehicle.id}
                  href={`/vehicles/${r.vehicle.id}${tq}`}
                  bookHref={`/book/${r.vehicle.id}${tq}`}
                  v={{
                    id: r.vehicle.id,
                    make: r.vehicle.make,
                    model: r.vehicle.model,
                    year: r.vehicle.year,
                    categoryName: r.vehicle.category.name,
                    transmission: r.vehicle.transmission,
                    fuelType: r.vehicle.fuelType,
                    seats: r.vehicle.seats,
                    luggage: r.vehicle.luggage,
                    photoUrl: r.vehicle.photoUrls[0],
                    features: r.vehicle.features.map((f) => f.name),
                    dailyRateFils: r.dailyRateFils,
                    days: r.days,
                    estimatedTotalFils: r.estimatedTotalFils,
                    oneWayFeeFils: r.oneWayFeeFils,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-label="Loading cars">
      <Skeleton className="mb-6 h-40 w-full lg:h-28" />
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <Skeleton className="h-12 lg:h-96" />
        <CardListSkeleton count={6} label="Loading cars" />
      </div>
    </div>
  );
}

