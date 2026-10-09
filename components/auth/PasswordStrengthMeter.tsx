import { cn } from '@/lib/cn';

/** How many of the 4 segments light up, 0-4. Scored on length and character variety rather than
 * a real entropy estimate (zxcvbn-class libraries are overkill for a play-money social app) —
 * this is a nudge toward "not just your pet's name," not a security gate. The real minimum
 * (6 characters, lib/actions/auth.ts) is enforced server-side regardless of what this shows. */
function scorePassword(password: string): number {
  if (password.length === 0) return 0;
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  return score;
}

const LABEL = ['Too short', 'Weak', 'Okay', 'Good', 'Strong enough'];

/** 5b's 4-segment strength meter — fills green left to right as `scorePassword` climbs, with a
 * label that only reads "Strong enough" once at least 3 of 4 segments are lit. Renders nothing
 * for an empty password, so a blank field doesn't open with a discouraging "Too short." */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (password.length === 0) return null;
  const score = scorePassword(password);

  return (
    <div className="mt-2 flex items-center gap-[9px]">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i < score ? 'bg-gain' : 'bg-hairline')} />
        ))}
      </div>
      <span className={cn('text-[11.5px] font-semibold whitespace-nowrap', score >= 3 ? 'text-gain' : 'text-faint')}>{LABEL[score]}</span>
    </div>
  );
}
