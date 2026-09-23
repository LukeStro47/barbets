'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/lib/inviteCode';
import { inviteCodeFromText, inviteJoinPath } from '@/lib/inviteLink';
import { cn } from '@/lib/cn';

const CODE_LENGTH = INVITE_CODE_LENGTH;

/** The two grounds this sits on: the groups hub's dark invite card, and the pre-auth /join
 *  entry point on paper. Only colours differ, so the 4-char/paste/advance logic stays in one
 *  place rather than being forked into a near-identical paper component. */
const TONE = {
  dark: {
    box: 'border-white/20 bg-white/[0.06] text-white',
    boxActive: 'border-on-ink shadow-[0_0_0_3px_rgba(107,140,255,0.25)]',
    paste: 'border-white/20 text-on-ink',
    submit: 'bg-signal text-white disabled:bg-white/10 disabled:text-white/40',
  },
  paper: {
    box: 'border-hairline bg-surface text-ink',
    boxActive: 'border-signal shadow-[0_0_0_3px_rgba(45,85,245,0.18)]',
    paste: 'border-hairline text-muted',
    submit: 'bg-signal text-white shadow-[var(--elevation-cta)] disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none',
  },
} as const;

/** Four mono uppercase boxes (DESIGN). The real invite code is exactly 4 characters
 *  (_generate_invite_code), so this matches the format rather than a generic six-box OTP.
 *  A pasted code that still carries the retired "BB-" prefix is normalized away. */
export function InviteCodeBoxes({ tone = 'dark' }: { tone?: keyof typeof TONE }) {
  const toneClasses = TONE[tone];
  const router = useRouter();
  const [chars, setChars] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [focused, setFocused] = useState<number | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const code = chars.join('');
  const ready = code.length === CODE_LENGTH;

  function setChar(i: number, value: string) {
    const clean = value.slice(-1).toUpperCase().replace(/[^A-Z0-9]/g, '');
    setChars((prev) => {
      const next = [...prev];
      next[i] = clean;
      return next;
    });
    if (clean && i < CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      // A pasted invite *link* (a /join/XXXX URL, e.g. the one InvitePill/OpenAppPrompt copy)
      // has to yield the code, not the first four letters of "https".
      const clean = inviteCodeFromText(text) ?? normalizeInviteCode(text);
      if (!clean) return;
      setChars(Array.from({ length: CODE_LENGTH }, (_, i) => clean[i] ?? ''));
      inputRefs.current[Math.min(clean.length, CODE_LENGTH - 1)]?.focus();
    } catch {
      // Clipboard read denied/unavailable — the boxes still work by hand.
    }
  }

  function join() {
    if (!ready) return;
    // Tagged as a typed code so join_group's lifecycle row can tell it apart from a scanned QR
    // (`src=qr`) or a bare shared link (no tag). See lib/inviteLink.ts.
    router.push(inviteJoinPath(code, 'code'));
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        {chars.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            value={c}
            onChange={(e) => setChar(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={() => setFocused(i)}
            onBlur={() => setFocused(null)}
            inputMode="text"
            autoCapitalize="characters"
            maxLength={1}
            aria-label={`Character ${i + 1} of invite code`}
            className={cn(
              'h-[48px] w-0 min-w-0 flex-1 rounded-[14px] border-[1.5px] text-center font-mono text-[18px] font-semibold uppercase tracking-[0.04em] outline-none',
              toneClasses.box,
              focused === i && toneClasses.boxActive
            )}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePaste}
          className={cn(
            'shrink-0 rounded-[14px] border-[1.5px] px-4 py-[11px] text-[13px] font-bold',
            toneClasses.paste
          )}
        >
          Paste
        </button>
        <button
          type="button"
          onClick={join}
          disabled={!ready}
          className={cn(
            'flex-1 rounded-[14px] py-[11px] text-center text-[15px] font-bold',
            toneClasses.submit
          )}
        >
          Join group
        </button>
      </div>
    </div>
  );
}
