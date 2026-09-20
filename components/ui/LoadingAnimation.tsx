/** Route loading and in-page busy states (DESIGN 5i): three-dot pulse on canvas. */
export function LoadingAnimation({ label }: { label?: string } = {}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 animate-bb-pulse rounded-full bg-signal" style={{ animationDelay: '0ms' }} />
        <span className="h-2.5 w-2.5 animate-bb-pulse rounded-full bg-signal" style={{ animationDelay: '160ms' }} />
        <span className="h-2.5 w-2.5 animate-bb-pulse rounded-full bg-signal" style={{ animationDelay: '320ms' }} />
      </div>
      {label ? <span className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span> : null}
    </div>
  );
}
