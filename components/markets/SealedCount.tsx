export function SealedCount({ count }: { count: number }) {
  return (
    <p className="inline-flex items-center gap-1.5 rounded-full bg-espresso-50 px-3 py-1 text-sm font-medium text-espresso-600">
      🤫 {count} {count === 1 ? 'bet' : 'bets'} placed
    </p>
  );
}
