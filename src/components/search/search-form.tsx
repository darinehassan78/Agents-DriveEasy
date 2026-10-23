"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export interface BranchOption {
  id: string;
  name: string;
  city: string;
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/**
 * Trip search: pick-up/return branch, dates and times. Submits as a GET to
 * `action` so it works without JavaScript; extra hidden params (filters) are kept.
 */
export function SearchForm({
  branches,
  initial,
  action = "/search",
  minDate,
  layout = "stacked",
  submitLabel = "Search cars",
  hidden,
}: {
  branches: BranchOption[];
  initial: { pickupBranch?: string; returnBranch?: string; pickupAt: string; returnAt: string };
  action?: string;
  /** Earliest selectable date (YYYY-MM-DD) at the branch. */
  minDate: string;
  layout?: "stacked" | "bar";
  submitLabel?: string;
  hidden?: Record<string, string | undefined>;
}) {
  const id = useId();
  const router = useRouter();
  const [pickupBranch, setPickupBranch] = useState(initial.pickupBranch ?? branches[0]?.id ?? "");
  const [differentReturn, setDifferentReturn] = useState(
    !!initial.returnBranch && initial.returnBranch !== initial.pickupBranch,
  );
  const [returnBranch, setReturnBranch] = useState(initial.returnBranch ?? pickupBranch);
  const [pickupDate, setPickupDate] = useState(initial.pickupAt.slice(0, 10));
  const [pickupTime, setPickupTime] = useState(initial.pickupAt.slice(11, 16));
  const [returnDate, setReturnDate] = useState(initial.returnAt.slice(0, 10));
  const [returnTime, setReturnTime] = useState(initial.returnAt.slice(11, 16));
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pickupAt = `${pickupDate}T${pickupTime}`;
    const returnAt = `${returnDate}T${returnTime}`;
    if (!pickupBranch) return setError("Choose a pick-up branch.");
    if (!pickupDate || !returnDate) return setError("Choose pick-up and return dates.");
    if (returnAt <= pickupAt) return setError("Return must be after pick-up.");
    setError(null);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden ?? {})) if (v) q.set(k, v);
    q.set("pickupBranch", pickupBranch);
    if (differentReturn && returnBranch && returnBranch !== pickupBranch) q.set("returnBranch", returnBranch);
    q.set("pickupAt", pickupAt);
    q.set("returnAt", returnAt);
    router.push(`${action}?${q.toString()}`);
  }

  const bar = layout === "bar";
  const branchOptions = branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.name} · {b.city}
    </option>
  ));

  return (
    <form
      action={action}
      method="get"
      onSubmit={onSubmit}
      noValidate
      aria-label="Search cars"
      data-testid="search-form"
      className={cn("grid gap-4", bar ? "lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end" : "")}
    >
      {Object.entries(hidden ?? {}).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid gap-3">
        <div>
          <Label htmlFor={`${id}-pb`}>Pick-up branch</Label>
          <Select
            id={`${id}-pb`}
            name="pickupBranch"
            value={pickupBranch}
            onChange={(e) => setPickupBranch(e.target.value)}
            required
          >
            {branchOptions}
          </Select>
        </div>
        <Checkbox
          label="Return to a different branch"
          checked={differentReturn}
          onChange={(e) => {
            setDifferentReturn(e.target.checked);
            if (e.target.checked && returnBranch === pickupBranch) {
              setReturnBranch(branches.find((b) => b.id !== pickupBranch)?.id ?? pickupBranch);
            }
          }}
        />
        {differentReturn && (
          <div>
            <Label htmlFor={`${id}-rb`}>Return branch</Label>
            <Select
              id={`${id}-rb`}
              name="returnBranch"
              value={returnBranch}
              onChange={(e) => setReturnBranch(e.target.value)}
            >
              {branchOptions}
            </Select>
            <p className="mt-1 text-xs text-muted">A one-way fee applies when you return to a different branch.</p>
          </div>
        )}
      </div>

      <fieldset className="grid grid-cols-[1fr_7rem] gap-2">
        <legend className="mb-1.5 text-sm font-medium">Pick-up</legend>
        <div>
          <label htmlFor={`${id}-pd`} className="sr-only">
            Pick-up date
          </label>
          <Input
            id={`${id}-pd`}
            type="date"
            min={minDate}
            value={pickupDate}
            onChange={(e) => {
              setPickupDate(e.target.value);
              if (e.target.value && returnDate < e.target.value) setReturnDate(e.target.value);
            }}
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-pt`} className="sr-only">
            Pick-up time
          </label>
          <Select id={`${id}-pt`} value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}>
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <input type="hidden" name="pickupAt" value={`${pickupDate}T${pickupTime}`} />
      </fieldset>

      <fieldset className="grid grid-cols-[1fr_7rem] gap-2">
        <legend className="mb-1.5 text-sm font-medium">Return</legend>
        <div>
          <label htmlFor={`${id}-rd`} className="sr-only">
            Return date
          </label>
          <Input
            id={`${id}-rd`}
            type="date"
            min={pickupDate || minDate}
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-rt`} className="sr-only">
            Return time
          </label>
          <Select id={`${id}-rt`} value={returnTime} onChange={(e) => setReturnTime(e.target.value)}>
            {TIMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <input type="hidden" name="returnAt" value={`${returnDate}T${returnTime}`} />
      </fieldset>

      <div className={cn(bar ? "lg:pb-0" : "")}>
        <Button type="submit" size="lg" className="w-full" data-testid="search-submit">
          {submitLabel}
        </Button>
      </div>
      {error && (
        <p role="alert" className={cn("text-sm text-danger", bar && "lg:col-span-4")}>
          {error}
        </p>
      )}
      <p className={cn("text-xs text-muted", bar && "lg:col-span-4")}>Times are local to each branch.</p>
    </form>
  );
}
