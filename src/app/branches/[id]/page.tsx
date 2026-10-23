import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SearchForm } from "@/components/search/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatAED, formatTime, timeZoneLabel, utcToZonedDate } from "@/lib/format";
import { defaultTrip } from "@/lib/search-params";
import { getBranch, listBranches } from "@/server/catalog";

export default function BranchPage({ params }: PageProps<"/branches/[id]">) {
  return (
    <Container className="py-6 sm:py-8">
      <Suspense fallback={<PageSkeleton label="Loading branch" />}>
        <BranchDetails params={params} />
      </Suspense>
    </Container>
  );
}

async function BranchDetails({ params }: { params: PageProps<"/branches/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const branch = await getBranch(id);
  if (!branch || !branch.isActive) notFound();
  const branches = await listBranches();
  const now = new Date();
  const trip = defaultTrip(now, branch.timeZone);
  const mapUrl =
    branch.latitude != null && branch.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${branch.latitude}&mlon=${branch.longitude}#map=16/${branch.latitude}/${branch.longitude}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${branch.address}, ${branch.city}`)}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link href="/branches" className="hover:text-fg hover:underline">
          ← All branches
        </Link>
      </nav>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{branch.name}</h1>
          {branch.isAirport && <Badge tone="info">Airport</Badge>}
        </div>
        <p className="mt-1 text-muted">
          {branch.city}, {branch.emirate}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
        <Card>
          <CardHeader title="Branch information" />
          <CardBody>
            <DescriptionList
              items={[
                { term: "Address", value: branch.address },
                { term: "Opening hours", value: branch.openingHours === "24h" ? "Open 24 hours" : branch.openingHours },
                {
                  term: "Local time",
                  value: `${formatTime(now, branch.timeZone)} ${timeZoneLabel(branch.timeZone, now)}`,
                },
                ...(branch.phone
                  ? [{ term: "Phone", value: <a className="hover:underline" href={`tel:${branch.phone.replace(/\s/g, "")}`}>{branch.phone}</a> }]
                  : []),
                ...(branch.email
                  ? [{ term: "Email", value: <a className="hover:underline" href={`mailto:${branch.email}`}>{branch.email}</a> }]
                  : []),
                { term: "One-way drop-off fee", value: formatAED(branch.oneWayFeeFils) },
                { term: "Branch code", value: branch.code },
              ]}
            />
            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
            >
              Open in map<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={`Rent from ${branch.name}`} />
          <CardBody>
            <SearchForm
              branches={branches.map((b) => ({ id: b.id, name: b.name, city: b.city }))}
              initial={{ pickupBranch: branch.id, ...trip }}
              minDate={utcToZonedDate(now, branch.timeZone)}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
