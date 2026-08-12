import { CreateGroupForm } from '@/components/groups/CreateGroupForm';

/** No PageHeader: the flow is a wizard, and each step carries its own step bar and heading rather
 * than a fixed page title repeated above them. */
export default async function NewGroupPage({ searchParams }: { searchParams: Promise<{ name?: string; seedAmount?: string }> }) {
  const { name, seedAmount } = await searchParams;
  const parsedSeedAmount = Number(seedAmount);

  return (
    <main className="mx-auto max-w-lg px-5 pt-5 pb-8">
      <CreateGroupForm
        initialName={name}
        initialSeedAmount={Number.isFinite(parsedSeedAmount) && parsedSeedAmount > 0 ? parsedSeedAmount : undefined}
      />
    </main>
  );
}
