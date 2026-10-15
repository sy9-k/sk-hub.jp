// 選曲リモコン（/lyrics/remote/）の Service Worker
//   ・画面（HTML とアイコン）だけを置いておき、ホーム画面から開いたときにすぐ出す
//   ・HTML はネットにつながっていれば新しいものを使う（つながらないときだけ置いてあるもの）
//   ・Spotify・LRCLIB・フォントなど、ほかのサイトへの通信には手を出さない
const CACHE_NAME = 'lf-remote-v1';
const ASSETS = [
  '/lyrics/remote/',
  '/lyrics/remote/manifest.webmanifest',
  '/lyrics/remote/icon-192.png',
  '/lyrics/remote/icon-512.png',
  '/lyrics/remote/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lf-remote-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/lyrics/remote/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put('/lyrics/remote/', copy));
      return res;
    }).catch(() => caches.match('/lyrics/remote/')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
