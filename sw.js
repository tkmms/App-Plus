/* アプリ＋ オフライン用 Service Worker
   このファイルをHTMLと同じフォルダ（同じ階層）に置いてください。 */
const CACHE = 'app-plus-shell-v1';
const PAGE = new URL(self.location.href).searchParams.get('page') || '';
const NAV_TIMEOUT = 3000;

function targets() {
  const list = [self.registration.scope];
  if (PAGE) { try { list.push(new URL(PAGE, self.location.origin).href); } catch (e) {} }
  return Array.from(new Set(list));
}

/* リダイレクト済みレスポンスはiOSのナビゲーションで使えないため作り直す */
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: 200, statusText: 'OK', headers: res.headers });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(targets().map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload' });
        if (res && res.ok) await cache.put(u, await clean(res));
      } catch (err) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function fromCache(req) {
  const cache = await caches.open(CACHE);
  return (await cache.match(req, { ignoreSearch: true }))
    || (PAGE && await cache.match(new URL(PAGE, self.location.origin).href, { ignoreSearch: true }))
    || (await cache.match(self.registration.scope, { ignoreSearch: true }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  /* ページ本体：ネットワーク優先（更新を即反映）→ 失敗/遅延時はキャッシュ */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const network = fetch(req).then(async (res) => {
        if (res && res.ok) {
          const c = await clean(res.clone());
          cache.put(req, c.clone()).catch(() => {});
          return await clean(res);
        }
        throw new Error('bad response');
      });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT));
      try {
        return await Promise.race([network, timeout]);
      } catch (err) {
        const cached = await fromCache(req);
        if (cached) return cached;
        try { return await network; } catch (e2) { return Response.error(); }
      }
    })());
    return;
  }

  /* その他の同一オリジンGET：ネットワーク優先 → キャッシュ */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const cached = await cache.match(req, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
