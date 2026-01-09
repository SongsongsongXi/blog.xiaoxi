const CACHE_NAME = 'blog-cache-v1';
const ASSETS = [
  '/',
  '/static/app.css',
  '/static/app.js',
  '/static/highlight.min.js',
  '/static/translate.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // 仅处理 GET 请求
  if (e.request.method !== 'GET') return;
  
  // 忽略非 http/https 协议（如 chrome-extension://）
  if (!e.request.url.startsWith('http')) return;

  const url = new URL(e.request.url);
  // 忽略 API 请求（API 有自己的缓存策略）
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      // Stale-while-revalidate 策略
      const networkFetch = fetch(e.request).then((networkResp) => {
        // 仅缓存成功响应且为 basic 类型（同源）
        if (networkResp && networkResp.status === 200 && networkResp.type === 'basic') {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResp;
      });

      if (cached) {
        // 命中缓存：直接返回缓存，后台静默更新
        networkFetch.catch(() => {}); 
        return cached;
      }

      // 未命中缓存：返回网络请求（若失败则抛出错误，由浏览器处理）
      return networkFetch;
    })
  );
});
