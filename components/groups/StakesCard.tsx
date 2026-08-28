/** What's actually on the line: group_settings.prize_text / punishment_text, shown as plain text
    rather than hidden behind a "Set"/"None" pill like join_message is — the whole point is that
    everyone reads it at a glance, not that it's revealed at some later moment. Renders nothing
    when neither is set, so callers can drop it in unconditionally. */
export function StakesCard({ prizeText, punishmentText }: { prizeText: string | null; punishmentText: string | null }) {
  if (!prizeText && !punishmentText) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-espresso-100 bg-paper-white p-4">
      {prizeText && (
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 text-lg leading-none">🏆</span>
          <p className="min-w-0 flex-1 text-sm text-espresso-700">
            <span className="font-bold text-espresso-900">Prize: </span>
            {prizeText}
          </p>
        </div>
      )}
      {punishmentText && (
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 text-lg leading-none">💀</span>
          <p className="min-w-0 flex-1 text-sm text-espresso-700">
            <span className="font-bold text-espresso-900">Punishment: </span>
            {punishmentText}
          </p>
        </div>
      )}
    </div>
  );
}
