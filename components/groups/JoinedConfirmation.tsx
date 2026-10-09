'use client';

import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { FooterButton, StickyFooter } from '@/components/ui/Screen';
import { formatTokens, numberWord } from '@/lib/formatNumber';

function windowPhrase(hours: number): string {
  if (hours === 1) return 'an hour';
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours % 24 === 0) return hours === 24 ? 'a day' : `${hours / 24} days`;
  return `${hours} hours`;
}

function steps(resolutionWindowHours: number) {
  return [
    { title: 'Stake blind', body: 'No odds while a market is open. You back a side without knowing the crowd.' },
    { title: 'The pool sets the price', body: 'When betting closes, the split becomes the odds.' },
    {
      title: 'Anyone calls it',
      body: `Any of you can propose the result, and the group has ${windowPhrase(resolutionWindowHours)} to object.`,
    },
  ];
}

/** 5g's footer: "See the five open markets", with the real count. */
function ctaLabel(openCount: number): string {
  if (openCount === 0) return 'Go to the group';
  if (openCount === 1) return 'See the one open market';
  return `See the ${numberWord(openCount)} open markets`;
}

/**
 * 5g's "you're in" confirmation, shown once right after a first-time join succeeds — replaces
 * the old fragmented pair (a Modal that only appeared when the owner had set a custom
 * group_settings.join_message, plus OpenAppPrompt's unrelated mobile-browser install nudge) with
 * one real screen every new member sees. `joinMessage` (the owner's optional custom welcome
 * text) renders as its own card above the three-things explainer when set, rather than a
 * separate modal on top of this one — it's additional context about *this* group, not a
 * competing "welcome" moment.
 */
export function JoinedConfirmation({
  groupName,
  groupAvatarKey,
  balance,
  joinMessage,
  openCount,
  resolutionWindowHours,
  onContinue,
}: {
  groupName: string;
  groupAvatarKey: string | null;
  balance: number;
  joinMessage?: string | null;
  openCount: number;
  resolutionWindowHours: number;
  onContinue: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[430px] px-[22px] pt-[calc(env(safe-area-inset-top)+80px)] pb-[140px]">
      <div className="rounded-[24px] bg-ink p-[22px]">
        <div className="flex items-center gap-[11px]">
          <GroupAvatar name={groupName} avatarKey={groupAvatarKey} className="h-9 w-9 text-xs" radiusClassName="rounded-[12px]" fallbackClassName="bg-white/10 text-on-ink" />
          <span className="text-[14.5px] font-bold text-surface">{groupName}</span>
        </div>
        <p className="mt-[18px] text-[11px] font-bold tracking-[0.1em] text-faint uppercase">Free to bet</p>
        <p className="mt-[5px] font-mono text-[44px] leading-none font-semibold tracking-[-0.03em] text-surface">{formatTokens(balance)}</p>
        <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/[0.13]">
          <span aria-hidden className="absolute inset-0 origin-left animate-bb-settle bg-signal" />
          <span aria-hidden className="absolute inset-0 origin-right animate-bb-settle-b bg-surface" />
        </div>
      </div>

      {joinMessage && (
        <div className="mt-4 rounded-[18px] border border-hairline bg-surface p-4">
          <p className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">A note from the group</p>
          <p className="mt-1.5 text-[13.5px] leading-[1.5] whitespace-pre-wrap text-muted">{joinMessage}</p>
        </div>
      )}

      <h1 className="mt-6 text-[25px] leading-[1.15] font-extrabold tracking-[-0.022em] text-pretty text-ink">
        Three things and you're away
      </h1>

      <div className="mt-3.5 flex flex-col gap-[9px]">
        {steps(resolutionWindowHours).map((step, i) => (
          <div key={step.title} className="flex gap-3 rounded-[18px] border border-hairline bg-surface p-[15px]">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-ink font-mono text-[11px] font-semibold text-surface">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold text-ink">{step.title}</span>
              <span className="mt-[3px] block text-[12.5px] leading-[1.45] text-muted text-pretty">{step.body}</span>
            </span>
          </div>
        ))}
      </div>

      <StickyFooter>
        <FooterButton onClick={onContinue}>{ctaLabel(openCount)}</FooterButton>
      </StickyFooter>
    </div>
  );
}
