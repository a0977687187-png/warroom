// 家祥投資戰情室 - Service Worker
// 目的：快取「畫面外殼」（HTML/圖示），讓 App 在弱網路下仍能開啟；
// 資料（股價、雲端同步）一律走網路，不快取，避免看到過期數字。

const CACHE_NAME = 'jiaxiang-warroom-v8-0-strategy-1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // 任何一個檔案抓不到也不要讓整個安裝失敗
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 對 Apps Script / Google Sheet / Gemini API 的請求，一律直接打網路，不做快取
  const isDataRequest = url.hostname.includes('script.google.com') ||
                         url.hostname.includes('docs.google.com') ||
                         url.hostname.includes('googleapis.com');

  if (isDataRequest || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({ status: 'error', message: '離線中，無法連線雲端' }), { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // App shell：先試網路拿最新版，失敗才退回快取（確保平常改版能即時生效）
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
