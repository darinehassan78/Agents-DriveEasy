import { Badge, type Tone } from "@/components/ui/badge";

const RES: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Awaiting payment", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  PICKED_UP: { label: "On rent", tone: "info" },
  RETURNED: { label: "Returned", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

const PAY: Record<string, { label: string; tone: Tone }> = {
  UNPAID: { label: "Unpaid", tone: "warning" },
  PENDING: { label: "Payment pending", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Payment failed", tone: "danger" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "info" },
  REFUNDED: { label: "Refunded", tone: "info" },
};

const DEP: Record<string, { label: string; tone: Tone }> = {
  NONE: { label: "No deposit yet", tone: "neutral" },
  PENDING: { label: "Deposit pending", tone: "warning" },
  HELD: { label: "Deposit held", tone: "info" },
  RELEASED: { label: "Deposit released", tone: "success" },
  CAPTURED: { label: "Deposit captured", tone: "danger" },
  FAILED: { label: "Deposit failed", tone: "danger" },
};

const VEH: Record<string, { label: string; tone: Tone }> = {
  AVAILABLE: { label: "Available", tone: "success" },
  RESERVED: { label: "Reserved", tone: "warning" },
  ON_RENT: { label: "On rent", tone: "info" },
  MAINTENANCE: { label: "Maintenance", tone: "accent" },
  RETIRED: { label: "Retired", tone: "neutral" },
};

function make(map: Record<string, { label: string; tone: Tone }>) {
  return function StatusBadge({ status }: { status: string }) {
    const s = map[status] ?? { label: status, tone: "neutral" as Tone };
    return <Badge tone={s.tone}>{s.label}</Badge>;
  };
}

export const ReservationStatusBadge = make(RES);
export const PaymentStatusBadge = make(PAY);
export const DepositStatusBadge = make(DEP);
export const VehicleStatusBadge = make(VEH);
export const reservationStatusLabel = (s: string) => RES[s]?.label ?? s;
