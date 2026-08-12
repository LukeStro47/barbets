import { CreateGroupForm } from '@/components/groups/CreateGroupForm';

/** No PageHeader: the flow is a wizard, and each step carries its own step bar and heading rather
 * than a fixed page title repeated above them. `main` is sized to the flow height and is the flex
 * container itself, so the wizard's pinned footer sits on the bottom of the viewport rather than
 * on the bottom of a box that is taller than it by this element's own padding. */
export default async function NewGroupPage({ searchParams }: { searchParams: Promise<{ name?: string; seedAmount?: string }> }) {
  const { name, seedAmount } = await searchParams;
  const parsedSeedAmount = Number(seedAmount);

  return (
    <main className="mx-auto flex min-h-[var(--flow-height)] max-w-lg flex-col px-5 pt-5 pb-8">
      <CreateGroupForm
        initialName={name}
        initialSeedAmount={Number.isFinite(parsedSeedAmount) && parsedSeedAmount > 0 ? parsedSeedAmount : undefined}
      />
    </main>
  );
}
