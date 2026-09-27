import type { ReactNode } from 'react';
import { Wordmark } from '@/components/ui/BrandMark';

/**
 * The frame every pre-group form screen shares (5b): the small wordmark, a 27px headline, one
 * supporting line (which can carry an inline link, "Log in instead"), then the form. The form's
 * one action lives in a sticky footer the form renders itself, so it sits under the keyboard's
 * reach rather than at the end of the page.
 *
 * The 76px top padding is on top of the safe-area inset: this runs edge-to-edge in the native
 * WebView, so without the env() term the wordmark would sit under the status bar.
 */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-canvas px-[22px] pt-[calc(env(safe-area-inset-top)+64px)] pb-[150px]">
      <Wordmark size={19} />
      <h1 className="mt-[30px] text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em] text-ink text-pretty">{title}</h1>
      {subtitle && <p className="mt-2 text-[13.5px] leading-[1.5] text-muted text-pretty">{subtitle}</p>}
      {children}
    </main>
  );
}
