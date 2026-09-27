import { CommentRow, type CommentRowData } from '@/components/markets/CommentRow';
import { CommentComposer, type ComposerUser } from '@/components/markets/CommentComposer';
import { BrandTile } from '@/components/ui/BrandMark';

/**
 * 4e: the sealed-banter note, the thread, a system line for the endorsement, and the composer
 * pinned to the bottom. "Show the group your bet" hangs under the viewer's own latest comment
 * (not the composer), and attaches the bet to that comment.
 */
export function CommentThread({
  groupId,
  marketId,
  comments,
  revealable,
  endorsedBy,
  me,
}: {
  groupId: string;
  marketId: string;
  comments: CommentRowData[];
  revealable?: { label: string; amount: number } | null;
  /** The endorser's nickname, for the "@marcus endorsed this market" system line. */
  endorsedBy?: string | null;
  me: ComposerUser;
}) {
  const myLatestId = [...comments].reverse().find((c) => c.isMine && c.revealedAmount == null)?.id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 rounded-[14px] border border-hairline bg-tile px-3.5 py-[11px]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <p className="text-[12px] leading-[1.45] text-muted text-pretty">
          Banter is public. Sides and stakes stay sealed until close, so talk your book at your own risk.
        </p>
      </div>

      {endorsedBy && (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-hairline bg-surface px-3.5 py-[11px]">
          <BrandTile size={17} />
          <p className="text-[12px] leading-[1.45] text-faint">@{endorsedBy} endorsed this market</p>
        </div>
      )}

      {comments.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">No comments yet. Be the first to say something.</p>
      ) : (
        comments.map((c) => (
          <CommentRow
            key={c.id}
            groupId={groupId}
            marketId={marketId}
            comment={c}
            revealable={c.id === myLatestId ? revealable : null}
          />
        ))
      )}

      <CommentComposer groupId={groupId} marketId={marketId} me={me} />
    </div>
  );
}
