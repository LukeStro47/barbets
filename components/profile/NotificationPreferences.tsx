'use client';

import { useState, useTransition } from 'react';
import { updateGroupNotificationPrefs, updateNotificationCategories } from '@/lib/actions/profile';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { cn } from '@/lib/cn';

export interface GroupNotificationPrefs {
  groupId: string;
  groupName: string;
  avatarKey: string | null;
  notifyGroup: boolean;
  notifyMarkets: boolean;
  notifyResults: boolean;
  notifyAdmin: boolean;
}

/** The three sub-toggles inside a group, in the order the events actually happen to you: a market
 * appears, it resolves, and the group itself changes shape. Descriptions name real notifications
 * rather than categories, since "Markets and betting" on its own doesn't tell anyone what they'd
 * stop receiving. */
const SUB_TOGGLES = [
  {
    key: 'notifyMarkets' as const,
    label: 'Markets and betting',
    description: 'New markets, ones that need your endorsement, and betting closing.',
  },
  {
    key: 'notifyResults' as const,
    label: 'Resolutions and results',
    description: 'Proposed outcomes, challenges and votes, results, and Awards.',
  },
  {
    key: 'notifyAdmin' as const,
    label: 'Group admin',
    description: 'People joining, betting opening, seasons ending, and deletions.',
  },
];

function GroupRow({ prefs, onSave }: { prefs: GroupNotificationPrefs; onSave: (next: GroupNotificationPrefs) => void }) {
  return (
    <div className="space-y-3 border-t border-espresso-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <GroupAvatar
            name={prefs.groupName}
            avatarKey={prefs.avatarKey}
            className="h-8 w-8 text-[11px]"
            fallbackClassName="bg-espresso-900 text-honey-300"
          />
          <p className="truncate text-sm font-semibold text-espresso-800">{prefs.groupName}</p>
        </div>
        <Switch checked={prefs.notifyGroup} onChange={() => onSave({ ...prefs, notifyGroup: !prefs.notifyGroup })} />
      </div>

      {/* Kept mounted but dimmed and inert when the group is muted, rather than unmounted: it's
          the answer to "what would I get back if I turned this on again," and hiding it makes the
          master switch look like it deleted the settings underneath. */}
      <div className={cn('space-y-2.5 pl-[42px]', !prefs.notifyGroup && 'pointer-events-none opacity-40')}>
        {SUB_TOGGLES.map((t) => (
          <div key={t.key} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-espresso-700">{t.label}</p>
              <p className="text-xs leading-[1.45] text-espresso-400">{t.description}</p>
            </div>
            <Switch
              checked={prefs[t.key]}
              disabled={!prefs.notifyGroup}
              onChange={() => onSave({ ...prefs, [t.key]: !prefs[t.key] })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** /profile/notifications. Saves on every toggle rather than behind a Save button, and applies the
 * change optimistically so the switch moves under the finger; a rejected write rolls the whole
 * previous state back rather than leaving the UI and the database disagreeing. */
export function NotificationPreferences({
  groups,
  notifyNudges: initialNudges,
  notifyPromos: initialPromos,
}: {
  groups: GroupNotificationPrefs[];
  notifyNudges: boolean;
  notifyPromos: boolean;
}) {
  const [groupPrefs, setGroupPrefs] = useState(groups);
  const [notifyNudges, setNotifyNudges] = useState(initialNudges);
  const [notifyPromos, setNotifyPromos] = useState(initialPromos);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function saveGroup(next: GroupNotificationPrefs) {
    const previous = groupPrefs;
    setGroupPrefs((current) => current.map((g) => (g.groupId === next.groupId ? next : g)));
    setError(null);
    startTransition(async () => {
      const result = await updateGroupNotificationPrefs(next.groupId, {
        notifyGroup: next.notifyGroup,
        notifyMarkets: next.notifyMarkets,
        notifyResults: next.notifyResults,
        notifyAdmin: next.notifyAdmin,
      });
      if (result.error) {
        setGroupPrefs(previous);
        setError(result.error);
      }
    });
  }

  function saveCategories(nudges: boolean, promos: boolean) {
    const previous = { nudges: notifyNudges, promos: notifyPromos };
    setNotifyNudges(nudges);
    setNotifyPromos(promos);
    setError(null);
    startTransition(async () => {
      const result = await updateNotificationCategories({ notifyNudges: nudges, notifyPromos: promos });
      if (result.error) {
        setNotifyNudges(previous.nudges);
        setNotifyPromos(previous.promos);
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <Card className="space-y-4">
        <div>
          <h2 className="font-display font-bold text-espresso-800">Your groups</h2>
          <p className="mt-0.5 text-xs text-espresso-400">Everything that happens in a group you're in, group by group.</p>
        </div>
        {groupPrefs.length === 0 ? (
          <p className="text-sm text-espresso-400">Nothing to set up yet, you're not in a group.</p>
        ) : (
          groupPrefs.map((g) => <GroupRow key={g.groupId} prefs={g} onSave={saveGroup} />)
        )}
      </Card>

      <Card className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-espresso-800">Nudges to bet</h2>
            <p className="mt-0.5 text-xs leading-[1.5] text-espresso-400">
              An occasional Friday prompt when a group of yours has gone quiet, and a heads up when a market is about
              to close and you haven't had a bet in a while. Never more than one of each per group per day.
            </p>
          </div>
          <Switch checked={notifyNudges} onChange={() => saveCategories(!notifyNudges, notifyPromos)} />
        </div>
      </Card>

      <Card className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-espresso-800">News from Barbets</h2>
            <p className="mt-0.5 text-xs leading-[1.5] text-espresso-400">
              New features, and the occasional thing we think you'd want to know about. Nothing about your groups.
            </p>
          </div>
          <Switch checked={notifyPromos} onChange={() => saveCategories(notifyNudges, !notifyPromos)} />
        </div>
      </Card>
    </div>
  );
}
