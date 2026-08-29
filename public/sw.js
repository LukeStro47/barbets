// Barbets service worker: app-shell precache for the offline fallback,
// network-first for everything else (this app is almost entirely dynamic,
// server-rendered data — a stale cached market page showing wrong odds or
// an already-placed bet would be actively misleading, so we'd rather show
// nothing offline than something wrong), plus push notification handling.

// The offline fallback's artwork is precached by raw path because that page renders it as a plain
// <img> (next/image's optimizer endpoint is a network request that isn't cached, so it would break
// offline). It's the coin, not the lockup, since the redesign — bump CACHE_NAME whenever this list
// changes or an already-installed worker keeps serving the old set.
const CACHE_NAME = 'barbets-shell-v7';
const SHELL_URLS = ['/', '/offline', '/icon-192.png', '/icon-512.png', '/barbets-coin.png', '/badge-mono.png'];

// A guaranteed last resort for a failed navigation when even the precached `/offline` page isn't
// available (the precache is Promise.allSettled - one failed asset can't block install, but that
// means it's also possible for /offline itself to be the one that failed, e.g. a device that first
// installed this worker during the very network trouble this page exists to explain). Without this,
// that combination fell through to Response.error(), an opaque network-error response with no page
// behind it at all - the browser logs "resulted in a network error response" and the user sees a
// dead tab instead of any explanation. Inline and self-contained on purpose, same reasoning
// offline.html gives: it can't depend on anything else having successfully cached. Kept in sync
// with app/offline/page.tsx's copy split (offline vs. "this is on us") where it reasonably can be.
function fallbackOfflineResponse() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<title>Barbets</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: #faf6ef; color: #705441; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 40px 20px calc(env(safe-area-inset-bottom) + 40px); padding-top: calc(env(safe-area-inset-top) + 40px); }
  h1 { font-size: 30px; line-height: 34px; font-weight: 800; letter-spacing: -0.03em; color: #2c1f17; margin: 0; }
  p { max-width: 310px; font-size: 16px; line-height: 24px; margin: 12px 0 0; }
  button { margin-top: 28px; width: 100%; max-width: 330px; padding: 16px 24px; border: 1px solid #cbb6a2; border-radius: 999px; background: transparent; color: #2c1f17; font-size: 17px; font-weight: 700; font-family: inherit; cursor: pointer; }
</style></head>
<body>
<h1 id="headline">You're offline.</h1>
<p id="body">Odds and balances move too fast to show you a guess. Reconnect and we'll pick up where you left off.</p>
<button id="retry">Try again</button>
<script>
  function retry() { window.location.reload(); }
  document.getElementById('retry').addEventListener('click', retry);
  window.addEventListener('online', retry);
  if (navigator.onLine) {
    document.getElementById('headline').textContent = "We're having trouble.";
    document.getElementById('body').textContent = 'Your connection looks fine, so this is on us. Hang tight and try again in a minute.';
  }
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // cache.addAll() aborts entirely if even one URL fails to fetch —
      // that would leave the whole service worker stuck uninstalled (and
      // Chrome's install-criteria check requires an *activated* worker with
      // a fetch handler, so a silently-failed install could plausibly be
      // why the install prompt never appeared). Each URL is cached
      // independently instead, so one bad asset can't block the rest.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache same-origin, successful, static-looking responses —
        // never cache API/RSC data responses, which must always be fresh.
        const url = new URL(event.request.url);
        const isStaticAsset = SHELL_URLS.includes(url.pathname) || url.pathname.startsWith('/_next/static/');
        if (isStaticAsset && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      // A failed page navigation (offline, DNS down, etc.) should land on the dedicated offline
      // page, not a stale snapshot of the marketing landing page from install time, which for a
      // logged-in visitor makes no sense and reads as a broken app rather than "you're offline."
      // Non-navigation requests (data/RSC fetches, images, third-party scripts) just fail, since
      // there's nothing sane to substitute for them - but respondWith() must always get back a
      // real Response. Falling through to `undefined` here (as this used to) throws "Failed to
      // convert value to 'Response'" and takes the whole page down with it, so every branch below
      // ends in a Response one way or another: the cached copy, the offline page, or a network
      // error Response standing in for "this fetch genuinely failed."
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/offline').then((offline) => offline || fallbackOfflineResponse());
          return Response.error();
        })
      )
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const { title, body, url } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      // Android's status-bar/tray "small icon" is always rendered as a
      // solid-tint silhouette from the alpha channel alone — a full-color
      // icon there just shows up as an odd filled rounded square. This
      // needs a dedicated mostly-transparent monochrome asset, not the
      // regular app icon (which `icon` above still uses, for the larger
      // expanded-notification image on platforms that show one).
      badge: '/badge-mono.png',
      data: { url: url || '/groups' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/groups';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      for (const client of clients) {
        if ('navigate' in client && 'focus' in client) return client.navigate(targetUrl).then(() => client.focus());
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
