import { NextRequest, NextResponse } from 'next/server';
import { GOOGLE_PLAY_URL, APPLE_APP_STORE_URL } from '@/lib/appStores';

// Printed QR codes point at https://mybarbets.com/go/<batch> — that URL is what's on the card,
// so it must never change. Everything about *where it sends people* (the store links in
// lib/appStores.ts) lives here instead, so a store link changing is a code change and redeploy,
// never a reprint.
//
// `batch` (e.g. "card") identifies the print run and is forwarded to the Play Store as an install
// referrer — Android's Play Install Referrer API lets the app read it back after install, which is
// real per-batch attribution with no third-party service. Apple has no equivalent, so the iOS
// branch below appends its own `pt`/`ct` query params instead.

export async function GET(request: NextRequest, { params }: { params: Promise<{ batch: string }> }) {
  const { batch } = await params;
  const userAgent = request.headers.get('user-agent') ?? '';
  const isAndroid = /android/i.test(userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);

  let destination: string;
  if (isAndroid) {
    const referrer = encodeURIComponent(`utm_source=qr&utm_medium=print&utm_campaign=${batch}`);
    destination = `${GOOGLE_PLAY_URL}&referrer=${referrer}`;
  } else if (isIOS) {
    destination = `${APPLE_APP_STORE_URL}?pt=qr&ct=${encodeURIComponent(batch)}`;
  } else {
    // Any non-mobile scan (desktop camera, etc).
    destination = `https://mybarbets.com/how-it-works?src=qr-${batch}`;
  }

  return NextResponse.redirect(destination, 307);
}
