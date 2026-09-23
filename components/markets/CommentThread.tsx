import { CommentRow, type CommentRowData } from '@/components/markets/CommentRow';
import { CommentComposer } from '@/components/markets/CommentComposer';

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
      {comments.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">No comments yet. Be the first to say something.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {comments.map((c) => (
            <CommentRow key={c.id} groupId={groupId} marketId={marketId} comment={c} />
          ))}
        </div>
      )}
      <CommentComposer groupId={groupId} marketId={marketId} revealable={revealable} />
    </div>
  );
}
