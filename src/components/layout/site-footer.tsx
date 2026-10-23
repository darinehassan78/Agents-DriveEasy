import Link from "next/link";
import { Container } from "@/components/ui/page-header";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <Container className="grid gap-8 py-10 sm:grid-cols-3">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">
            Car rental across the UAE. Prices in AED and include 5% VAT at checkout.
          </p>
        </div>
        <nav aria-label="Footer" className="text-sm">
          <h2 className="font-semibold">Rent</h2>
          <ul className="mt-3 space-y-2 text-muted">
            <li><Link className="hover:text-fg" href="/search">Find a car</Link></li>
            <li><Link className="hover:text-fg" href="/branches">Branches</Link></li>
            <li><Link className="hover:text-fg" href="/rentals">My rentals</Link></li>
          </ul>
        </nav>
        <div className="text-sm">
          <h2 className="font-semibold">Good to know</h2>
          <ul className="mt-3 space-y-2 text-muted">
            <li>Free cancellation until 48 hours before pick-up.</li>
            <li>Refundable security deposit held at booking.</li>
            <li>Times are shown in each branch&apos;s local time.</li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-line py-4 text-center text-xs text-muted">DriveEasy · United Arab Emirates</div>
    </footer>
  );
}
