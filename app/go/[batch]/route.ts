import { NextRequest, NextResponse } from 'next/server';

// Printed QR codes point at https://mybarbets.com/go/<batch> — that URL is what's on the card,
// so it must never change. Everything about *where it sends people* (store links, once Apple's
// listing is live; which fallback while pending) lives here instead, behind env vars, so a store
// going live or a redirect changing is a config/redeploy, never a reprint.
//
// `batch` (e.g. "card") identifies the print run and is forwarded to the Play Store as an install
// referrer — Android's Play Install Referrer API lets the app read it back after install, which is
// real per-batch attribution with no third-party service. Apple has no equivalent until the App
// Store listing exists and campaign links are set up, so iOS just falls back like desktop for now.
const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.mybarbets.app';
const APPLE_APP_STORE_URL = process.env.APPLE_APP_STORE_URL; // unset until Apple review clears

export async function GET(request: NextRequest, { params }: { params: Promise<{ batch: string }> }) {
  const { batch } = await params;
  const userAgent = request.headers.get('user-agent') ?? '';
  const isAndroid = /android/i.test(userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);

  let destination: string;
  if (isAndroid) {
    const referrer = encodeURIComponent(`utm_source=qr&utm_medium=print&utm_campaign=${batch}`);
    destination = `${GOOGLE_PLAY_URL}&referrer=${referrer}`;
  } else if (isIOS && APPLE_APP_STORE_URL) {
    destination = `${APPLE_APP_STORE_URL}?pt=qr&ct=${encodeURIComponent(batch)}`;
  } else {
    // iOS while Apple's listing is pending, and any non-mobile scan (desktop camera, etc).
    destination = `https://mybarbets.com/how-it-works?src=qr-${batch}`;
  }

  return NextResponse.redirect(destination, 307);
}
