'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const CODE_LENGTH = 4;

/** Four boxes, not the mock's six — the real invite code (supabase/migrations' create_group)
 * is a literal "BB-" prefix plus exactly 4 characters, so this matches the actual format
 * rather than the mock's generic box count. "BB-" is prepended automatically; the boxes only
 * ever hold the 4 significant characters. */
export function InviteCodeBoxes() {
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
      const clean = text
        .toUpperCase()
        .replace(/^BB-?/, '')
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, CODE_LENGTH);
      if (!clean) return;
      setChars(Array.from({ length: CODE_LENGTH }, (_, i) => clean[i] ?? ''));
      inputRefs.current[Math.min(clean.length, CODE_LENGTH - 1)]?.focus();
    } catch {
      // Clipboard read denied/unavailable — the boxes still work by hand.
    }
  }

  function join() {
    if (!ready) return;
    router.push(`/join/BB-${code}`);
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
            className="h-[46px] w-0 min-w-0 flex-1 rounded-xl border-[1.5px] border-white/[0.16] bg-white/[0.06] text-center font-display text-lg font-extrabold text-paper-white focus:border-honey-300/70 focus:bg-white/[0.09] focus:outline-none"
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePaste}
          className="shrink-0 rounded-full border-[1.5px] border-white/20 px-4 py-[9px] text-[13px] font-bold text-honey-200"
        >
          Paste
        </button>
        <button
          type="button"
          onClick={join}
          disabled={!ready}
          className="flex-1 rounded-full bg-honey-500 py-2.5 text-center text-sm font-extrabold text-espresso-950 disabled:opacity-45"
        >
          Join group
        </button>
      </div>
    </div>
  );
}
