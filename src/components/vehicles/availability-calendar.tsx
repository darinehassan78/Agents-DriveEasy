import Link from "next/link";
import { MONTH_LABEL, addMonths, dayStatuses, daysInMonth, weekdayIndex, type Block, type DayStatus } from "@/lib/calendar";
import { cn } from "@/lib/cn";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STYLE: Record<DayStatus, string> = {
  free: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  booked: "bg-danger-soft text-danger line-through",
  past: "text-muted/60",
};
const LABEL: Record<DayStatus, string> = {
  free: "available",
  partial: "partly booked",
  booked: "booked",
  past: "past",
};

/**
 * Month grid of a vehicle's availability in its branch's time zone.
 * `monthHref(month)` builds the link for the previous/next month buttons.
 */
export function AvailabilityCalendar({
  months,
  blocks,
  timeZone,
  today,
  selected,
  prevHref,
  nextHref,
}: {
  months: string[];
  blocks: Block[];
  timeZone: string;
  today: string;
  selected?: { from: string; to: string };
  prevHref?: string;
  nextHref?: string;
}) {
  return (
    <section aria-labelledby="availability-heading" data-testid="availability-calendar">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="availability-heading" className="text-lg font-semibold">
          Availability
        </h2>
        <div className="flex gap-1">
          <NavLink href={prevHref} label="Previous month" d="M15 18l-6-6 6-6" />
          <NavLink href={nextHref} label="Next month" d="M9 6l6 6-6 6" />
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {months.map((m) => (
          <Month key={m} month={m} blocks={blocks} timeZone={timeZone} today={today} selected={selected} />
        ))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        <Legend cls={STYLE.free} label="Available" />
        <Legend cls={STYLE.partial} label="Partly booked" />
        <Legend cls={STYLE.booked} label="Booked" />
        <Legend cls="ring-2 ring-brand" label="Your dates" />
      </ul>
    </section>
  );
}

function Month({
  month,
  blocks,
  timeZone,
  today,
  selected,
}: {
  month: string;
  blocks: Block[];
  timeZone: string;
  today: string;
  selected?: { from: string; to: string };
}) {
  const days = daysInMonth(month);
  const statuses = dayStatuses(days, blocks, timeZone, today);
  const lead = weekdayIndex(days[0]);
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{MONTH_LABEL(month)}</h3>
      <table className="w-full table-fixed border-separate border-spacing-1 text-center text-sm">
        <caption className="sr-only">Availability for {MONTH_LABEL(month)}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="text-xs font-medium text-muted">
                <abbr title={d} className="no-underline">
                  {d.slice(0, 2)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk([...Array<string | null>(lead).fill(null), ...days], 7).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} />;
                const st = statuses.get(day)!;
                const inSel = selected && day >= selected.from && day <= selected.to;
                return (
                  <td
                    key={day}
                    data-date={day}
                    data-status={st}
                    className={cn("h-9 rounded-md tabular-nums", STYLE[st], inSel && "ring-2 ring-brand")}
                  >
                    <span aria-hidden="true">{Number(day.slice(8))}</span>
                    <span className="sr-only">
                      {day}: {LABEL[st]}
                      {inSel ? ", your dates" : ""}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded-sm", cls)} aria-hidden="true" />
      {label}
    </li>
  );
}

function NavLink({ href, label, d }: { href?: string; label: string; d: string }) {
  const icon = (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  const cls = "grid size-9 place-items-center rounded-md border border-line";
  if (!href)
    return (
      <span className={cn(cls, "opacity-40")} aria-disabled="true" aria-label={label}>
        {icon}
      </span>
    );
  return (
    <Link href={href} scroll={false} className={cn(cls, "hover:bg-surface-2")} aria-label={label}>
      {icon}
    </Link>
  );
}

export { addMonths };
