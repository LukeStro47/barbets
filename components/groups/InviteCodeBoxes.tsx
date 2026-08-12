'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/lib/inviteCode';

const CODE_LENGTH = INVITE_CODE_LENGTH;

/** The two grounds this sits on: the groups hub's dark invite card, and the pre-auth /join
 *  entry point on paper. Only colours differ, so the 4-char/paste/advance logic stays in one
 *  place rather than being forked into a near-identical paper component. */
const TONE = {
  dark: {
    box: 'border-white/[0.16] bg-white/[0.06] text-paper-white focus:border-honey-300/70 focus:bg-white/[0.09]',
    paste: 'border-white/20 text-honey-200',
    submit: 'bg-honey-500 text-espresso-950 disabled:opacity-45',
  },
  paper: {
    box: 'border-espresso-200 bg-paper-white text-espresso-900 focus:border-honey-500 focus:bg-honey-50',
    paste: 'border-espresso-200 text-espresso-700',
    submit: 'bg-honey-500 text-espresso-900 disabled:bg-espresso-100 disabled:text-espresso-400',
  },
} as const;

/** Four boxes, not the mock's six — the real invite code (supabase/migrations'
 * _generate_invite_code) is exactly 4 characters, so this matches the actual format rather than
 * the mock's generic box count. A pasted code that still carries the retired "BB-" prefix is
 * normalized away by normalizeInviteCode rather than filling the boxes with "BB-X". */
export function InviteCodeBoxes({ tone = 'dark' }: { tone?: keyof typeof TONE }) {
  const toneClasses = TONE[tone];
  const router = useRouter();
  const [chars, setChars] = useState<string[]>(Array(CODE_LENGTH).fill(''));
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
      const clean = normalizeInviteCode(text);
      if (!clean) return;
      setChars(Array.from({ length: CODE_LENGTH }, (_, i) => clean[i] ?? ''));
      inputRefs.current[Math.min(clean.length, CODE_LENGTH - 1)]?.focus();
    } catch {
      // Clipboard read denied/unavailable — the boxes still work by hand.
    }
  }

  function join() {
    if (!ready) return;
    router.push(`/join/${code}`);
  }

  return (
    <div className="space-y-2.5">
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
            inputMode="text"
            autoCapitalize="characters"
            maxLength={1}
            className={`h-[46px] w-0 min-w-0 flex-1 rounded-xl border-[1.5px] text-center font-display text-lg font-extrabold focus:outline-none ${toneClasses.box}`}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePaste}
          className={`shrink-0 rounded-full border-[1.5px] px-4 py-[9px] text-[13px] font-bold ${toneClasses.paste}`}
        >
          Paste
        </button>
        <button
          type="button"
          onClick={join}
          disabled={!ready}
          className={`flex-1 rounded-full py-2.5 text-center text-sm font-extrabold ${toneClasses.submit}`}
        >
          Join group
        </button>
      </div>
    </div>
  );
}
