import QRCode from "qrcode";

/**
 * QR code for the pick-up voucher, generated on the server as an inline SVG data
 * URL. It encodes a staff lookup link for the reservation reference (staff must
 * still be signed in as admins to see anything).
 */
export async function VoucherQr({ reference, lookupUrl }: { reference: string; lookupUrl: string }) {
  const svg = await QRCode.toString(lookupUrl, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 220 });
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- inline data URL, nothing to optimise
    <img
      src={src}
      width={220}
      height={220}
      alt={`Reservation QR code for ${reference}`}
      data-testid="voucher-qr"
      className="size-44 rounded-lg bg-white p-2 sm:size-52"
    />
  );
}
