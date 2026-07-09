import { PageHeader } from '@/components/ui/PageHeader';
import { CreateGroupForm } from '@/components/groups/CreateGroupForm';

export default function NewGroupPage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Start a group" subtitle="Set the house rules. You can change most of this later." backHref="/groups" />
      <CreateGroupForm />
    </main>
  );
}
