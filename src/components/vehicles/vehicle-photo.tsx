import Image from "next/image";
import { cn } from "@/lib/cn";

/** Vehicle photo (public) with an illustrated fallback when none is set. */
export function VehiclePhoto({
  src,
  alt,
  className,
  priority,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
}: {
  src?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <div className={cn("relative aspect-[16/10] overflow-hidden rounded-lg bg-surface-2", className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" priority={priority} unoptimized />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted" role="img" aria-label={alt}>
          <svg viewBox="0 0 120 60" className="w-2/3 max-w-56 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 40 L14 26 Q17 20 24 19 L44 17 Q52 8 66 8 L82 9 Q92 10 100 19 L110 22 Q114 24 114 30 L114 40 Z" />
            <circle cx="32" cy="42" r="8" fill="var(--surface-2)" />
            <circle cx="92" cy="42" r="8" fill="var(--surface-2)" />
            <path d="M50 18 L58 11 M70 9 L72 18" />
          </svg>
        </div>
      )}
    </div>
  );
}
