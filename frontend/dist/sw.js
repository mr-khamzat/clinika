/**
 * Service Worker — Clinika Portal
 * Push notifications + offline
 */

// vK: chat push for staff (reg/manager) + click_url routing
const CACHE_NAME = 'clinika-portal-vQ-force';
// FORCE: при активации удаляем ВСЕ кэши (включая чужие, например patient-pwa-v1)
self.addEventListener('activate', function(e) { e.waitUntil(caches.keys().then(function(keys) { return Promise.all(keys.map(function(k) { return caches.delete(k); })); })); });

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Push: показываем уведомление
//   Backend шлёт payload вида {title, body, data: {...}} где в data может
//   лежать tag/icon/badge/click_url (см. push_dispatcher.py). Часть полей
//   может дублироваться и на верхнем уровне (patient pwa) — поддерживаем оба.
self.addEventListener('push', event => {
  let payload = { title: 'КлиникСеть', body: 'Новое уведомление', data: {} };
  if (event.data) {
    try { payload = { ...payload, ...JSON.parse(event.data.text()) }; } catch {}
  }
  const data = payload.data || {};
  const opts = {
    body: payload.body,
    icon: payload.icon || data.icon || '/favicon.svg',
    badge: payload.badge || data.badge || '/favicon.svg',
    vibrate: [200, 100, 200],
    data: data,
    tag: payload.tag || data.tag || 'clinika-notify',
    renotify: true,
    requireInteraction: false,
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, opts)
  );
});

// Клик: открываем нужный URL.
//   - Для уведомлений о чате клиники (staff) берём click_url=/staff-chat?thread=...
//   - Если уже есть открытое окно на /staff-chat — фокусим его и шлём ему
//     postMessage, чтобы оно само открыло нужный тред.
//   - Иначе — fallback на data.url (patient pwa) или /portal.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;
  const data = event.notification.data || {};
  const clickUrl = data.click_url || data.url || '/portal';
  const isStaffChat = clickUrl.indexOf('/staff-chat') === 0;

  event.waitUntil((async () => {
    const cls = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (isStaffChat) {
      // Пытаемся фокусить любое открытое окно StaffChat
      for (const c of cls) {
        if (c.url.includes('/staff-chat') && 'focus' in c) {
          try { c.postMessage({ type: 'open-chat-thread', thread_id: data.thread_id || null }); } catch {}
          return c.focus();
        }
      }
    } else {
      const existing = cls.find(c => c.url.includes(clickUrl) || c.url.includes('/portal'));
      if (existing && 'focus' in existing) return existing.focus();
    }
    if (clients.openWindow) return clients.openWindow(clickUrl);
  })());
});
