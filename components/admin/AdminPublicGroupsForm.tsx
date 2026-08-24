'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPublicGroup, assignGroupModerator, listGroupModeratorCandidates, type ModeratorCandidate } from '@/lib/actions/admin';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export interface PublicGroupRow {
  id: string;
  name: string;
  category: 'generic' | 'campus';
  memberCount: number;
}

/** Create a new always-on public group. Staff (the admin submitting this) becomes its owner
    either way; joining as a seeded, moderator-role member is now an explicit opt-in rather than
    forced — see create_public_group()'s migration. */
export function CreatePublicGroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'generic' | 'campus'>('generic');
  const [seedAmount, setSeedAmount] = useState('1000');
  const [selfModerate, setSelfModerate] = useState(false);
  const [nickname, setNickname] = useState('');
  const [moderatorEmails, setModeratorEmails] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [error, setError] = useState<string | null>(null);
  const [unresolvedEmails, setUnresolvedEmails] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setUnresolvedEmails(null);
    startTransition(async () => {
      const emails = moderatorEmails
        .split(/[\n,]/)
        .map((e) => e.trim())
        .filter(Boolean);
      const result = await createPublicGroup({
        name: name.trim(),
        category,
        seedAmount: Number(seedAmount) || 1000,
        timezone,
        nickname: selfModerate ? nickname.trim() : null,
        moderatorEmails: emails,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setName('');
        setNickname('');
        setModeratorEmails('');
        setSelfModerate(false);
        if (result.data!.unresolved_emails.length > 0) {
          setUnresolvedEmails(result.data!.unresolved_emails);
        }
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {unresolvedEmails && (
        <p className="text-sm text-danger-700">
          Created, but no account matches: {unresolvedEmails.join(', ')}. They&apos;ll need to sign up first.
        </p>
      )}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Group name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClasses} placeholder="WVU" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as 'generic' | 'campus')} className={inputClasses}>
            <option value="generic">Generic</option>
            <option value="campus">Campus</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Token allocation</label>
          <input
            type="text"
            inputMode="numeric"
            value={seedAmount}
            onChange={(e) => setSeedAmount(e.target.value.replace(/\D/g, ''))}
            className={inputClasses}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Time zone</label>
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClasses}>
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {friendlyTimezoneName(tz)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">
          Moderator emails (assigned instantly, no invite needed)
        </label>
        <textarea
          value={moderatorEmails}
          onChange={(e) => setModeratorEmails(e.target.value)}
          rows={2}
          placeholder="one@wvu.edu, another@wvu.edu"
          className={inputClasses}
        />
        <p className="text-xs text-espresso-400">
          Each has to already have a Barbets account. They&apos;re added as an active member with a moderator
          role right away and get a push about it — no join step.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-espresso-700">
        <input
          type="checkbox"
          checked={selfModerate}
          onChange={(e) => setSelfModerate(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
        />
        I&apos;ll moderate this group too
      </label>
      {selfModerate && (
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Your nickname here</label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value.toLowerCase())} maxLength={20} className={inputClasses} />
        </div>
      )}

      <Button
        type="button"
        disabled={isPending || !name.trim() || (selfModerate && !nickname.trim())}
        onClick={submit}
        className="w-full"
      >
        {isPending ? 'Creating…' : 'Create public group'}
      </Button>
    </div>
  );
}

/** A group row that opens a modal on tap — total users, category, its moderators (with a clear
    remove/reassign action that's rejected server-side if it's the last one left), and a search box
    to add a new one. Nothing lists every member up front; the "add" side only ever shows once
    there's a query, same pattern MemberSearchBan uses for banning. */
export function ManageModeratorsPanel({ group }: { group: PublicGroupRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-espresso-100 p-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-espresso-800">{group.name}</span>
          <span className="block text-xs text-espresso-400">
            {capitalize(group.category)} · {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-honey-700">Manage</span>
      </button>

      {open && <ManageModeratorsModal group={group} onClose={() => setOpen(false)} />}
    </>
  );
}

function ManageModeratorsModal({ group, onClose }: { group: PublicGroupRow; onClose: () => void }) {
  const [candidates, setCandidates] = useState<ModeratorCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await listGroupModeratorCandidates(group.id);
      if (result.error) setError(result.error);
      else setCandidates(result.data ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const moderators = (candidates ?? []).filter((c) => c.role === 'moderator');
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (candidates ?? []).filter((c) => c.role !== 'moderator' && c.nickname.toLowerCase().includes(q)).slice(0, 20);
  }, [query, candidates]);

  function setModerator(userId: string, next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await assignGroupModerator(group.id, userId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCandidates((prev) => (prev ?? []).map((c) => (c.user_id === userId ? { ...c, role: next ? 'moderator' : 'member' } : c)));
      // Promoting someone clears the search, since the whole point was finding this one person —
      // leaving a stale query would just re-show them (now filtered out as a moderator) sitting
      // beside whatever else still matches.
      if (next) setQuery('');
    });
  }

  return (
    <Modal onClose={onClose}>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">{group.name}</p>
      <p className="text-sm text-espresso-500">
        {group.memberCount} user{group.memberCount === 1 ? '' : 's'} · {capitalize(group.category)}
      </p>
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Moderators</label>
        {candidates === null ? (
          <p className="text-sm text-espresso-400">Loading…</p>
        ) : moderators.length === 0 ? (
          <p className="text-sm text-espresso-400">Nobody yet — add one below.</p>
        ) : (
          <div className="divide-y divide-espresso-50 rounded-xl border border-espresso-100">
            {moderators.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm font-semibold text-espresso-800">@{m.nickname}</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setModerator(m.user_id, false)}
                  className="rounded-full border border-espresso-200 px-3 py-1 text-xs font-semibold text-espresso-600"
                >
                  Remove moderator
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Add a moderator</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by nickname…"
          className="w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
        />
        {query.trim() && (
          <div className="divide-y divide-espresso-50 rounded-xl border border-espresso-100">
            {searchResults.length === 0 ? (
              <p className="px-3 py-2 text-sm text-espresso-400">No match.</p>
            ) : (
              searchResults.map((c) => (
                <div key={c.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-espresso-800">@{c.nickname}</span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setModerator(c.user_id, true)}
                    className="rounded-full bg-honey-500 px-3 py-1 text-xs font-bold text-espresso-900"
                  >
                    Make moderator
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={onClose}>
        Done
      </Button>
    </Modal>
  );
}
