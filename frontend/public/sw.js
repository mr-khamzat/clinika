/**
 * Service Worker — Clinika Portal
 * Push notifications + offline
 */

// v5 (2026-05-22): WhatsApp deep-link для направлений optimization — bump чтобы юзеры получили новые chunks.
const CACHE_NAME = 'clinika-portal-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Push: показываем уведомление
self.addEventListener('push', event => {
  let payload = { title: 'КлиникСеть', body: 'Новое уведомление', data: {} };
  if (event.data) {
    try { payload = { ...payload, ...JSON.parse(event.data.text()) }; } catch {}
  }
  const opts = {
    body: payload.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    vibrate: [200, 100, 200],
    data: payload.data || {},
    tag: payload.tag || 'clinika-notify',
    renotify: true,
    requireInteraction: false,
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, opts)
  );
});

// Клик: открываем нужный URL
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;
  const url = event.notification.data?.url || '/portal';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      const existing = cls.find(c => c.url.includes(url) || c.url.includes('/portal'));
      if (existing) { existing.focus(); return; }
      clients.openWindow(url);
    })
  );
});
