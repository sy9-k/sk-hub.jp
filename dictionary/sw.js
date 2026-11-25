const CACHE_NAME = 'dictionary-v20';
const urlsToCache = [
  '/dictionary/',
  '/dictionary/index.html',
  '/dictionary/result/',
  '/dictionary/result/result.css',
  '/dictionary/result/result.js',
  '/dictionary/styles.css',
  '/dictionary/script.js',
  '/dictionary/account.js',
  '/dictionary/offline.html',
  '/assets/hub/account-button.js',
  '/assets/logo.svg',
  '/dictionary/manifest.json',
  '/dictionary/ico/icon-192.png',
  '/dictionary/ico/icon-512.png',
  '/dictionary/ico/icon192-maskble.png',
  '/dictionary/ico/icon-512-maskble.png',
  // 多言語（オフラインでも選んだ言語で表示できるように）
  '/assets/i18n.js',
  '/assets/i18n/en.js',
  '/assets/i18n/zh-CN.js',
  '/assets/i18n/zh-TW.js',
  '/assets/i18n/ko.js'
];

// インストール時にキャッシュを作成
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ブラウザの HTTP キャッシュに古いファイルが残っていても、新しいものを取り直す
      return cache.addAll(urlsToCache.map((url) => new Request(url, { cache: 'reload' })));
    })
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ネットワークファースト + キャッシュフォールバック戦略
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  // 他サイト（Firestore など）と SK Hub Systems のアクセスチェック（/frameworks/）・アカウント（/assets/hub/・/y-filter/）はキャッシュしない。
  // キャッシュすると、ブロックの解除や check.js・アカウントの更新が反映されなくなるため。
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/frameworks/')
    || url.pathname.startsWith('/assets/hub/') || url.pathname.startsWith('/y-filter/')) {
    return;
  }

  // 多言語の辞書（/assets/i18n...）は、訳の更新がすぐ届くように通信優先（オフラインのときだけキャッシュ）
  // アクセス解析（/assets/analytics.js）も同じ（測定 ID や設定の変更がすぐ届くように）
  if (url.pathname.startsWith('/assets/i18n') || url.pathname === '/assets/analytics.js') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match('/dictionary/offline.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request));
    })
  );
});
