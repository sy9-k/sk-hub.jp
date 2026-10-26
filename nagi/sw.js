// Nagi のサービスワーカー（ホーム画面に追加したとき・オフラインでも開けるように）
// 画面の部品は先にキャッシュし、ページ本体は通信優先（オフラインのときだけキャッシュ）。
// 他サイト（Firestore・Google Fonts など）・アクセスチェック（/frameworks/）・アカウント（/assets/hub/）はキャッシュしない
const CACHE_NAME = 'nagi-v13';
const urlsToCache = [
  '/nagi/',
  '/nagi/index.html',
  '/nagi/styles.css',
  '/nagi/app.js',
  '/nagi/account.js',
  '/nagi/manifest.json',
  '/nagi/sound/break.mp3',
  '/nagi/ico/icon-192.png',
  '/nagi/ico/badge-96.png',
  '/nagi/ico/icon-512.png',
  '/nagi/ico/icon-192-maskable.png',
  '/nagi/ico/icon-512-maskable.png',
  '/nagi/ico/apple-touch-icon.png',
  '/assets/fonts.js',
  '/assets/hub/account-button.js',
  '/assets/logo.svg',
  // 多言語（オフラインでも選んだ言語で表示できるように）
  '/assets/i18n.js',
  '/assets/i18n/en.js',
  '/assets/i18n/zh-CN.js',
  '/assets/i18n/zh-TW.js',
  '/assets/i18n/ko.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache.map((url) => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((name) => (name !== CACHE_NAME ? caches.delete(name) : null))))
  );
  self.clients.claim();
});

// 通知を押したら、Nagi の画面を前に出す
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith('/nagi/'));
      return open ? open.focus() : self.clients.openWindow('/nagi/');
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/frameworks/') || url.pathname.startsWith('/assets/hub/')) return;

  // ページ本体・多言語の辞書・アクセス解析は通信優先（更新がすぐ届くように）。オフラインのときだけキャッシュ
  if (event.request.mode === 'navigate' || url.pathname.startsWith('/assets/i18n') || url.pathname === '/assets/analytics.js') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/nagi/')))
    );
    return;
  }

  // それ以外（CSS・JS・アイコン）はキャッシュ優先。なければ取りに行ってキャッシュする
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
