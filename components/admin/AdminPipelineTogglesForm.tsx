'use client';

import { useState, useTransition } from 'react';
import { setPipelineEnabled, type PipelineSetting } from '@/lib/actions/admin';

const PIPELINE_LABEL: Record<PipelineSetting['pipeline'], string> = {
  sports: 'Sports (The Odds API)',
  weather: 'Weather (api.weather.gov)',
};

const PIPELINE_SCHEDULE: Record<PipelineSetting['pipeline'], string> = {
  sports: 'Creates markets every 12h, resolves every 30min',
  weather: 'Creates markets daily at noon, resolves every 30min',
};

/** The kill switch for the two auto-generated market pipelines. Each Edge Function checks its own
    row before creating or resolving anything, so flipping this off here stops new markets without
    a redeploy. Seeded off — see 20260826130000_pipeline_settings.sql. */
export function AdminPipelineTogglesForm({ settings }: { settings: PipelineSetting[] }) {
  const [rows, setRows] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(pipeline: PipelineSetting['pipeline'], next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setPipelineEnabled(pipeline, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRows((prev) => prev.map((r) => (r.pipeline === pipeline ? { ...r, enabled: next } : r)));
    });
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="divide-y divide-espresso-50 rounded-xl border border-espresso-100">
        {rows.map((r) => (
          <label key={r.pipeline} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-espresso-800">{PIPELINE_LABEL[r.pipeline]}</span>
              <span className="text-xs text-espresso-400">
                {r.enabled
                  ? `On. ${PIPELINE_SCHEDULE[r.pipeline]}.`
                  : 'Off. Scheduled runs no-op, nothing is created or resolved.'}
              </span>
            </span>
            <input
              type="checkbox"
              disabled={isPending}
              checked={r.enabled}
              onChange={(e) => toggle(r.pipeline, e.target.checked)}
              className="h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
