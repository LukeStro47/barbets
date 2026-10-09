import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { BrandLockup } from '@/components/ui/BrandMark';
import { FooterButton, StickyFooter } from '@/components/ui/Screen';
import { formatGroupAge } from '@/lib/formatRelativeTime';
import { inviteJoinPath } from '@/lib/inviteLink';
import type { JoinSource } from '@/lib/inviteLink';

/**
 * 5o, a signed-out visitor's first look at an invite, before the auth wall. Built from
 * get_invite_code_preview() (anon-callable, IP rate-limited), which returns the group's name,
 * avatar, member count and age, and never market content: a market's question stays member-only
 * (see that function's migration). So where the mock lists two real open markets, this draws the
 * list's blank placeholder rows under the same fade: the shape of "there's a conversation in
 * here" without any of its words. "Marcus invited you" is also out; codes aren't per-person, so
 * nothing records who shared this one.
 */
export function SignedOutInvitePreview({
  code,
  joinSource,
  groupName,
  groupAvatarKey,
  memberCount,
  createdAt,
}: {
  code: string;
  joinSource: JoinSource | null;
  groupName: string;
  groupAvatarKey: string | null;
  memberCount: number;
  createdAt: string | null;
}) {
  // mode=signup, not the bare /login default: a first-time invitee's whole reason for being
  // here is to join, not to sign back into an account they don't have yet.
  const next = inviteJoinPath(code, joinSource);
  const signupHref = `/login?mode=signup&next=${encodeURIComponent(next)}`;
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto w-full max-w-[430px] px-[22px] pt-[calc(env(safe-area-inset-top)+58px)] pb-[160px]">
      <BrandLockup tile={24} word={16} />

      <div className="mt-[22px] flex items-center gap-[13px]">
        <GroupAvatar
          name={groupName}
          avatarKey={groupAvatarKey}
          className="h-14 w-14 text-lg"
          radiusClassName="rounded-[18px]"
          fallbackClassName="bg-tile text-signal"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold tracking-[0.1em] text-signal uppercase">You&apos;re invited</span>
          <span className="mt-1 block text-[22px] leading-[1.15] font-extrabold tracking-[-0.022em] text-balance text-ink">{groupName}</span>
          <span className="mt-[3px] block text-[12.5px] text-faint">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
            {createdAt && ` · running ${formatGroupAge(createdAt)}`}
          </span>
        </span>
      </div>

      <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">What they&apos;re arguing about</p>
      <div aria-hidden className="relative mt-[9px] flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-[15px] py-[13px]">
            <span className="h-3.5 flex-1 rounded-[5px] bg-rule" style={{ maxWidth: `${[78, 62, 70][i]}%` }} />
            <span className="ml-auto h-3.5 w-[42px] shrink-0 rounded-[5px] bg-rule" />
          </div>
        ))}
        <span className="absolute inset-x-0 bottom-0 h-[110px] bg-gradient-to-b from-canvas/0 to-canvas to-[78%]" />
      </div>

      <p className="mt-4 text-[14px] leading-[1.5] font-bold text-ink text-pretty">Make an account to see them and bet.</p>
      <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted text-pretty">
        Email and a password, about twenty seconds. You&apos;ll pick a name and a face for this group after. Play credits only, barbets never
        handles money.
      </p>

      <div className="mt-4 flex items-center gap-[11px] rounded-[18px] border border-hairline bg-surface px-[15px] py-3.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-tile text-muted">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-[1.45] text-muted text-pretty">
          The group only ever sees the name you choose, never your email.
        </span>
      </div>

      <StickyFooter>
        <FooterButton href={signupHref}>Create an account to join</FooterButton>
        <a href={loginHref} className="pt-1 text-center text-[13.5px] font-semibold text-faint">
          Already have one? Log in
        </a>
      </StickyFooter>
    </div>
  );
}
