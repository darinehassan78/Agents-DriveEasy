import type { ReactNode } from "react";

export function DescriptionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map((it) => (
        <div key={it.term} className="flex justify-between gap-4 py-2">
          <dt className="text-muted">{it.term}</dt>
          <dd className="text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
