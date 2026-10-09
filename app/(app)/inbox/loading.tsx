import { Skeleton } from '@/components/ui/Skeleton';

/** 5i's route-level skeleton language, shaped to /inbox's own layout (a title, then a couple of
 * card rows) rather than the generic full-bleed PageLoader every other route still uses — a
 * deliberately additive first real use of Skeleton, not a wholesale replace of the app's
 * existing loading pattern (see the design-decision note in ARCHITECTURE.md). */
export default function Loading() {
  return (
    <div className="space-y-5 px-4 pt-2 pb-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-[76px] w-full rounded-[18px]" />
        <Skeleton className="h-[76px] w-full rounded-[18px]" />
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-[150px] w-full rounded-[18px]" />
      </div>
    </div>
  );
}
