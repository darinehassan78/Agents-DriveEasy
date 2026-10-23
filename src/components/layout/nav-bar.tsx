"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface NavUser {
  name: string;
  email: string;
  isAdmin: boolean;
}

function useLinks(user: NavUser | null) {
  const links = [
    { href: "/search", label: "Find a car" },
    { href: "/branches", label: "Branches" },
  ];
  if (user) links.push({ href: "/rentals", label: "My rentals" });
  if (user?.isAdmin) links.push({ href: "/admin", label: "Admin" });
  return links;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar({ user }: { user: NavUser | null }) {
  const pathname = usePathname();
  const links = useLinks(user);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  // Close the mobile menu after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(pathname, l.href) ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg",
              "aria-[current=page]:text-brand",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto hidden items-center gap-2 md:flex">
        <AccountLinks user={user} />
      </div>

      <button
        type="button"
        className={buttonClasses("ghost", "sm", "ml-auto md:hidden")}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>

      <div
        id={menuId}
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-line bg-surface shadow-lg md:hidden"
      >
        <nav aria-label="Mobile" className="flex flex-col p-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href) ? "page" : undefined}
              className="rounded-md px-3 py-3 text-base font-medium hover:bg-surface-2 aria-[current=page]:text-brand"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
          <AccountLinks user={user} />
        </div>
      </div>
    </>
  );
}

function AccountLinks({ user }: { user: NavUser | null }) {
  if (!user) {
    return (
      <>
        <Link href="/login" className={buttonClasses("ghost", "sm")}>
          Log in
        </Link>
        <Link href="/register" className={buttonClasses("primary", "sm")}>
          Sign up
        </Link>
      </>
    );
  }
  return (
    <>
      <Link href="/profile" className={buttonClasses("ghost", "sm", "max-w-48")} title={user.email}>
        <span className="grid size-6 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-hidden="true">
          {user.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="truncate">{user.name}</span>
        <span className="sr-only">(profile)</span>
      </Link>
      <SignOutButton />
    </>
  );
}

function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={buttonClasses("secondary", "sm")}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.signOut();
          router.push("/");
          router.refresh();
        })
      }
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
