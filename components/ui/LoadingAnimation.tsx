/** The die/coin tumble-and-hop animation used by BootSplash and every route
    loading.tsx. Plain inline SVG + CSS keyframes (see globals.css) — no
    external fetch, no iframe, so it's always instant and self-contained. */
export function LoadingAnimation({ label = 'LOADING' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-[26px]">
      <div className="animate-die-hop">
        <div className="h-[88px] w-[88px] animate-die-tumble">
          <svg width="88" height="88" viewBox="0 0 120 120" aria-hidden="true">
            <rect x="2" y="2" width="116" height="116" rx="26" fill="#33291E" />
            <circle cx="27" cy="27" r="8" fill="#D8A55C" />
            <circle cx="93" cy="93" r="8" fill="#D8A55C" />
            <text
              x="60"
              y="80"
              textAnchor="middle"
              fontFamily="var(--font-bricolage), sans-serif"
              fontWeight="800"
              fontSize="56"
              fill="#FBF6EA"
            >
              B
            </text>
          </svg>
        </div>
      </div>
      <div className="h-3 w-[76px] rounded-full bg-[#33291E] animate-die-shadow" />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[15px] font-bold tracking-[4px] text-[#8A7E6C]">{label}</span>
        <span className="flex gap-[5px]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#D8A55C] animate-dot-blink" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#D8A55C] animate-dot-blink [animation-delay:0.2s]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#D8A55C] animate-dot-blink [animation-delay:0.4s]" />
        </span>
      </div>
    </div>
  );
}
