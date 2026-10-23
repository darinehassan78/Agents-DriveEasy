import { titleCase } from "@/lib/format";

export interface VehicleSpecsData {
  transmission: string;
  fuelType: string;
  seats: number;
  doors?: number;
  luggage?: number;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  seats: "M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 20v-2a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  gear: "M6 4v16M18 4v8H6M12 4v16",
  fuel: "M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M14 9h2a2 2 0 0 1 2 2v5a1 1 0 0 0 2 0V8l-3-3M7 8h4",
  bag: "M6 7h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  door: "M5 20V5a1 1 0 0 1 1-1h9l4 4v12M3 20h18M14 12h1",
};

export function VehicleSpecs({ v, compact }: { v: VehicleSpecsData; compact?: boolean }) {
  const items = [
    { icon: ICONS.seats, label: `${v.seats} seats` },
    { icon: ICONS.gear, label: titleCase(v.transmission) },
    { icon: ICONS.fuel, label: titleCase(v.fuelType) },
    ...(!compact && v.doors ? [{ icon: ICONS.door, label: `${v.doors} doors` }] : []),
    ...(v.luggage !== undefined ? [{ icon: ICONS.bag, label: `${v.luggage} bags` }] : []),
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <Icon d={it.icon} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
