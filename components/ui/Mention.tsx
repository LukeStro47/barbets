import { cn } from '@/lib/cn';
import type { TitleBadge } from '@/lib/titles';

/** An "@nickname" mention, italicized everywhere it appears so it always reads as a reference to a person rather than plain text. Optional `titles` renders small emoji flair after the name — persistent Hall of Fame badges, not tied to any one screen. */
export function Mention({ nickname, titles, className }: { nickname: string; titles?: TitleBadge[]; className?: string }) {
  return (
    <span className={cn('italic', className)}>
      @{nickname}
      {titles?.map((t) => (
        <span key={t.key} title={t.label} className="ml-0.5 not-italic">
          {t.emoji}
        </span>
      ))}
    </span>
  );
}
