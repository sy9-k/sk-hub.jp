const CACHE_NAME = 'qr-airdrop-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  // 多言語（QR Drop は日本語と英語。オフラインでも選んだ言語で表示できるように）
  '/assets/i18n.js',
  '/assets/i18n/en.js',
  // 文字のフォントは、EU などでは読み込まないので先に取りに行かない（/assets/fonts.js が地域で判断する）
  '/assets/fonts.js',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // SK Hub Systems のアクセスチェック（/frameworks/ と Firestore）・アカウント（/assets/hub/・/y-filter/）はキャッシュしない。
  // キャッシュすると、ブロックの解除や check.js・アカウントの更新が反映されなくなるため。
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/frameworks/') || url.hostname === 'firestore.googleapis.com'
    || (url.origin === self.location.origin && (url.pathname.startsWith('/assets/hub/') || url.pathname.startsWith('/y-filter/')))) return;

  // 多言語の辞書（/assets/i18n...）は、訳の更新がすぐ届くように通信優先（オフラインのときだけキャッシュ）
  // アクセス解析（/assets/analytics.js）も同じ（測定 ID や設定の変更がすぐ届くように）
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/i18n') || url.pathname === '/assets/analytics.js')) {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(e.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return response;
      });
    })
  );
});