export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-fg" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 16l1.6-5.2A2 2 0 0 1 8.5 9.4h7a2 2 0 0 1 1.9 1.4L19 16" />
          <path d="M4 16h16v2.5a.5.5 0 0 1-.5.5H18a1 1 0 0 1-1-1v0H7v0a1 1 0 0 1-1 1H4.5a.5.5 0 0 1-.5-.5V16Z" />
          <circle cx="8" cy="16" r=".5" />
          <circle cx="16" cy="16" r=".5" />
        </svg>
      </span>
      <span className="text-lg">
        Drive<span className="text-brand">Easy</span>
      </span>
    </span>
  );
}
