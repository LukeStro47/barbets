'use client';

import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** Must match the Supabase project's actual Authentication > Emails > "OTP Length" setting
 *  (mirrored for local dev in supabase/config.toml's `[auth.email] otp_length`) - there's no
 *  runtime way to ask Supabase how long the code it just emailed is, so this is a hardcoded
 *  assumption, not a default. If that setting is ever changed, the code entered here will never
 *  reach this many digits (or will fill these boxes with leftover digits from a shorter code),
 *  and this constant is what needs updating to match. */
export const CONFIRM_CODE_LENGTH = 6;

/** Digit-per-box entry for the sign-up confirmation code (DESIGN 5f). Mono figures, 1.5px signal
 *  border + glow on the active box. Same shape as InviteCodeBoxes so a code from email reads the
 *  same way a join code does. Writes the joined value into a hidden `token` input and reports
 *  readiness via `onChange` so the submit button can disable until all digits are in. */
export function ConfirmCodeBoxes({ onChange }: { onChange?: (code: string) => void }) {
  const [chars, setChars] = useState<string[]>(Array(CONFIRM_CODE_LENGTH).fill(''));
  const [focused, setFocused] = useState<number | null>(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function setChar(i: number, value: string) {
    const clean = value.slice(-1).replace(/[^0-9]/g, '');
    setChars((prev) => {
      const next = [...prev];
      next[i] = clean;
      onChange?.(next.join(''));
      return next;
    });
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
    <div className="space-y-2.5">
      <input type="hidden" name="token" value={chars.join('')} />
      <div className="flex gap-1.5">
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
            inputMode="numeric"
            maxLength={1}
            autoFocus={i === 0}
            aria-label={`Digit ${i + 1} of confirmation code`}
            className={cn(
              'h-[48px] w-0 min-w-0 flex-1 rounded-[14px] border-[1.5px] bg-surface text-center font-mono text-[18px] font-semibold text-ink outline-none',
              focused === i
                ? 'border-signal shadow-[0_0_0_3px_rgba(45,85,245,0.18)]'
                : 'border-hairline'
            )}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={handlePaste}
        className="shrink-0 rounded-[14px] border border-hairline bg-surface px-4 py-[9px] text-[13px] font-bold text-muted"
      >
        Paste
      </button>
    </div>
  );
}
