import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-7 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
      {/* Texture, not a heading — the numerals are set in the divider tone and the real title
          sits under them, so a screen reader and a skim-reader both get the sentence first. */}
      <span aria-hidden className="font-display text-[120px]/none font-extrabold tracking-[-0.05em] text-espresso-100">
        404
      </span>
      <h1 className="mt-6 font-display text-[30px]/[34px] font-extrabold tracking-[-0.03em] text-espresso-900">
        You took a wrong turn somewhere.
      </h1>
      <p className="mt-3 max-w-[300px] text-base/6 text-espresso-500">
        That link is stale, or whatever it pointed at is gone.
      </p>
      <Link href="/" className="mt-9 w-full max-w-[330px]">
        <Button variant="accent" size="xl" className="w-full">
          Back home
        </Button>
      </Link>
    </main>
  );
}
