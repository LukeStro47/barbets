/**
 * True when `error` is the browser saying a request never got an answer, rather than the app
 * doing something wrong. Every engine phrases it differently and none give it a distinct type:
 * all three are a bare TypeError from fetch(), which is what a Server Action call or an RSC
 * request is underneath.
 *
 * The common way to produce one in this app is an installed PWA on iOS: Safari suspends the
 * page's network when it goes to the background, so a tap that started a Server Action just
 * before the user switched away (or a flaky cell signal) rejects with "Load failed". That
 * rejection lands inside a startTransition, which React rethrows to the nearest error boundary,
 * which here is global-error.tsx.
 *
 * Client-safe on purpose (no 'server-only'): global-error.tsx uses it to pick its copy, and
 * lib/actions/errorReport.ts uses it to keep these out of Slack.
 */
const NETWORK_ERROR_MESSAGES = [
  'load failed', // Safari / WebKit, including every iOS browser
  'failed to fetch', // Chrome / Chromium
  'networkerror when attempting to fetch resource.', // Firefox
  'the network connection was lost.', // older Safari
  'the internet connection appears to be offline.', // older Safari
  'network request failed',
];

export function isNetworkError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error || error.name !== 'TypeError') return false;
  return NETWORK_ERROR_MESSAGES.includes((error.message ?? '').trim().toLowerCase());
}
