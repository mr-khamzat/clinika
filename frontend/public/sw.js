/**
 * Service Worker — Clinika Patient Cabinet
 * Handles: Push notifications, offline cache
 */

const CACHE_NAME = 'clinika-v1';
const OFFLINE_URLS = ['/clinika/', '/clinika/index.html'];

// Install: cache essential pages
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(OFFLINE_URLS).catch(() => {})
    )
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Push event: show notification
self.addEventListener('push', event => {
  let payload = { title: 'КлиникаСеть', body: 'Новое уведомление', data: {} };
  if (event.data) {
    try { payload = JSON.parse(event.data.text()); } catch {}
  }

  const opts = {
    body: payload.body,
    icon: '/clinika/icon-192.png',
    badge: '/clinika/icon-192.png',
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'Открыть кабинет' },
      { action: 'close', title: 'Закрыть' },
    ],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'КлиникаСеть', opts)
  );
});

// Notification click: open the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const url = event.notification.data?.url || '/clinika/';
      const existing = cls.find(c => c.url.includes('/clinika/'));
      if (existing) {
        existing.focus();
        existing.navigate(url);
      } else {
        clients.openWindow(url);
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'sync-referrals') {
    // future: sync offline actions
  }
});
