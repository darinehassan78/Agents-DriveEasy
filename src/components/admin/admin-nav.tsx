"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/fleet", label: "Fleet" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/pricing", label: "Pricing & extras" },
  { href: "/admin/damage", label: "Damage reports" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <p className="mb-2 hidden text-xs font-semibold uppercase tracking-wide text-muted lg:block">Admin</p>
      <ul className="flex gap-1 lg:flex-col">
        {LINKS.map((l) => {
          const active = l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                  active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
