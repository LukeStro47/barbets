import type { ReactNode } from 'react';
import { Coin } from '@/components/ui/Coin';
import { BackButton } from '@/components/ui/BackButton';

/**
 * The shell every pre-group form screen shares: back affordance and coin on one header row, a
 * big headline, an optional subhead, then the form. Full bleed on paper with no <Card> — the
 * card used to wrap a boxed form on a page that was already the same colour as the card, which
 * bought a border and no separation.
 *
 * The 52px top padding is *on top of* the safe-area inset rather than instead of it: this runs in
 * a Capacitor WebView with viewportFit: 'cover', so without the env() term the header row sits
 * under the status bar.
 */
export function AuthScreen({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Replaces the coin, for a screen whose header carries progress instead (the nickname step). */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper px-7 pb-8 pt-[calc(env(safe-area-inset-top)+3.25rem)]">
      <div className="flex items-center justify-between">
        <BackButton />
        {headerRight ?? <Coin size={46} className="h-[46px] w-auto opacity-90" />}
      </div>
      <h1 className="mt-11 font-display text-[34px]/[38px] font-extrabold tracking-[-0.03em] text-espresso-900">
        {title}
      </h1>
      {subtitle && <p className="mt-2.5 text-base/6 text-espresso-500">{subtitle}</p>}
      {children}
    </main>
  );
}
