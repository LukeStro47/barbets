import { PageHeader } from '@/components/ui/PageHeader';
import { CreateGroupForm } from '@/components/groups/CreateGroupForm';

export default async function NewGroupPage({ searchParams }: { searchParams: Promise<{ name?: string; seedAmount?: string }> }) {
  const { name, seedAmount } = await searchParams;
  const parsedSeedAmount = Number(seedAmount);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Start a group" subtitle="Set the house rules. You can change most of this later." backHref="/groups" />
      <CreateGroupForm initialName={name} initialSeedAmount={Number.isFinite(parsedSeedAmount) && parsedSeedAmount > 0 ? parsedSeedAmount : undefined} />
    </main>
  );
}
