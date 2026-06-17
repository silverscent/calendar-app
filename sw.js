// sw.js (서비스 워커) — 앱 셸 캐싱으로 콜드 스타트(검은 화면) 단축
const CACHE = "cal-shell-v73";

// 앱 셸: 콜드 스타트 시 캐시에서 즉시 제공 → 검은 화면 최소화
const SHELL = [
  "/",
  "/index.html",
  "/inbound.html",
  "/out.js",
  "/in.js",
  "/common-core.js",
  "/common-ui.js",
  "/script.js",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/manifest_v2.json",
  "/manifest_in_v2.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        // 일부 자산이 없어도 설치가 실패하지 않도록 개별 best-effort
        Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const offlineJson = () =>
  new Response(
    JSON.stringify({ success: false, error: "offline", msg: "네트워크가 끊겼거나 서비스 워커가 대기 중입니다." }),
    { status: 503, statusText: "Service Unavailable", headers: new Headers({ "Content-Type": "application/json" }) },
  );

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GET 만 처리 (POST 등은 패스)
  if (req.method !== "GET") {
    event.respondWith(fetch(req).catch(() => offlineJson()));
    return;
  }

  // API: 항상 네트워크 우선 (최신 데이터), 실패 시 503 JSON
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(() => offlineJson()));
    return;
  }

  // 같은 출처 정적 자산/네비게이션: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          // 캐시 있으면 즉시 반환 + 백그라운드 갱신, 없으면 네트워크 대기
          return cached || network;
        }),
      ),
    );
    return;
  }

  // 그 외(외부 CDN 등): 네트워크, 실패 시 캐시
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
