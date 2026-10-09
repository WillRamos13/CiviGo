/* Cache only the public shell and static assets. Auth, API responses and
   uploaded evidence always require the network. */
const CACHE = "civigo-public-shell-v5";
const PUBLIC_ASSETS = ["/civigo-logo.jpeg", "/civigo-logo-animado-poster.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set(PUBLIC_ASSETS);
      for (const page of ["/", "/mapa"]) {
        const response = await fetch(page);
        if (!response.ok) throw new Error("Public shell unavailable");
        const html = await response.clone().text();
        await cache.put(page, response);
        for (const match of html.matchAll(
          /(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g,
        ))
          assets.add(match[1].replaceAll("&amp;", "&"));
      }
      await cache.addAll([...assets]);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("civigo-public-shell-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/uploads/")
  )
    return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (
            response.ok &&
            (url.pathname === "/" || url.pathname === "/mapa")
          ) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(url.pathname, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match("/mapa").then((cached) => cached || Response.error()),
        ),
    );
    return;
  }
  if (
    url.pathname.startsWith("/_next/static/") ||
    PUBLIC_ASSETS.includes(url.pathname)
  ) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || Response.error()),
        ),
    );
  }
});
