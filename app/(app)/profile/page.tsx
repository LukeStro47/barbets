import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { signOut } from '@/lib/actions/auth';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron } from '@/components/ui/Screen';

/**
 * 4k: You. Who you are here (avatar, handle, how long you've played), the platform-admin row for
 * system admins only, then one list of settings and the small print. Deliberately no cross-group
 * lifetime stats — each group is its own world, so a number with no group attached is meaningless
 * (a confirmed product call, not an omission). Per-group figures live on each group's own hub
 * and leaderboard. Opened from inside a group (?group=), the group bar sits on top.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: isAdmin }, { data: memberships }, { data: avatarRow }] = await Promise.all([
    supabase.rpc('is_platform_admin'),
    supabase
      .from('memberships')
      .select('group_id, nickname, joined_at, status, groups(name, avatar_key)')
      .eq('user_id', user.id)
      .in('status', ['active', 'dormant'])
      .order('joined_at', { ascending: true }),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', user.id).single(),
  ]);

  const rows = memberships ?? [];
  const current = rows.find((m) => m.group_id === groupParam) ?? null;
  const handle = current?.nickname ?? rows[rows.length - 1]?.nickname ?? user.email?.split('@')[0] ?? 'you';
  const since = rows[0] ? new Date(rows[0].joined_at).toLocaleDateString('en-GB', { month: 'long' }) : null;
  const tenure =
    rows.length === 0
      ? 'Not in a group yet'
      : `Playing ${rows.length} group${rows.length === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`;
  const emailHint = user.email ? `${user.email.split('@')[0]}@` : '';

  const switcherState = current ? await getGroupBarSwitcherState(supabase, current.group_id, user.id) : null;
  const currentGroup = current?.groups as { name: string; avatar_key: string | null } | null | undefined;

  return (
    <>
      {current && currentGroup && switcherState && <GroupBar groupName={currentGroup.name} avatarKey={currentGroup.avatar_key} {...switcherState} />}
      <main className="mx-auto max-w-[430px] px-[18px] pt-5 pb-10">
        <div className="flex items-center gap-[13px]">
          <UserAvatar
            userId={user.id}
            nickname={handle}
            avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
            avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
            className="h-[58px] w-[58px] text-[18px]"
            fallbackClassName="bg-tile text-muted"
            enlargeOnTap
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[21px] font-extrabold tracking-[-0.02em] text-ink">@{handle}</span>
            <span className="mt-0.5 block text-[12.5px] text-faint">{tenure}</span>
          </span>
          <Link
            href="/profile/account"
            aria-label="Edit profile"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-surface text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
          </Link>
        </div>

        {isAdmin && (
          <>
            <p className="mt-4 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Admin</p>
            <Link href="/admin" className="mt-[9px] flex items-center gap-[11px] rounded-[18px] bg-ink px-4 py-3.5">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-white/12 text-surface">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
                  <circle cx="16" cy="8" r="2.2" />
                  <circle cx="10" cy="16" r="2.2" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-bold text-surface">Admin console</span>
                <span className="mt-px block text-[11.5px] text-surface/55">Platform-wide, not scoped to any one group</span>
              </span>
              <RowChevron className="text-surface/60" />
            </Link>
            <p className="mt-[7px] text-[11.5px] leading-[1.45] text-faint">Only system admins see this row.</p>
          </>
        )}

        <div className="mt-4 overflow-hidden rounded-[18px] border border-hairline bg-surface">
          <ListRow href="/profile/account" label="Account" hint={emailHint} />
          <ListRow href="/profile/notifications" label="Notifications" hint="All groups" />
          <ListRow href="/feedback" label="Help and feedback" />
          <ListRow href="/privacy" label="Privacy policy" />
          <ListRow href="/terms" label="Terms" />
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-[11px] px-4 py-[13px] text-left">
              <span className="min-w-0 flex-1 text-[13.5px] font-bold text-muted">Sign out</span>
            </button>
          </form>
        </div>
      </main>
    </>
  );
}

function ListRow({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex items-center gap-[11px] border-b border-row-rule px-4 py-[13px]">
      <span className="min-w-0 flex-1 text-[13.5px] font-bold text-ink">{label}</span>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
      <RowChevron className="text-faint" />
    </Link>
  );
}
