import Link from 'next/link';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { inviteJoinPath } from '@/lib/inviteLink';
import type { JoinSource } from '@/lib/inviteLink';

/**
 * 5o — a genuinely signed-out visitor's first look at an invite, before the auth wall. Built
 * from get_invite_code_preview() (anon-callable, IP rate-limited), which deliberately returns
 * only group name/avatar/member count, not market content — see that function's own migration
 * comment on why a market's title/question staying member-only was worth keeping over matching
 * 5o's mock exactly (the mock also shows two open-market rows with countdowns).
 *
 * Text wordmark only, no icon tile — see the design-decision note on brand assets staying
 * untouched for now (same rule BootSplash and the all-groups header already follow).
 */
export function SignedOutInvitePreview({
  code,
  joinSource,
  groupName,
  groupAvatarKey,
  memberCount,
}: {
  code: string;
  joinSource: JoinSource | null;
  groupName: string;
  groupAvatarKey: string | null;
  memberCount: number;
}) {
  // mode=signup, not the bare /login default: a first-time invitee's whole reason for being
  // here is to join, not to sign back into an account they don't have yet.
  const next = inviteJoinPath(code, joinSource);
  const signupHref = `/login?mode=signup&next=${encodeURIComponent(next)}`;
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="flex flex-1 flex-col px-[22px] pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+7rem)]">
      <span className="text-[16px] font-extrabold tracking-[-0.035em] text-ink">barbets</span>

      <div className="mt-[22px] flex items-center gap-[13px]">
        <GroupAvatar
          name={groupName}
          avatarKey={groupAvatarKey}
          className="h-14 w-14 text-lg"
          radiusClassName="rounded-[18px]"
          fallbackClassName="bg-rule text-signal-deep"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold tracking-[0.1em] text-signal uppercase">You&apos;re invited</span>
          <span className="mt-1 block truncate text-[22px] leading-[1.15] font-extrabold tracking-[-0.022em] text-ink">{groupName}</span>
          <span className="mt-[3px] block text-[12.5px] text-faint">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
      </div>

      <p className="mt-[22px] text-[14px] leading-[1.5] font-bold text-ink text-pretty">Make an account to see what&apos;s going on and bet.</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted text-pretty">
        Email and a password, about twenty seconds. You&apos;ll pick a name and a face for this group after. Play credits only, barbets never
        handles money.
      </p>

      <div className="mt-4 flex items-center gap-[11px] rounded-[18px] border border-hairline bg-surface p-[15px]">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-rule">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5a6373" strokeWidth={2} strokeLinecap="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-[1.45] text-muted text-pretty">
          The group only ever sees the name you choose, never your email.
        </span>
      </div>

      <div className="fixed right-0 bottom-0 left-0 flex flex-col gap-[9px] border-t border-hairline bg-surface/96 px-[18px] pt-3 pb-[calc(env(safe-area-inset-bottom)+28px)] backdrop-blur-sm">
        <Link
          href={signupHref}
          className="mx-auto w-full max-w-lg rounded-[14px] bg-signal py-[15px] text-center text-[15px] font-bold text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)]"
        >
          Create an account to join
        </Link>
        <Link href={loginHref} className="text-center text-[13.5px] font-semibold text-faint">
          Already have one? Log in
        </Link>
      </div>
    </div>
  );
}
