'use client';

import { useState, useTransition } from 'react';
import { Capacitor } from '@capacitor/core';
import { updateGroupNotificationPrefs, updateNotificationCategories } from '@/lib/actions/profile';
import { usePushSubscription } from '@/components/pwa/usePushSubscription';
import { Switch } from '@/components/ui/Switch';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { CaretDownIcon } from '@/components/ui/icons';
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
 * appears, it resolves, and the group itself changes shape. */
const SUB_TOGGLES = [
  { key: 'notifyMarkets' as const, label: 'New markets and betting', summary: 'Markets' },
  { key: 'notifyResults' as const, label: 'Resolutions and results', summary: 'Results' },
  { key: 'notifyAdmin' as const, label: 'Group admin', summary: 'Group admin' },
];

const cardClasses = 'rounded-[20px] border border-espresso-100 bg-paper-white';
const eyebrowClasses = 'ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase';

/** The collapsed row's one-line answer to "what does this group actually send me?" — the reason a
 * row can stay shut. Named categories rather than a count, since "2 of 3 on" tells you nothing
 * about which two. */
function stateSummary(prefs: GroupNotificationPrefs): string {
  if (!prefs.notifyGroup) return 'Muted';
  const on = SUB_TOGGLES.filter((t) => prefs[t.key]).map((t) => t.summary);
  if (on.length === 0) return 'Nothing switched on';
  if (on.length === SUB_TOGGLES.length) return 'Everything on';
  if (on.length === 1) return `${on[0]} only`;
  return `${on[0]} and ${on[1].toLowerCase()} on`;
}

function GroupRow({
  prefs,
  expanded,
  onToggleExpanded,
  onSave,
  last,
}: {
  prefs: GroupNotificationPrefs;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSave: (next: GroupNotificationPrefs) => void;
  last: boolean;
}) {
  return (
    <div className={cn('py-[13px]', !last && 'border-b border-espresso-100')}>
      <div className="flex items-center gap-[11px]">
        {/* The whole left side opens the row; the switch beside it stays a switch, so muting a
            group never costs an extra tap to close what the mute just opened. */}
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-[11px] border-0 bg-transparent p-0 text-left"
        >
          <GroupAvatar
            name={prefs.groupName}
            avatarKey={prefs.avatarKey}
            radiusClassName="rounded-[10px]"
            className="h-8 w-8 text-[11px]"
            fallbackClassName="bg-espresso-900 text-honey-300"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-extrabold text-espresso-800">{prefs.groupName}</span>
            <span className="block text-[11px] text-espresso-400">{stateSummary(prefs)}</span>
          </span>
          <CaretDownIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-espresso-300 transition-transform duration-[240ms] motion-reduce:transition-none',
              expanded && 'rotate-180'
            )}
          />
        </button>
        <Switch checked={prefs.notifyGroup} onChange={() => onSave({ ...prefs, notifyGroup: !prefs.notifyGroup })} />
      </div>

      {/* Kept mounted but dimmed and inert when the group is muted, rather than unmounted: it's
          the answer to "what would I get back if I turned this on again," and hiding it makes the
          master switch look like it deleted the settings underneath. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-[240ms] ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className={cn('flex flex-col gap-2 pt-2.5 pl-[43px]', !prefs.notifyGroup && 'pointer-events-none opacity-40')}>
            {SUB_TOGGLES.map((t) => (
              <div key={t.key} className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 text-[12.5px] font-bold text-espresso-700">{t.label}</span>
                <Switch
                  size="sm"
                  checked={prefs[t.key]}
                  disabled={!prefs.notifyGroup}
                  onChange={() => onSave({ ...prefs, [t.key]: !prefs[t.key] })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The one control above everything else: this device's push subscription. Every preference below
 * it is a filter on notifications that only exist if this is on, so it reads as a master rather
 * than as another category. The platform cases push can't serve (an unsupported browser, iOS
 * before the app is installed, permission already refused) replace the subtitle and lock the
 * switch, rather than swapping in a differently-shaped card. */
function MasterPushRow() {
  const { platform, subscribed, permission, error, isPending, subscribe, unsubscribe } = usePushSubscription();

  if (platform === 'checking') return null;

  const blocked =
    platform === 'unsupported'
      ? "Push notifications aren't supported in this browser."
      : platform === 'ios-needs-install'
        ? 'Install Barbets to your home screen first, then open it from there and come back.'
        : permission === 'denied'
          ? Capacitor.isNativePlatform()
            ? "Blocked for Barbets. Turn them on in your device's app settings, then reopen the app."
            : "Blocked for Barbets. Turn them on in your browser's site settings, then reload."
          : null;

  return (
    <div className={cn(cardClasses, 'px-4 py-[15px]')}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-espresso-800">All notifications</span>
          <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-espresso-400">
            {blocked ?? 'Off means nothing reaches this phone.'}
          </span>
        </span>
        <Switch
          checked={subscribed}
          disabled={isPending || blocked !== null}
          onChange={() => (subscribed ? unsubscribe() : subscribe())}
        />
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger-700">{error}</p>}
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
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(groups[0]?.groupId ?? null);
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
    <div className="space-y-3.5">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <MasterPushRow />

      <div className="space-y-2">
        <p className={eyebrowClasses}>Your groups</p>
        <div className={cn(cardClasses, 'px-4')}>
          {groupPrefs.length === 0 ? (
            <p className="py-[13px] text-[12.5px] text-espresso-400">Nothing to set up yet, you're not in a group.</p>
          ) : (
            groupPrefs.map((g, i) => (
              <GroupRow
                key={g.groupId}
                prefs={g}
                last={i === groupPrefs.length - 1}
                expanded={expandedGroupId === g.groupId}
                onToggleExpanded={() => setExpandedGroupId((current) => (current === g.groupId ? null : g.groupId))}
                onSave={saveGroup}
              />
            ))
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className={eyebrowClasses}>From Barbets</p>
        <div className={cn(cardClasses, 'px-4')}>
          <div className="flex items-start gap-3 border-b border-espresso-100 py-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-espresso-800">Nudges to bet</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-espresso-400">
                An occasional Friday prompt when a group of yours has gone quiet, and a heads up when a market is about
                to close and you haven't had a bet in a while. Never more than one of each per group per day.
              </span>
            </span>
            <Switch checked={notifyNudges} onChange={() => saveCategories(!notifyNudges, notifyPromos)} />
          </div>
          <div className="flex items-start gap-3 py-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-extrabold text-espresso-800">News from Barbets</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-espresso-400">
                New features, and the occasional thing we think you'd want to know about. Nothing about your groups.
              </span>
            </span>
            <Switch checked={notifyPromos} onChange={() => saveCategories(notifyNudges, !notifyPromos)} />
          </div>
        </div>
      </div>
    </div>
  );
}
