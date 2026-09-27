'use client';

import { useRef, useState } from 'react';

/** Must match the Supabase project's actual Authentication > Emails > "OTP Length" setting
 *  (mirrored for local dev in supabase/config.toml's `[auth.email] otp_length`) - there's no
 *  runtime way to ask Supabase how long the code it just emailed is, so this is a hardcoded
 *  assumption, not a default. If that setting is ever changed, the code entered here will never
 *  reach this many digits (or will fill these boxes with leftover digits from a shorter code),
 *  and this constant is what needs updating to match. */
export const CONFIRM_CODE_LENGTH = 6;

/** Digit-per-box entry for the sign-up confirmation code, the same shape as InviteCodeBoxes
 *  (components/groups/InviteCodeBoxes.tsx) so a code someone's typing in from an email reads the
 *  same way a join code does elsewhere in the app. Unlike InviteCodeBoxes this doesn't own its
 *  own submit - it sits inside confirmSignup's <form action>, so it writes the joined value into
 *  a hidden `token` input and reports readiness upward via `onChange` so the real submit button
 *  can disable itself until all digits are in. */
export function ConfirmCodeBoxes({ onChange }: { onChange?: (code: string) => void }) {
  const [chars, setChars] = useState<string[]>(Array(CONFIRM_CODE_LENGTH).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function setChar(i: number, value: string) {
    const clean = value.slice(-1).replace(/[^0-9]/g, '');
    // Compute `next` and call onChange outside the setChars updater, same as handlePaste below —
    // calling a parent setState from inside a useState updater runs it during this component's
    // own render/commit, which is what "Cannot update a component while rendering a different
    // component" was flagging.
    const next = [...chars];
    next[i] = clean;
    setChars(next);
    onChange?.(next.join(''));
    if (clean && i < CONFIRM_CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !chars[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      const clean = text.replace(/[^0-9]/g, '').slice(0, CONFIRM_CODE_LENGTH);
      if (!clean) return;
      const next = Array.from({ length: CONFIRM_CODE_LENGTH }, (_, i) => clean[i] ?? '');
      setChars(next);
      onChange?.(next.join(''));
      inputRefs.current[Math.min(clean.length, CONFIRM_CODE_LENGTH - 1)]?.focus();
    } catch {
      // Clipboard read denied/unavailable — the boxes still work by hand.
    }
  }

  return (
    <div>
      <input type="hidden" name="token" value={chars.join('')} />
      <div className="flex gap-[9px]">
        {chars.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            value={c}
            onChange={(e) => setChar(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            aria-label={`Digit ${i + 1} of confirmation code`}
            onPaste={(e) => {
              e.preventDefault();
              void handlePaste();
            }}
            className="h-16 w-0 min-w-0 flex-1 rounded-[15px] border border-hairline bg-surface text-center font-mono text-[26px] font-semibold text-ink caret-signal focus:border-[1.5px] focus:border-signal focus:shadow-[0_0_0_4px_rgba(45,85,245,0.08)] focus:outline-none"
          />
        ))}
      </div>
    </div>
  );
}
