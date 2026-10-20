// SK Study のサービスワーカー（ホーム画面に追加したとき・オフラインでも開けるように）
// 試作のあいだは変更が多いので、/study/ の中は通信優先（オフラインのときだけキャッシュ）。直してもすぐ届く
// アイコンの書体（Google Fonts）はキャッシュ優先（オフラインでもアイコンが消えないように）
// アクセスチェック（/frameworks/）・アカウント（/assets/hub/）・Firestore などほかのサイトはキャッシュしない
const CACHE_NAME = 'study-v1';
const urlsToCache = [
  '/study/',
  '/study/index.html',
  '/study/study.css',
  '/study/app.js',
  '/study/store.js',
  '/study/grade.js',
  '/study/share.js',
  '/study/speech.js',
  '/study/print.js',
  '/study/printfmt.js',
  '/study/maker.js',
  '/study/classroom.js',
  '/study/cloud.js',
  '/study/gemini.js',
  '/study/teach.js',
  '/study/sets.json',
  '/study/icon.svg',
  '/study/manifest.json',
  '/study/ico/icon-192.png',
  '/study/ico/icon-512.png',
  '/study/ico/icon-192-maskable.png',
  '/study/ico/icon-512-maskable.png',
  '/study/ico/apple-touch-icon.png',
  '/assets/fonts.js'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache.map((url) => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((name) => (name.startsWith('study-') && name !== CACHE_NAME ? caches.delete(name) : null))))
  );
  self.clients.claim();
});

function put(request, response) {
  if (response && (response.status === 200 || response.type === 'opaque')) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // 書体: キャッシュ優先
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => put(event.request, res))));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/frameworks/') || url.pathname.startsWith('/assets/hub/')) return;

  // /study/ の中と、ページ本体: 通信優先。オフラインのときだけキャッシュ（ページはホームにもどす）
  if (event.request.mode === 'navigate' || url.pathname.startsWith('/study/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => put(event.request, res))
        .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('/study/') : Response.error())))
    );
    return;
  }

  // それ以外（サイト共通の小さな部品）: キャッシュ優先。なければ取りに行ってキャッシュする
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => put(event.request, res))));
});
