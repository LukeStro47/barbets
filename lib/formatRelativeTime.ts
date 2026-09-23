/** "2h ago" / "40m ago" / "3d ago" for a past ISO timestamp — the comment-thread counterpart
 *  to CountdownTimer's future-facing "closes in". Deliberately coarse (minutes/hours/days only,
 *  no seconds) since a comment thread is read, not watched live the way a closing timer is. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const deltaMs = now - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
