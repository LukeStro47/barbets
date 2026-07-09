import { cn } from '@/lib/cn';

/** An "@nickname" mention, italicized everywhere it appears so it always reads as a reference to a person rather than plain text. */
export function Mention({ nickname, className }: { nickname: string; className?: string }) {
  return <span className={cn('italic', className)}>@{nickname}</span>;
}
