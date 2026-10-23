import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PriceBreakdown } from "@/components/booking/price-breakdown";
import { SearchForm } from "@/components/search/search-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { AvailabilityCalendar } from "@/components/vehicles/availability-calendar";
import { VehiclePhoto } from "@/components/vehicles/vehicle-photo";
import { VehicleSpecs } from "@/components/vehicles/vehicle-specs";
import { addMonths } from "@/lib/calendar";
import { formatAED, formatDateTime, utcToZonedDate, zonedLocalToUtc } from "@/lib/format";
import { defaultTrip, parseSearchParams, resolveTrip, toQuery, tripQuery } from "@/lib/search-params";
import { getVehicle, getVehicleAvailability, listBranches, type VehicleDetails as VehicleDetailsData } from "@/server/catalog";
import { isDomainError } from "@/server/errors";
import { quote } from "@/server/pricing";

// Unknown ids must 404 with a real status, so the lookup runs before streaming.
export const instant = false;

export default async function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  await connection();
  const { id } = await params;
  const vehicle = await getVehicle(id);
  if (!vehicle || vehicle.status === "RETIRED") notFound();
  return (
    <Container className="py-6 sm:py-8">
      <Suspense fallback={<PageSkeleton label="Loading car" />}>
        <VehicleDetails vehicle={vehicle} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}

