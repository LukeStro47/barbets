import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { TemplateGallery } from '@/components/markets/TemplateGallery';
import type { MarketTemplate } from '@/lib/marketTemplates';

export default async function MarketTemplatesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: group }, { data: members }, { data: templates }] = await Promise.all([
    supabase.from('groups').select('name, is_public').eq('id', groupId).single(),
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).eq('status', 'active'),
    supabase
      .from('market_templates')
      .select('*')
      .or(`scope.eq.curated,and(scope.eq.private,created_by.eq.${user.id}),and(scope.eq.group,group_id.eq.${groupId})`)
      .order('created_at', { ascending: false }),
  ]);

  // Same 404-not-403 posture as new/page.tsx: a group this user isn't in returns nothing above
  // (RLS), which reads identically to "doesn't exist."
  if (!group) notFound();

  // A market's creator can never be its own subject, so they're not a valid @-placeholder target.
  const memberOptions = (members ?? [])
    .filter((m) => m.user_id !== user.id)
    .map((m) => ({ userId: m.user_id, nickname: m.nickname }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname));

  return (
    <main className="mx-auto flex min-h-[var(--flow-height)] max-w-lg flex-col px-5 pt-5 pb-8">
      <TemplateGallery
        groupId={groupId}
        groupName={group.name}
        isPublic={group.is_public}
        members={memberOptions}
        templates={(templates ?? []) as MarketTemplate[]}
        viewerId={user.id}
      />
    </main>
  );
}
