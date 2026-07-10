export function SealedCount({ count, volume }: { count: number; volume?: number }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full bg-espresso-50 px-3 py-1 text-sm font-medium text-espresso-600">
      🤫 {count} {count === 1 ? 'bet' : 'bets'} placed
      {volume !== undefined && volume > 0 && <span className="text-espresso-400">· {volume} tokens</span>}
    </p>
  );
}
