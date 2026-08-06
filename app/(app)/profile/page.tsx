import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/lib/actions/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChangeEmailForm, ChangePasswordForm } from '@/components/profile/AccountForms';
import { DeleteAccountButton } from '@/components/profile/DeleteAccountButton';
import { PushSetup } from '@/components/pwa/PushSetup';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { Button } from '@/components/ui/Button';
import { Mention } from '@/components/ui/Mention';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: isAdmin } = await supabase.rpc('is_platform_admin');

  const { data: memberships } = await supabase
    .from('memberships')
    .select('group_id, balance, nickname, groups(name)')
    .eq('user_id', user!.id)
    .neq('status', 'removed');

  const { data: myBets } = await supabase
    .from('bets')
    .select('id, side, option_id, amount, payout, settled_at, market_id, markets(title, group_id, outcome)')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })
    .limit(15);

  const optionIds = [...new Set((myBets ?? []).map((b: any) => b.option_id).filter(Boolean))];
  const { data: options } =
    optionIds.length > 0
      ? await supabase.from('market_options').select('id, label').in('id', optionIds)
      : { data: [] };
  const optionLabelById = new Map((options ?? []).map((o) => [o.id, o.label]));

  const stakedByGroup = new Map<string, number>();
  for (const b of myBets ?? []) {
    if (b.settled_at) continue;
    const groupId = (b as any).markets?.group_id;
    if (!groupId) continue;
    stakedByGroup.set(groupId, (stakedByGroup.get(groupId) ?? 0) + b.amount);
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Profile" />

      <Card className="space-y-4">
        <ChangeEmailForm currentEmail={user?.email ?? ''} />
        <div className="border-t border-espresso-100 pt-4">
          <ChangePasswordForm />
        </div>
      </Card>

      <InstallPrompt />
      <PushSetup />

      <Card>
        <h2 className="mb-3 font-display font-bold text-espresso-800">My groups</h2>
        {(memberships ?? []).length === 0 ? (
          <EmptyState icon="👥" title="You're not in any groups yet" subtitle="Create one or ask a friend for an invite code." />
        ) : (
          <ul className="space-y-2">
            {(memberships ?? []).map((m: any) => (
              <li key={m.group_id}>
                <Link href={`/groups/${m.group_id}`} className="flex items-center justify-between">
                  <div>
                    <span className="block text-espresso-700">{m.groups?.name}</span>
                    <Mention nickname={m.nickname} className="text-xs text-espresso-400" />
                  </div>
                  <span className="text-right text-sm text-espresso-500">
                    <span className="font-display font-bold text-espresso-900">{formatTokens(m.balance)}</span> tokens
                    {stakedByGroup.get(m.group_id) ? (
                      <span className="block text-xs">({formatTokens(stakedByGroup.get(m.group_id)!)} staked, private to you)</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-display font-bold text-espresso-800">My recent bets</h2>
        {(myBets ?? []).length === 0 ? (
          <EmptyState icon="🎲" title="No bets yet" />
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-espresso-100">
            {(myBets ?? []).map((b: any, i: number) => {
              const market = b.markets;
              const refunded = b.settled_at && market?.outcome === 'void';
              const won = b.settled_at && !refunded && b.payout > 0;
              const lost = b.settled_at && !refunded && b.payout === 0;
              return (
                <li key={b.id} className={i > 0 ? 'border-t border-espresso-100' : ''}>
                  <Link
                    href={`/groups/${market?.group_id}/markets/${b.market_id}${b.settled_at ? '/reveal' : ''}`}
                    className="flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-espresso-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-espresso-800">{market?.title}</p>
                      <p className="text-xs text-espresso-400">
                        {formatTokens(b.amount)} on{' '}
                        <OptionLabel label={(b.option_id ? optionLabelById.get(b.option_id) ?? '' : b.side ?? '').toUpperCase()} />
                      </p>
                    </div>
                    {!b.settled_at && <span className="shrink-0 text-xs font-semibold text-espresso-400">pending</span>}
                    {refunded && <span className="shrink-0 text-xs font-semibold text-espresso-400">refunded</span>}
                    {won && (
                      <span className="shrink-0 text-xs font-semibold text-success-700">
                        {formatTokens(b.payout - b.amount)} won
                      </span>
                    )}
                    {lost && <span className="shrink-0 text-xs font-semibold text-espresso-300">{formatTokens(b.amount)} lost</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-2 text-sm">
        {isAdmin && (
          <Link href="/admin" className="font-medium text-espresso-700 underline">
            Admin
          </Link>
        )}
        <Link href="/how-it-works" className="font-medium text-espresso-700 underline">
          How Barbets works
        </Link>
        <Link href="/feedback" className="font-medium text-espresso-700 underline">
          Send feedback
        </Link>
        <Link href="/help" className="font-medium text-espresso-700 underline">
          Help
        </Link>
        <Link href="/terms" className="font-medium text-espresso-700 underline">
          Terms of use
        </Link>
        <Link href="/privacy" className="font-medium text-espresso-700 underline">
          Privacy policy
        </Link>
      </div>

      <form action={signOut}>
        <Button type="submit" className="w-full">
          Sign out
        </Button>
      </form>

      <Card>
        <h2 className="mb-3 font-display font-bold text-danger-700">Danger zone</h2>
        <DeleteAccountButton />
      </Card>
    </main>
  );
}
