'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { pickGameOfWeek, type GameOfWeekPick, type GameOfWeekCandidate } from '@/lib/actions/admin';
import { ClockIcon, CheckCircleIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

const LEAGUE_LABEL: Record<GameOfWeekPick['league'], string> = { nfl: 'NFL', cfb: 'CFB' };
const LEAGUES: GameOfWeekPick['league'][] = ['nfl', 'cfb'];

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function matchupLabel(candidates: GameOfWeekCandidate[], eventId: string | null): string {
  const chosen = candidates.find((c) => c.event_id === eventId);
  return chosen ? `${chosen.home} vs. ${chosen.away}` : 'Unknown matchup';
}

/** One candidate row with a Pick action — used both for a still-open week's full list and (once
    "Change pick" is tapped) a re-pick of an already-picked one. The star hint on the last
    candidate names sports-weekly-publish's own fallback rule, so an admin who runs out of time
    can see exactly what happens instead of just "something" being auto-selected. */
function CandidateRow({
  candidate,
  isFallback,
  onPick,
  disabled,
}: {
  candidate: GameOfWeekCandidate;
  isFallback: boolean;
  onPick: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-espresso-50 px-4 py-[13px] last:border-b-0">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-espresso-50 text-espresso-500">
        <ClockIcon className="h-[15px] w-[15px]" />
      </span>
      <span className="min-w-0 flex-1">
        <p className="font-display text-[14.5px] font-bold leading-[1.3] text-espresso-950">
          {candidate.home} vs. {candidate.away}
        </p>
        <p className="mt-0.5 text-[11.5px] text-espresso-400">{formatKickoff(candidate.commence_time)}</p>
        {isFallback && <p className="mt-0.5 text-[10px] font-bold text-honey-700">★ Latest kickoff · auto-pick fallback</p>}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="shrink-0 rounded-full border border-espresso-200 px-[13px] py-1.5 text-[11.5px] font-bold text-espresso-800 disabled:opacity-50"
      >
        Pick
      </button>
    </div>
  );
}

function LeagueSection({ pick }: { pick: GameOfWeekPick | undefined; league: GameOfWeekPick['league'] }) {
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!pick) return null;

  function submitPick(eventId: string) {
    setError(null);
    startTransition(async () => {
      const result = await pickGameOfWeek(pick!.id, eventId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setChanging(false);
    });
  }

  const showCandidateList = pick.status === 'awaiting_pick' || (pick.status === 'picked' && changing);

  return (
    <div className="flex flex-col gap-2">
      <div className="ml-0.5 flex items-center justify-between">
        <span className="font-display text-base font-extrabold text-espresso-950">{LEAGUE_LABEL[pick.league]}</span>
        {pick.status === 'awaiting_pick' && (
          <span className="rounded-full bg-honey-100 px-2.5 py-[3px] text-[11px] font-bold text-honey-800">Awaiting your pick</span>
        )}
        {pick.status === 'picked' && (
          <span className="flex items-center gap-1 rounded-full bg-success-100 px-2.5 py-[3px] text-[11px] font-bold text-success-700">
            <CheckCircleIcon className="h-[11px] w-[11px]" /> Picked
          </span>
        )}
        {pick.status === 'published' && (
          <span className="rounded-full bg-espresso-800 px-2.5 py-[3px] text-[11px] font-bold text-paper-white">Live</span>
        )}
        {pick.status === 'skipped' && <span className="rounded-full bg-espresso-100 px-2.5 py-[3px] text-[11px] font-bold text-espresso-500">Bye week</span>}
      </div>

      {error && <p className="text-sm text-danger-700">{error}</p>}

      {pick.status === 'skipped' && <p className="rounded-2xl border border-dashed border-espresso-200 px-4 py-6 text-center text-sm text-espresso-400">No games in this week&apos;s window.</p>}

      {(pick.status === 'picked' || pick.status === 'published') && !showCandidateList && (
        <div className="rounded-2xl border border-espresso-100 bg-paper-white p-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px]',
                pick.status === 'published' ? 'bg-espresso-800 text-paper-white' : 'bg-success-100 text-success-700'
              )}
            >
              <CheckCircleIcon className="h-[17px] w-[17px]" />
            </span>
            <span className="min-w-0 flex-1">
              <p className="font-display text-base font-bold text-espresso-950">{matchupLabel(pick.candidates, pick.chosen_event_id)}</p>
              <p className="mt-0.5 text-[12.5px] text-espresso-400">
                {pick.status === 'published'
                  ? 'Live in the group now'
                  : pick.chosen_by
                    ? 'Picked, going live Tuesday morning'
                    : 'Auto-picked, going live Tuesday morning'}
              </p>
            </span>
          </div>
          {pick.status === 'published' && pick.market_id && (
            <div className="mt-3 border-t border-espresso-50 pt-3">
              <Link href={`/groups/${pick.group_id}/markets/${pick.market_id}`} className="text-[12.5px] font-bold text-honey-700">
                View market
              </Link>
            </div>
          )}
          {pick.status === 'picked' && (
            <div className="mt-3 border-t border-espresso-50 pt-3">
              <button type="button" onClick={() => setChanging(true)} className="rounded-full border border-espresso-200 px-3.5 py-1.5 text-[12.5px] font-bold text-espresso-700">
                Change pick
              </button>
            </div>
          )}
        </div>
      )}

      {showCandidateList && (
        <div className="max-h-[280px] overflow-y-auto overflow-x-hidden rounded-[18px] border border-espresso-100 bg-paper-white">
          {pick.candidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-espresso-400">No candidates this week.</p>
          ) : (
            pick.candidates.map((c, i) => (
              <CandidateRow
                key={c.event_id}
                candidate={c}
                isFallback={i === pick.candidates.length - 1}
                disabled={isPending}
                onPick={() => submitPick(c.event_id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PastPicksHistory({ picks }: { picks: GameOfWeekPick[] }) {
  if (picks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-0.5 text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">Past weeks</h2>
      <div className="overflow-hidden rounded-[18px] border border-espresso-100 bg-paper-white">
        {picks.map((p, i) => (
          <div key={p.id} className={cn('flex items-center gap-3 px-4 py-[13px]', i !== picks.length - 1 && 'border-b border-espresso-50')}>
            <span className="w-9 shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-espresso-400">{LEAGUE_LABEL[p.league]}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-espresso-800">
              {p.status === 'skipped' ? 'Bye week' : matchupLabel(p.candidates, p.chosen_event_id)}
            </span>
            <span className="shrink-0 text-[11.5px] text-espresso-400">{p.week_key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GameOfWeekPicker({ picks }: { picks: GameOfWeekPick[] }) {
  // The API returns week_key desc, league — so the first row seen for each league is that
  // league's most recent week, "this week's" row regardless of whether it's still open, already
  // picked, or already published. Everything after that first sighting is history.
  const current = new Map<GameOfWeekPick['league'], GameOfWeekPick>();
  const history: GameOfWeekPick[] = [];
  for (const p of picks) {
    if (!current.has(p.league)) current.set(p.league, p);
    else history.push(p);
  }

  if (current.size === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-espresso-200 px-6 py-10 text-center">
        <div className="text-3xl">🏈</div>
        <p className="mt-2 font-semibold text-espresso-700">Nothing to pick yet</p>
        <p className="mt-1 text-sm text-espresso-400">
          Check back Monday morning, once this week&apos;s candidates are in.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {LEAGUES.map((league) => (
        <LeagueSection key={league} league={league} pick={current.get(league)} />
      ))}
      <PastPicksHistory picks={history} />
      <div className="rounded-[13px] bg-paper-dim px-4 py-3">
        <p className="text-[12.5px] leading-[1.5] text-espresso-500">
          Nobody picks in time? The system auto-selects the latest-kickoff game so the group never goes dark.
        </p>
      </div>
    </div>
  );
}
