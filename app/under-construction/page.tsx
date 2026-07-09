import { UnderConstructionForm } from '@/components/auth/UnderConstructionForm';
import { Card } from '@/components/ui/Card';
import { StackedLogo } from '@/components/ui/StackedLogo';

export default async function UnderConstructionPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-sm space-y-6 text-center">
        <StackedLogo height={100} className="mx-auto mb-2" />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Under construction</h1>
          <p className="mt-1 text-espresso-500">Barbets is in a private beta right now. Have an access code?</p>
        </div>
        <Card>
          <UnderConstructionForm next={next} />
        </Card>
      </div>
    </main>
  );
}
