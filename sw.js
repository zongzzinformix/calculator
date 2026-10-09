/* Service Worker：讓 App 可以離線使用
   策略：網路優先（network-first）
   - 連得到伺服器時，永遠拿最新檔案（改程式馬上生效）
   - 連不到時，才用快取（離線也能用）
*/
const CACHE = 'calc-v7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 匯率 API 交給瀏覽器處理（失敗時程式會用預設值）
  if (req.url.includes('open.er-api.com')) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        // 成功抓到最新檔案 -> 順手更新快取
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)) // 離線時回退到快取
  );
});
