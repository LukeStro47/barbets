import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { FeedbackForm } from '@/components/profile/FeedbackForm';

export default function FeedbackPage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Send feedback" subtitle="Bug, idea, or anything else, it goes straight to the team." backHref="/profile" />
      <Card>
        <FeedbackForm />
      </Card>
    </main>
  );
}
