import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Logo, Mark } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { StickyFooter } from '@/components/ui/Shell';

/**
 * Entry point (DESIGN 5a2): wordmark lock-up, one-line pitch, primary Create account,
 * secondary I have an account, tertiary Join with a code.
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/groups');

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas px-[22px] pt-[calc(env(safe-area-inset-top)+48px)] pb-[var(--sticky-footer-offset)]">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Mark size={64} />
        <Logo height={40} className="mt-5" />
        <p className="mt-4 max-w-[280px] text-[13.5px] leading-[1.5] text-muted">
          Free-to-play social betting for private groups. Standing is the only currency.
        </p>
      </div>

      <StickyFooter className="mx-auto max-w-[430px]">
        <div className="flex flex-col gap-2.5">
          <Link href="/login?mode=signup" className="w-full">
            <Button variant="primary" size="lg" className="w-full">
              Create account
            </Button>
          </Link>
          <Link href="/login" className="w-full">
            <Button variant="secondary" size="lg" className="w-full">
              I have an account
            </Button>
          </Link>
          <Link
            href="/join"
            className="block py-2 text-center text-[13.5px] font-bold text-signal"
          >
            Join with a code
          </Link>
        </div>
      </StickyFooter>
    </main>
  );
}
