"use client";

import Link from "next/link";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/field";
import { titleCase } from "@/lib/format";

export interface FilterValues {
  category?: string;
  transmission?: string;
  seats?: number;
  fuel?: string;
  maxPrice?: number;
  sort?: string;
}

/**
 * Result filters. A plain GET form (works without JS) that re-submits on change.
 * Trip params are carried as hidden fields.
 */
export function FiltersForm({
  values,
  trip,
  categories,
  transmissions,
  fuels,
  priceSteps,
}: {
  values: FilterValues;
  trip: Record<string, string | undefined>;
  categories: Array<{ id: string; name: string }>;
  transmissions: readonly string[];
  fuels: readonly string[];
  priceSteps: number[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => ref.current?.requestSubmit();
  const hasFilters = !!(values.category || values.transmission || values.seats || values.fuel || values.maxPrice);

  return (
    <form ref={ref} method="get" action="/search" aria-label="Filter results" className="space-y-4" data-testid="filters-form">
      {Object.entries(trip).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <div>
        <Label htmlFor="f-sort">Sort by</Label>
        <Select id="f-sort" name="sort" defaultValue={values.sort ?? "price_asc"} onChange={submit}>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="seats_desc">Most seats</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="f-category">Category</Label>
        <Select id="f-category" name="category" defaultValue={values.category ?? ""} onChange={submit}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-transmission">Transmission</Label>
        <Select id="f-transmission" name="transmission" defaultValue={values.transmission ?? ""} onChange={submit}>
          <option value="">Any</option>
          {transmissions.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-seats">Seats</Label>
        <Select id="f-seats" name="seats" defaultValue={values.seats ? String(values.seats) : ""} onChange={submit}>
          <option value="">Any</option>
          {[2, 4, 5, 7].map((n) => (
            <option key={n} value={n}>
              {n}+ seats
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-fuel">Fuel type</Label>
        <Select id="f-fuel" name="fuel" defaultValue={values.fuel ?? ""} onChange={submit}>
          <option value="">Any</option>
          {fuels.map((f) => (
            <option key={f} value={f}>
              {titleCase(f)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="f-price">Max price per day</Label>
        <Select id="f-price" name="maxPrice" defaultValue={values.maxPrice ? String(values.maxPrice) : ""} onChange={submit}>
          <option value="">Any price</option>
          {priceSteps.map((p) => (
            <option key={p} value={p}>
              Up to AED {p}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex gap-2">
        <noscript>
          <Button type="submit" size="sm">
            Apply
          </Button>
        </noscript>
        {hasFilters && (
          <Link
            className="text-sm font-medium text-brand hover:underline"
            href={`/search?${new URLSearchParams(Object.entries(trip).filter((e): e is [string, string] => !!e[1])).toString()}`}
          >
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
