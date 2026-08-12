import { AuthScreen } from '@/components/auth/AuthScreen';
import { InviteCodeBoxes } from '@/components/groups/InviteCodeBoxes';

/**
 * The splash's "I have an invite code" entry point, for someone holding a code but not a link.
 * Deliberately does no lookup of its own: submitting pushes to /join/[code], which is already the
 * one route that resolves a code, and which already bounces a signed-out visitor through
 * /login?next=/join/XXXX and lands them back on the invite afterward. Nothing about invite codes
 * is checked before an account exists, so this page needs no auth of its own either way.
 */
export default function JoinCodePage() {
  return (
    <AuthScreen
      title="Punch in your code."
      subtitle="Four characters, from whoever invited you. We'll take you straight to their group."
    >
      <div className="mt-10">
        <InviteCodeBoxes tone="paper" />
      </div>
    </AuthScreen>
  );
}
