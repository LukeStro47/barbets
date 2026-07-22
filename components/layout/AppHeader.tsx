import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { createClient } from '@/lib/supabase/server';
import { getWaitingOnYou, badgeCount } from '@/lib/waitingOnYou';

export async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count: membershipCount } = user
    ? await supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('user_id', user.id).neq('status', 'removed')
    : { count: 0 };
  const hasGroups = (membershipCount ?? 0) > 0;

  const waitingCount = user && hasGroups ? badgeCount(await getWaitingOnYou(supabase, user.id)) : 0;

  return (
    // pt-[env(safe-area-inset-top)] lives on the header itself, not a global body padding: this
    // way the header's own background extends up into the status bar area (so the two read as one
    // continuous bar instead of a body-colored gap sitting above a differently-colored header), and
    // "sticky top-0" keeps meaning the same thing whether the header is in its initial flow
    // position or stuck — nothing external is offsetting it, so there's no jump between the two.
    <header className="sticky top-0 z-10 border-b border-espresso-100 bg-paper-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between px-5 py-3.5">
        <Link href="/groups" className="flex items-center">
          <Logo />
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium text-espresso-500">
          {hasGroups && (
            <Link href="/inbox" className="relative hover:text-espresso-900">
              Inbox
              {waitingCount > 0 && (
                <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-honey-500 px-1 text-[10px] font-bold text-espresso-900">
                  {waitingCount}
                </span>
              )}
            </Link>
          )}
          <Link href="/groups" className="hover:text-espresso-900">
            Groups
          </Link>
          <Link href="/profile" className="hover:text-espresso-900">
            Profile
          </Link>
        </nav>
      </div>
    </header>
  );
}
