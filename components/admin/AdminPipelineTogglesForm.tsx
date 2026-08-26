'use client';

import { useState, useTransition } from 'react';
import { setPipelineEnabled, type PipelineHealth, type PipelineSetting } from '@/lib/actions/admin';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const PIPELINE_LABEL: Record<PipelineSetting['pipeline'], string> = {
  sports: 'Sports (The Odds API)',
  weather: 'Weather (api.weather.gov)',
};

const PIPELINE_SCHEDULE: Record<PipelineSetting['pipeline'], string> = {
  sports: 'Creates markets every 12h, resolves every 30min',
  weather: 'Creates markets daily at noon, resolves every 30min',
};

const PIPELINE_API: Record<PipelineSetting['pipeline'], string> = {
  sports: 'The Odds API',
  weather: 'api.weather.gov',
};

const JOB_LABEL: Record<PipelineHealth['job'], string> = { create: 'Create', resolve: 'Resolve' };

// How long a job can go without a logged run before its silence itself counts as a problem, not
// just its failures — a cron entry that got disabled or an Edge Function that stopped deploying
// leaves sweep_failures empty (nothing ran to fail), which would otherwise read as healthy. Set to
// roughly 3x each job's own schedule interval, generous enough that one missed tick doesn't flap
// the badge.
const STALE_AFTER_MINUTES: Record<PipelineSetting['pipeline'], Record<PipelineHealth['job'], number>> = {
  sports: { create: 12 * 60 * 2, resolve: 90 },
  weather: { create: 24 * 60 * 2, resolve: 90 },
};

function minutesAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

function formatAgo(iso: string): string {
  const mins = minutesAgo(iso);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type Status = 'off' | 'failing' | 'stale' | 'healthy' | 'unknown';

function pipelineStatus(pipeline: PipelineSetting['pipeline'], enabled: boolean, jobs: PipelineHealth[]): Status {
  if (!enabled) return 'off';
  if (jobs.length === 0) return 'unknown';
  if (jobs.some((j) => j.open_failure_count > 0)) return 'failing';
  if (jobs.some((j) => !j.last_run_at || minutesAgo(j.last_run_at) > STALE_AFTER_MINUTES[pipeline][j.job])) return 'stale';
  return 'healthy';
}

const STATUS_BADGE: Record<Status, { label: string; className: string }> = {
  off: { label: 'Off', className: 'bg-espresso-100 text-espresso-500' },
  failing: { label: 'Failing', className: 'bg-danger-100 text-danger-700' },
  stale: { label: 'Stale', className: 'bg-honey-100 text-honey-800' },
  healthy: { label: 'Healthy', className: 'bg-success-100 text-success-700' },
  unknown: { label: 'No runs yet', className: 'bg-espresso-100 text-espresso-500' },
};

export function AdminPipelineTogglesForm({ settings, health }: { settings: PipelineSetting[]; health: PipelineHealth[] }) {
  const [rows, setRows] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<{ pipeline: PipelineSetting['pipeline']; next: boolean } | null>(null);

  function confirmToggle() {
    if (!confirming) return;
    const { pipeline, next } = confirming;
    setError(null);
    startTransition(async () => {
      const result = await setPipelineEnabled(pipeline, next);
      if (result.error) {
        setError(result.error);
      } else {
        setRows((prev) => prev.map((r) => (r.pipeline === pipeline ? { ...r, enabled: next } : r)));
      }
      setConfirming(null);
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="divide-y divide-espresso-50 rounded-xl border border-espresso-100">
        {rows.map((r) => {
          const jobs = health.filter((h) => h.pipeline === r.pipeline);
          const status = pipelineStatus(r.pipeline, r.enabled, jobs);
          const badge = STATUS_BADGE[status];

          return (
            <div key={r.pipeline} className="space-y-2 px-3 py-2.5">
              <label className="flex items-center justify-between gap-3">
                <span className="flex flex-col">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-espresso-800">{PIPELINE_LABEL[r.pipeline]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
                  </span>
                  <span className="text-xs text-espresso-400">
                    {r.enabled ? `On. ${PIPELINE_SCHEDULE[r.pipeline]}.` : 'Off. Scheduled runs no-op, nothing is created or resolved.'}
                  </span>
                </span>
                <input
                  type="checkbox"
                  disabled={isPending}
                  checked={r.enabled}
                  onChange={(e) => setConfirming({ pipeline: r.pipeline, next: e.target.checked })}
                  className="h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
                />
              </label>

              {jobs.length > 0 && (
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-espresso-50/60 px-2.5 py-2 text-xs text-espresso-500">
                  {jobs.map((j) => (
                    <div key={j.job}>
                      <p className="font-semibold text-espresso-700">{JOB_LABEL[j.job]}</p>
                      {j.last_run_at ? (
                        <p>
                          {formatAgo(j.last_run_at)}: {j.last_run_succeeded ?? 0} ok, {j.last_run_failed ?? 0} failed
                        </p>
                      ) : (
                        <p>Never run</p>
                      )}
                      {j.open_failure_count > 0 && (
                        <p className="text-danger-600">
                          {j.open_failure_count} stuck failure{j.open_failure_count === 1 ? '' : 's'}
                          {j.last_failure_message ? `: ${j.last_failure_message}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {confirming && (
        <Modal onClose={() => setConfirming(null)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">
            {confirming.next ? `Turn on ${PIPELINE_LABEL[confirming.pipeline]}?` : `Turn off ${PIPELINE_LABEL[confirming.pipeline]}?`}
          </p>
          <p className="text-sm leading-[1.55] text-espresso-600">
            {confirming.next
              ? `This starts real calls to ${PIPELINE_API[confirming.pipeline]} and creates real markets in the public ${
                  confirming.pipeline === 'sports' ? 'Sports' : 'Weather'
                } group on schedule (${PIPELINE_SCHEDULE[confirming.pipeline].toLowerCase()}).`
              : 'Scheduled runs stop immediately, nothing new is created or resolved. Anything already open in this pipeline just sits unresolved until you turn it back on or resolve it by hand.'}
          </p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirming.next ? 'primary' : 'danger'}
              className="flex-1"
              disabled={isPending}
              onClick={confirmToggle}
            >
              {confirming.next ? 'Turn on' : 'Turn off'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
