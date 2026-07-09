import Link from 'next/link';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <StackedLogo height={100} className="mx-auto mb-2" />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Page not found</h1>
          <p className="mt-1 text-espresso-500">
            That link doesn't lead anywhere, it may be stale, or whatever it pointed to isn't there anymore.
          </p>
        </div>
        <Link href="/" className="block">
          <Button size="lg" className="w-full">
            Back home
          </Button>
        </Link>
      </div>
    </main>
  );
}
