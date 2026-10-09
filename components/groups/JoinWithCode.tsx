'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { checkInviteCode } from '@/lib/actions/groups';
import { INVITE_CODE_LENGTH } from '@/lib/inviteCode';
import { inviteCodeFromText, inviteJoinPath } from '@/lib/inviteLink';
import { InviteCodeBoxes } from '@/components/groups/InviteCodeBoxes';
import { FooterButton, RowChevron, ScreenHeader, StickyFooter } from '@/components/ui/Screen';

/**
 * 5f: join with a code. The code is checked before leaving the screen, so a wrong one is flagged
 * under the boxes (5p) rather than on a dead-end page; a good one goes on to /join/[code], which
 * already handles the signed-out bounce through sign-up and back.
 *
 * "Scan their QR" only exists in the native app: it opens the platform's own scanner
 * (@capacitor/barcode-scanner, Capacitor's own plugin, which ships a Swift package like the rest of the iOS build).
 * A browser has no equivalent worth shipping, and the phone's own camera app already opens an
 * invite QR straight into /join/[code], so on the web the row says so instead of pretending.
 */
export function JoinWithCode({ startGroupHref }: { startGroupHref: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [native, setNative] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    setNative(Capacitor.isNativePlatform());
  }, []);

  function onCodeChange(next: string) {
    setCode(next);
    setInvalid(false);
    setError(null);
  }

  function join() {
    if (code.length !== INVITE_CODE_LENGTH) return;
    startTransition(async () => {
      const result = await checkInviteCode(code);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.data) {
        setInvalid(true);
        setError('No group with that code. Codes get reset, ask for a fresh one.');
        return;
      }
      // Tagged as a typed code so join_group's lifecycle row can tell it from a scanned QR.
      router.push(inviteJoinPath(code, 'code'));
    });
  }

  async function scan() {
    setScanError(null);
    let raw: string | undefined;
    try {
      const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import('@capacitor/barcode-scanner');
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: 'Point at the group QR',
        cancelButtonAccessibilityLabel: 'Cancel',
      });
      raw = result.ScanResult;
    } catch (e) {
      // Backing out of the scanner rejects too; only say something when it genuinely failed.
      if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) {
        setScanError("The scanner didn't open. Check camera access for barbets in Settings, or type the code.");
      }
      return;
    }
    if (!raw) return;
    const scanned = inviteCodeFromText(raw);
    if (!scanned) {
      setScanError("That QR isn't a barbets invite.");
      return;
    }
    router.push(inviteJoinPath(scanned, 'qr'));
  }

  const rowClass = 'flex w-full items-center gap-3 rounded-[18px] border border-hairline bg-surface px-[15px] py-3.5 text-left';

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <ScreenHeader title="Join a group" tile="close" fallbackHref="/" />
      <div className="mx-auto w-full max-w-[430px] px-[22px] pt-5 pb-[140px]">
        <h1 className="text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em] text-ink text-pretty">Type the group code</h1>
        <p className="mt-2 text-[13.5px] leading-[1.5] text-muted">Four characters, from anyone already in.</p>

        <div className="mt-[22px]">
          <InviteCodeBoxes onChange={onCodeChange} invalid={invalid} />
        </div>
        {error && <p className="mt-2.5 text-[12px] font-semibold text-alert">{error}</p>}

        <div className="mt-[26px] flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">or</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <div className="mt-5 flex flex-col gap-[9px]">
          {native ? (
            <button type="button" onClick={scan} className={rowClass}>
              <QrTile />
              <span className="min-w-0 flex-1 text-[14.5px] font-bold text-ink">Scan their QR</span>
              <RowChevron className="text-faint" />
            </button>
          ) : (
            <div className={rowClass}>
              <QrTile />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-ink">Scan their QR</span>
                <span className="mt-0.5 block text-[12px] leading-[1.4] text-faint">Point your phone&apos;s camera at it, the invite opens here.</span>
              </span>
            </div>
          )}
          {scanError && <p className="px-1 text-[12px] font-semibold text-muted">{scanError}</p>}
          <Link href={startGroupHref} className={rowClass}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tile text-muted">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="8" r="3.6" />
                <path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5" />
              </svg>
            </span>
            <span className="min-w-0 flex-1 text-[14.5px] font-bold text-ink">Start your own group</span>
            <RowChevron className="text-faint" />
          </Link>
        </div>
      </div>

      <StickyFooter>
        <FooterButton onClick={join} disabled={isPending || code.length !== INVITE_CODE_LENGTH}>
          {isPending ? 'Checking' : 'Join'}
        </FooterButton>
      </StickyFooter>
    </div>
  );
}

function QrTile() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tile text-muted">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
        <path d="M14 14h2M18 14h2M14 18h2M18 18h2" />
      </svg>
    </span>
  );
}
