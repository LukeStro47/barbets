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
      // Non-navigation requests (data/RSC fetches, images) just fail, since there's nothing sane
      // to substitute for them.
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || (event.request.mode === 'navigate' ? caches.match('/offline') : undefined))
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