async function VehicleDetails({
  vehicle,
  searchParams,
}: {
  vehicle: VehicleDetailsData;
  searchParams: PageProps<"/vehicles/[id]">["searchParams"];
}) {
  const raw = await searchParams;

  const sp = parseSearchParams(raw);
  const branches = await listBranches();
  const now = new Date();
  const tz = vehicle.branch.timeZone;
  const today = utcToZonedDate(now, tz);
  // Cars are rented from their home branch, so the pick-up branch is fixed.
  const p = { ...sp, pickupBranch: vehicle.branchId };
  const hasTrip = !!(sp.pickupAt && sp.returnAt);
  const trip = hasTrip ? resolveTrip(p, branches, now) : null;

  const monthParam = typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : undefined;
  const firstMonth = monthParam ?? (sp.pickupAt ? sp.pickupAt.slice(0, 7) : today.slice(0, 7));
  const minMonth = today.slice(0, 7);
  const months = [firstMonth < minMonth ? minMonth : firstMonth];
  months.push(addMonths(months[0], 1));
  const from = zonedLocalToUtc(`${months[0]}-01T00:00`, tz)!;
  const to = zonedLocalToUtc(`${addMonths(months[0], 2)}-01T00:00`, tz)!;
  const availability = await getVehicleAvailability(vehicle.id, from, to, now);

  let tripState:
    | { kind: "none" }
    | { kind: "error"; message: string }
    | { kind: "unavailable" }
    | { kind: "ok"; q: Awaited<ReturnType<typeof quote>> } = { kind: "none" };
  if (trip && !trip.ok) tripState = { kind: "error", message: trip.message };
  if (trip?.ok) {
    const tripAvail = await getVehicleAvailability(vehicle.id, trip.pickupAt, trip.returnAt, now);
    if (tripAvail.blocks.length > 0 || vehicle.status === "MAINTENANCE") {
      tripState = { kind: "unavailable" };
    } else {
      try {
        tripState = {
          kind: "ok",
          q: await quote({
            vehicleId: vehicle.id,
            pickupBranchId: trip.pickupBranchId,
            returnBranchId: trip.returnBranchId,
            pickupAt: trip.pickupAt,
            returnAt: trip.returnAt,
          }),
        };
      } catch (err) {
        if (!isDomainError(err)) throw err;
        tripState = { kind: "error", message: err.message };
      }
    }
  }

  const tq = tripQuery(p);
  const monthHref = (m: string) => `/vehicles/${vehicle.id}${toQuery({ ...Object.fromEntries(new URLSearchParams(tq)), month: m })}`;
  const defaults = defaultTrip(now, tz);
  const title = `${vehicle.make} ${vehicle.model}`;
  const returnBranch = branches.find((b) => b.id === (trip?.ok ? trip.returnBranchId : vehicle.branchId)) ?? vehicle.branch;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href={`/search${tq}`} className="hover:text-fg hover:underline">
          ← Back to results
        </Link>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{vehicle.category.name}</Badge>
              {vehicle.branch.isAirport && <Badge tone="info">Airport pick-up</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {title} <span className="font-normal text-muted">{vehicle.year}</span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              Picked up at {vehicle.branch.name}, {vehicle.branch.city}
            </p>
          </div>
          <VehiclePhoto
            src={vehicle.photoUrls[0]}
            alt={`${title} photo`}
            priority
            sizes="(min-width: 1024px) 60vw, 100vw"
            transitionName={`car-${vehicle.id}`}
          />
          {vehicle.photoUrls.length > 1 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {vehicle.photoUrls.slice(1, 5).map((src, i) => (
                <li key={src}>
                  <VehiclePhoto src={src} alt={`${title} photo ${i + 2}`} sizes="25vw" />
                </li>
              ))}
            </ul>
          )}
          <Card>
            <CardBody className="space-y-4">
              <VehicleSpecs v={vehicle} />
              {vehicle.description && <p className="text-sm leading-relaxed">{vehicle.description}</p>}
              {vehicle.features.length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold">Features</h2>
                  <ul className="flex flex-wrap gap-2">
                    {vehicle.features.map((f) => (
                      <li key={f.id}>
                        <Badge>{f.name}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-muted">
                Refundable security deposit for this category: {formatAED(vehicle.category.depositFils)}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <AvailabilityCalendar
                months={months}
                blocks={availability.blocks}
                timeZone={tz}
                today={today}
                selected={sp.pickupAt && sp.returnAt ? { from: sp.pickupAt.slice(0, 10), to: sp.returnAt.slice(0, 10) } : undefined}
                prevHref={months[0] > minMonth ? monthHref(addMonths(months[0], -1)) : undefined}
                nextHref={monthHref(addMonths(months[0], 1))}
              />
              <p className="mt-3 text-xs text-muted">Shown in {vehicle.branch.name} local time ({tz}).</p>
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start" aria-label="Your trip">
          <Card>
            <CardHeader title="Your trip" />
            <CardBody className="space-y-4">
              {tripState.kind === "ok" && trip?.ok && (
                <>
                  <dl className="space-y-1 text-sm">
                    <div>
                      <dt className="text-muted">Pick-up</dt>
                      <dd className="font-medium">
                        {vehicle.branch.name} · {formatDateTime(trip.pickupAt, tz)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Return</dt>
                      <dd className="font-medium">
                        {returnBranch.name} · {formatDateTime(trip.returnAt, returnBranch.timeZone)}
                      </dd>
                    </div>
                  </dl>
                  <PriceBreakdown q={tripState.q} title="Estimated price" />
                  <p className="text-xs text-muted">Extras are added in the next step.</p>
                  <LinkButton href={`/book/${vehicle.id}${tq}`} size="lg" className="w-full" data-testid="vehicle-book">
                    Book this car
                  </LinkButton>
                </>
              )}
              {tripState.kind === "unavailable" && (
                <Alert tone="warning" title="Not available for your dates">
                  This car is booked for part of that time. Pick other dates below or{" "}
                  <Link href={`/search${tq}`}>see similar cars</Link>.
                </Alert>
              )}
              {tripState.kind === "error" && <Alert tone="danger">{tripState.message}</Alert>}
              {tripState.kind !== "ok" && (
                <SearchForm
                  action={`/vehicles/${vehicle.id}`}
                  lockPickup
                  branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city }))}
                  initial={{
                    pickupBranch: vehicle.branchId,
                    returnBranch: sp.returnBranch,
                    pickupAt: sp.pickupAt ?? defaults.pickupAt,
                    returnAt: sp.returnAt ?? defaults.returnAt,
                  }}
                  minDate={today}
                  submitLabel="Check price"
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-sm">
              <h2 className="font-semibold">{vehicle.branch.name}</h2>
              <p className="mt-1 text-muted">{vehicle.branch.address}</p>
              <p className="mt-1 text-muted">Open {vehicle.branch.openingHours}</p>
              <Link href={`/branches/${vehicle.branch.id}`} className="mt-2 inline-block font-medium text-brand hover:underline">
                Branch details
              </Link>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
