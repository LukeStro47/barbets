'use client';

import { useRef, useState } from 'react';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/lib/inviteCode';
import { inviteCodeFromText } from '@/lib/inviteLink';
import { cn } from '@/lib/cn';

/**
 * 5f's four boxes: 60px, 15px radius, mono 24. Four, not six: the real invite code
 * (_generate_invite_code) is exactly 4 characters. Controlled from above so the screen's own
 * footer button can submit, and so a wrong code (5p) can ring every box in alert red. A pasted
 * invite *link* yields its code, and a code still carrying the retired "BB-" prefix is normalized.
 */
export function InviteCodeBoxes({ onChange, invalid = false }: { onChange: (code: string) => void; invalid?: boolean }) {
  const [chars, setChars] = useState<string[]>(Array(INVITE_CODE_LENGTH).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function commit(next: string[]) {
    setChars(next);
    onChange(next.join(''));
  }

  function setChar(i: number, value: string) {
    const clean = value.slice(-1).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const next = [...chars];
    next[i] = clean;
    commit(next);
    if (clean && i < INVITE_CODE_LENGTH - 1) inputRefs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !chars[i] && i > 0) inputRefs.current[i - 1]?.focus();
  }

  function handlePaste(text: string) {
    const clean = inviteCodeFromText(text) ?? normalizeInviteCode(text);
    if (!clean) return;
    commit(Array.from({ length: INVITE_CODE_LENGTH }, (_, i) => clean[i] ?? ''));
    inputRefs.current[Math.min(clean.length, INVITE_CODE_LENGTH - 1)]?.focus();
  }

  return (
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
          onPaste={(e) => {
            e.preventDefault();
            handlePaste(e.clipboardData.getData('text'));
          }}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoFocus={i === 0}
          maxLength={1}
          aria-label={`Character ${i + 1} of group code`}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-[60px] w-0 min-w-0 flex-1 rounded-[15px] border bg-surface text-center font-mono text-[24px] font-semibold text-ink caret-signal focus:outline-none',
            invalid
              ? 'border-[1.5px] border-alert'
              : 'border-hairline focus:border-[1.5px] focus:border-signal focus:shadow-[0_0_0_4px_rgba(45,85,245,0.08)]'
          )}
        />
      ))}
    </div>
  );
}
