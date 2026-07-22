import { Card } from '@/components/ui/Card';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { AuthTabs } from '@/components/auth/AuthTabs';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { next, mode } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12 pt-[calc(env(safe-area-inset-top)+3rem)]">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center text-center">
          <StackedLogo height={120} className="mb-2" />
          <p className="text-espresso-500">Prediction markets for your friend group. No real money, ever.</p>
        </div>

        <Card>
          <AuthTabs defaultMode={mode === 'signup' ? 'signup' : 'signin'} next={next} />
        </Card>
      </div>
    </main>
  );
}
