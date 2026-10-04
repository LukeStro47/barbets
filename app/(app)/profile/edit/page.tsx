import Link from 'next/link';
import { cookies } from 'next/headers';
import { createClient, requireUser } from '@/lib/supabase/server';
import { ScreenHeader, RowChevron } from '@/components/ui/Screen';
import { SettingsCard, SectionLabel } from '@/components/ui/SettingsList';
import { AvatarPicker } from '@/components/profile/AvatarPicker';
import { NicknameEditor } from '@/components/groups/NicknameEditor';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { LAST_GROUP_COOKIE, pickCurrentMembership } from '@/lib/navRoute';

/**
 * /profile/edit — the pencil on You. Both halves of "who you are" in one place, each labelled
 * with its reach, because the two really do differ: the profile picture is one per account and
 * shows in every group, while the handle is a per-group nickname (memberships.nickname). The
 * group whose name is edited inline is chosen by pickCurrentMembership(), the same rule /profile
 * uses; every other group gets a row through to its own settings/you page, which carries
 * `editGroup` so its Back returns to this screen on the same group rather than switching to theirs.
 */
export default async function EditProfilePage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const lastGroup = (await cookies()).get(LAST_GROUP_COOKIE)?.value;

  const [{ data: memberships }, { data: avatarRow }] = await Promise.all([
    supabase
      .from('memberships')
      .select('group_id, nickname, groups(name)')
      .eq('user_id', user.id)
      .in('status', ['active', 'dormant'])
      .order('joined_at', { ascending: true }),
    supabase.from('users').select('avatar_updated_at, avatar_preset_key').eq('id', user.id).single(),
  ]);
  const rows = (memberships ?? []).map((m) => ({
    group_id: m.group_id,
    nickname: m.nickname ?? '',
    groupName: (m.groups as unknown as { name: string } | null)?.name ?? '',
  }));
  const current = pickCurrentMembership(rows, groupParam, lastGroup);
  const others = rows.filter((m) => m.group_id !== current?.group_id);
  const nickname = current?.nickname || user.email?.split('@')[0] || '?';
  const backHref = current ? `/profile?group=${current.group_id}` : '/profile';

  return (
    <>
      <ScreenHeader title="Edit profile" href={backHref} />
      <main className="mx-auto flex max-w-lg flex-col gap-5 px-5 pt-5 pb-7">
        <section>
          <SectionLabel>Profile picture</SectionLabel>
          <AvatarPicker
            userId={user.id}
            nickname={nickname}
            avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
            avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
            trigger={
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3.5 transition-colors hover:border-dash"
              >
                <UserAvatar
                  userId={user.id}
                  nickname={nickname}
                  avatarUpdatedAt={avatarRow?.avatar_updated_at ?? null}
                  avatarPresetKey={avatarRow?.avatar_preset_key ?? null}
                  className="h-10 w-10 shrink-0 text-xs"
                  fallbackClassName="bg-rule text-signal-deep"
                />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[13.5px] font-bold text-ink">Change picture</span>
                  <span className="mt-0.5 block text-[11.5px] text-faint">A photo, or one of the built-in icons</span>
                </span>
                <RowChevron className="text-faint" />
              </button>
            }
          />
          <p className="mt-2 px-0.5 text-[11.5px] leading-[1.45] text-faint text-pretty">
            Everywhere. The same picture shows in every group you are in.
          </p>
        </section>

        {current && (
          <section>
            <SectionLabel>Your name in {current.groupName}</SectionLabel>
            <SettingsCard>
              <div className="px-4 py-3.5">
                <NicknameEditor groupId={current.group_id} nickname={current.nickname} />
              </div>
            </SettingsCard>
            <p className="mt-2 px-0.5 text-[11.5px] leading-[1.45] text-faint text-pretty">
              Only in {current.groupName}. This is how people there see and @mention you. Each group can know you by a different
              name, so your other groups keep theirs.
            </p>
          </section>
        )}

        {others.length > 0 && (
          <section>
            <SectionLabel>Your name in other groups</SectionLabel>
            <SettingsCard>
              {others.map((m) => (
                <Link
                  key={m.group_id}
                  href={`/groups/${m.group_id}/settings/you?from=edit&editGroup=${current?.group_id ?? ''}`}
                  className="flex items-center gap-[11px] px-4 py-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{m.groupName}</span>
                  <span className="max-w-[45%] truncate font-mono text-[12px] text-faint">@{m.nickname}</span>
                  <RowChevron className="text-faint" />
                </Link>
              ))}
            </SettingsCard>
          </section>
        )}
      </main>
    </>
  );
}
