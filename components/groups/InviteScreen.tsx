'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { regenerateInviteCode } from '@/lib/actions/groups';
import { inviteQrUrl, inviteUrl } from '@/lib/inviteLink';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export interface InviteJoiner {
  userId: string;
  nickname: string;
  joinedAt: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
}

function joinedAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The QR as 5m draws it: rounded modules, the three finder squares as ink frames with a signal
 * centre, and the b tile over the middle. Built from the real QR matrix at high error correction
 * (H tolerates ~30% loss, comfortably more than the tile covers), so it still scans.
 */
function InviteQr({ code, size = 212 }: { code: string; size?: number }) {
  const matrix = useMemo(() => {
    const qr = QRCode.create(inviteQrUrl(code), { errorCorrectionLevel: 'H' });
    const n = qr.modules.size;
    const cells: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      cells.push([]);
      for (let c = 0; c < n; c++) cells[r].push(!!qr.modules.get(r, c));
    }
    return { n, cells };
  }, [code]);

  const { n, cells } = matrix;
  const cell = size / n;
  const inFinder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const centre = Math.floor(n / 2);
  const tileCells = Math.ceil(n * 0.22);
  const inTile = (r: number, c: number) => Math.abs(r - centre) <= tileCells / 2 && Math.abs(c - centre) <= tileCells / 2;
  const finders = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  const tileSize = size * 0.23;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Invite QR code" role="img">
        {cells.flatMap((row, r) =>
          row.map((on, c) =>
            on && !inFinder(r, c) && !inTile(r, c) ? (
              <rect key={`${r}-${c}`} x={c * cell + cell * 0.08} y={r * cell + cell * 0.08} width={cell * 0.84} height={cell * 0.84} rx={cell * 0.22} fill="#0c1018" />
            ) : null
          )
        )}
        {finders.map(([r, c]) => (
          <g key={`${r}-${c}`}>
            <rect x={c * cell + cell / 2} y={r * cell + cell / 2} width={cell * 6} height={cell * 6} rx={cell * 1.6} fill="none" stroke="#0c1018" strokeWidth={cell} />
            <rect x={(c + 2) * cell} y={(r + 2) * cell} width={cell * 3} height={cell * 3} rx={cell * 0.8} fill="#2d55f5" />
          </g>
        ))}
      </svg>
      <span
        className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[14px] border-4 border-surface bg-signal"
        style={{ width: tileSize, height: tileSize }}
      >
        <span className="font-extrabold tracking-[-0.05em] text-surface" style={{ fontSize: tileSize * 0.52, lineHeight: 1, marginTop: -2 }}>
          b
        </span>
      </span>
    </div>
  );
}

async function shareLink(groupName: string, code: string): Promise<'shared' | 'copied'> {
  const url = inviteUrl(code, 'link');
  const title = `Join ${groupName}`;
  const text = `Join ${groupName} on Barbets. Invite code ${code}`;
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, url });
      return 'shared';
    } catch {
      // fall through to the web share/copy paths
    }
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}

/**
 * 5m: hand the code out. The QR, the four-character code, Share link / Copy code, the link itself
 * with a Copy, then who has joined lately and a line on resetting the code. Used by the invite
 * route and as the last step of creating a group.
 */
export function InviteScreen({
  groupId,
  groupName,
  inviteCode,
  joiners,
  canReset,
}: {
  groupId: string;
  groupName: string;
  inviteCode: string;
  joiners: InviteJoiner[];
  canReset: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState<'code' | 'link' | 'share' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const displayLink = inviteUrl(inviteCode).replace(/^https?:\/\//, '');

  return (
    <div>
      <div className="rounded-[24px] border border-hairline bg-surface p-[22px] shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
        <InviteQr code={inviteCode} />
        <p className="mt-5 text-center text-[11px] font-bold tracking-[0.1em] text-faint uppercase">Or type the code</p>
        <div className="mt-2.5 flex gap-2">
          {inviteCode.split('').map((ch, i) => (
            <span key={i} className="flex h-[58px] flex-1 items-center justify-center rounded-[15px] border border-hairline bg-canvas font-mono text-[26px] font-semibold text-ink">
              {ch}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-[9px]">
        <button
          type="button"
          onClick={async () => setCopied((await shareLink(groupName, inviteCode)) === 'copied' ? 'share' : null)}
          className="flex flex-1 items-center justify-center gap-[9px] rounded-2xl bg-ink py-3.5 text-[14px] font-bold text-surface"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 16V4M8 8l4-4 4 4" />
            <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
          </svg>
          {copied === 'share' ? 'Link copied' : 'Share link'}
        </button>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(inviteCode);
            setCopied('code');
          }}
          className="flex flex-1 items-center justify-center gap-[9px] rounded-2xl border border-hairline bg-surface py-3.5 text-[14px] font-bold text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="9" width="11" height="11" rx="2.5" />
            <path d="M15 6H6a2 2 0 0 0-2 2v9" />
          </svg>
          {copied === 'code' ? 'Copied' : 'Copy code'}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-[18px] border border-hairline bg-surface px-[15px] py-3.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted">{displayLink}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(inviteUrl(inviteCode, 'link'));
            setCopied('link');
          }}
          className="shrink-0 text-[12.5px] font-bold text-signal"
        >
          {copied === 'link' ? 'Copied' : 'Copy'}
        </button>
      </div>

      {joiners.length > 0 && (
        <>
          <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Who has used it</p>
          <div className="mt-[9px] rounded-[18px] border border-hairline bg-surface px-[15px] py-1">
            {joiners.map((j, i) => (
              <div key={j.userId} className={i < joiners.length - 1 ? 'flex items-center gap-[11px] border-b border-rule py-3' : 'flex items-center gap-[11px] py-3'}>
                <UserAvatar
                  userId={j.userId}
                  nickname={j.nickname}
                  avatarUpdatedAt={j.avatarUpdatedAt}
                  avatarPresetKey={j.avatarPresetKey}
                  className="h-[30px] w-[30px] text-[11px]"
                  fallbackClassName="bg-tile text-muted"
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{j.nickname}</span>
                <span className="text-[11.5px] text-faint">{joinedAgo(j.joinedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {error && <p className="mt-3 text-[12px] font-semibold text-alert">{error}</p>}
      <p className="mt-[11px] text-[11.5px] leading-[1.5] text-faint text-pretty">
        Anyone with the code can join.
        {canReset && (
          <>
            {' '}
            <button type="button" onClick={() => setConfirming(true)} className="font-semibold text-signal">
              Reset it
            </button>{' '}
            if it gets out.
          </>
        )}
      </p>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">Reset the invite code?</p>
          <p className="text-sm leading-[1.5] text-muted">The old code stops working. Anyone already in the group stays in.</p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await regenerateInviteCode(groupId);
                  setConfirming(false);
                  if (result.error) setError(result.error);
                  else router.refresh();
                })
              }
            >
              Reset
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
