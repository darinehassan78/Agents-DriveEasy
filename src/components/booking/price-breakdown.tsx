import { formatAED, pluralize } from "@/lib/format";

export interface BreakdownData {
  days: number;
  dailyRateFils: number;
  rentalFils: number;
  extras: Array<{ code: string; name: string; quantity: number; pricing: "PER_DAY" | "PER_RENTAL"; unitPriceFils: number; totalFils: number }>;
  oneWayFeeFils: number;
  vatFils: number;
  vatRateBps?: number;
  totalFils: number;
  depositFils: number;
}

/** Server-computed price breakdown. Never computes money itself, only displays it. */
export function PriceBreakdown({ q, title = "Price breakdown" }: { q: BreakdownData; title?: string }) {
  const vatPct = q.vatRateBps !== undefined ? `${q.vatRateBps / 100}%` : "5%";
  return (
    <section aria-label={title} data-testid="price-breakdown">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="space-y-2 text-sm">
        <Row
          testId="price-rental"
          term={`${formatAED(q.dailyRateFils)} × ${pluralize(q.days, "day")}`}
          value={formatAED(q.rentalFils)}
        />
        {q.extras.map((e) => (
          <Row
            key={e.code}
            testId={`price-extra-${e.code.toLowerCase()}`}
            term={`${e.name}${e.quantity > 1 ? ` × ${e.quantity}` : ""}${e.pricing === "PER_DAY" ? ` (${formatAED(e.unitPriceFils)}/day)` : ""}`}
            value={formatAED(e.totalFils)}
          />
        ))}
        {q.oneWayFeeFils > 0 && <Row testId="price-one-way" term="One-way fee" value={formatAED(q.oneWayFeeFils)} />}
        <Row testId="price-vat" term={`VAT (${vatPct})`} value={formatAED(q.vatFils)} />
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3 text-base font-semibold">
          <dt>Total to pay</dt>
          <dd data-testid="price-total">{formatAED(q.totalFils)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 rounded-lg bg-surface-2 px-3 py-2">
          <dt>
            Security deposit
            <span className="block text-xs text-muted">Held on your card, released after return. Not charged.</span>
          </dt>
          <dd data-testid="price-deposit" className="font-medium">
            {formatAED(q.depositFils)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Row({ term, value, testId }: { term: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{term}</dt>
      <dd data-testid={testId} className="font-medium tabular-nums">
        {value}
      </dd>
    </div>
  );
}
