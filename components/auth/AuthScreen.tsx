import type { ReactNode } from 'react';
import { Mark } from '@/components/ui/Logo';
import { BackButton } from '@/components/ui/BackButton';

/**
 * Ledger chrome for every pre-group form screen (DESIGN 5b / 5c / 5f): back tile, Mark, page
 * title, optional subhead, then the form. Full bleed on canvas with no card wrap — a boxed form
 * on a page that is already the same colour bought a border and no separation.
 *
 * The safe-area inset is added on top of the status offset: this runs in a Capacitor WebView with
 * viewportFit: 'cover', so without the env() term the header sits under the status bar.
 */
export function AuthScreen({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Replaces the Mark, for a screen whose header carries progress instead (the nickname step). */
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-canvas px-[22px] pb-8 pt-[calc(env(safe-area-inset-top)+40px)]">
      <div className="flex items-center justify-between">
        <BackButton />
        {headerRight ?? <Mark size={36} />}
      </div>
      <h1 className="mt-9 text-[26px] font-extrabold tracking-[-0.02em] text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">{subtitle}</p>}
      {children}
    </main>
  );
}
