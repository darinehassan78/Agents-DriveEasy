import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { formatAED, pluralize } from "@/lib/format";
import { VehiclePhoto } from "./vehicle-photo";
import { VehicleSpecs } from "./vehicle-specs";

export interface VehicleCardData {
  id: string;
  make: string;
  model: string;
  year: number;
  categoryName: string;
  transmission: string;
  fuelType: string;
  seats: number;
  luggage: number;
  photoUrl?: string | null;
  features?: string[];
  dailyRateFils: number;
  days: number;
  estimatedTotalFils: number;
  oneWayFeeFils: number;
}

export function VehicleCard({ v, href, bookHref }: { v: VehicleCardData; href: string; bookHref: string }) {
  const title = `${v.make} ${v.model}`;
  return (
    <article
      data-testid="vehicle-card"
      data-vehicle-id={v.id}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-shadow hover:shadow-md"
    >
      <Link href={href} className="block p-3 pb-0" tabIndex={-1} aria-hidden="true">
        <VehiclePhoto src={v.photoUrl} alt={`${title} photo`} />
      </Link>
      <div className="flex flex-1 flex-col gap-0 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              <Link href={href} className="hover:underline">
                {title}
              </Link>
            </h3>
            <p className="text-sm text-muted">
              {v.year} · or similar
            </p>
          </div>
          <Badge tone="brand">{v.categoryName}</Badge>
        </div>
        <div className="mt-3">
          <VehicleSpecs v={v} compact />
        </div>
        {v.features && v.features.length > 0 && (
          <p className="mt-2 line-clamp-1 text-xs text-muted">{v.features.join(" · ")}</p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-4">
          <div>
            <p className="text-lg font-semibold tabular-nums" data-testid="vehicle-daily-rate">
              {formatAED(v.dailyRateFils)}
              <span className="text-sm font-normal text-muted"> /day</span>
            </p>
            <p className="text-xs text-muted" data-testid="vehicle-estimated-total">
              {formatAED(v.estimatedTotalFils)} for {pluralize(v.days, "day")} incl. VAT
              {v.oneWayFeeFils > 0 ? " and one-way fee" : ""}
            </p>
          </div>
          <Link href={bookHref} className={buttonClasses("primary", "sm")} aria-label={`Book ${title}`}>
            Book
          </Link>
        </div>
      </div>
    </article>
  );
}
