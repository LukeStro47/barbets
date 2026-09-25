import { CommentRow, type CommentRowData } from '@/components/markets/CommentRow';
import { CommentComposer } from '@/components/markets/CommentComposer';
import { LockIcon } from '@/components/ui/icons';

export function CommentThread({
  groupId,
  marketId,
  comments,
  revealable,
}: {
  groupId: string;
  marketId: string;
  comments: CommentRowData[];
  revealable?: { label: string; amount: number } | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-[10px] rounded-[14px] border border-hairline bg-rule px-[14px] py-[11px]">
        <LockIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
        <p className="text-[12px] leading-[1.45] text-muted text-pretty">
          Banter is public. Sides and stakes stay sealed until close, so talk your book at your own risk.
        </p>
      </div>

      {comments.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">No comments yet. Be the first to say something.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {comments.map((c) => (
            <CommentRow key={c.id} groupId={groupId} marketId={marketId} comment={c} />
          ))}
        </div>
      )}
      <CommentComposer groupId={groupId} marketId={marketId} revealable={revealable} />
    </div>
  );
}
