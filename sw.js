// sw.js (서비스 워커) — 앱 셸 캐싱으로 콜드 스타트(검은 화면) 단축
const CACHE = "cal-shell-v137";

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

// ── 새 버전 알림용: 코드(HTML/JS) 파일 목록. 내용이 서버와 달라지면 화면에 '새 버전이 있어요' 안내를 띄움
//    (그래서 코드만 고칠 때는 위 CACHE 버전을 손으로 올리지 않아도 됨)
const CODE_PATHS = ["/", "/index.html", "/inbound.html", "/out.js", "/in.js", "/common-core.js", "/common-ui.js", "/script.js"];
let updatePending = false; // 캐시가 서버보다 오래된 걸 발견했고, 아직 새 화면으로 이동하지 않은 상태
let sweep = null; // 진행 중인 '코드 파일 전체 확인'

async function bodyHash(res) {
  const buf = await res.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 캐시본(oldRes)과 서버본(newRes)이 실제로 다른 내용인지. ETag 가 같으면 같은 것, 다르거나 없으면 본문 해시로 최종 확인(오탐 방지)
async function isChanged(oldRes, newRes) {
  if (!oldRes || !newRes) return false;
  const oe = oldRes.headers.get("etag");
  const ne = newRes.headers.get("etag");
  if (oe && ne && oe === ne) return false;
  return (await bodyHash(oldRes)) !== (await bodyHash(newRes));
}

async function markUpdated() {
  updatePending = true;
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach((c) => c.postMessage({ type: "SHELL_UPDATED" }));
}

// 서버의 새 배포를 확인해서 바뀐 코드 파일은 캐시를 갱신 (앱으로 돌아올 때 화면이 요청함)
async function checkForUpdates(silent) {
  const cache = await caches.open(CACHE);
  let changed = false;
  await Promise.all(
    CODE_PATHS.map(async (p) => {
      try {
        const res = await fetch(p, { cache: "no-cache" });
        if (!res || res.status !== 200) return;
        const old = await cache.match(p);
        if (await isChanged(old, res)) {
          changed = true;
          await cache.put(p, res.clone());
        }
      } catch (e) {}
    }),
  );
  if (changed && !silent) await markUpdated(); // silent: 이미 알린 뒤의 전체 확인은 조용히 갱신만
}

// '새로고침'을 누르면: 코드 파일을 전부 새로 받아 한꺼번에 교체한 뒤 알려줌 (옛 파일/새 파일이 섞이지 않게)
async function refreshShell(client) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    CODE_PATHS.map(async (p) => {
      try {
        const res = await fetch(p, { cache: "reload" });
        if (res && res.status === 200) await cache.put(p, res);
      } catch (e) {}
    }),
  );
  updatePending = false;
  if (client) client.postMessage({ type: "SHELL_REFRESHED" });
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "HELLO") {
    // 화면 로딩 중에 알림을 놓쳤을 수 있으니, 대기 중이면 다시 알려줌
    if (updatePending && event.source) event.source.postMessage({ type: "SHELL_UPDATED" });
  } else if (type === "CHECK_UPDATE") {
    event.waitUntil(checkForUpdates());
  } else if (type === "REFRESH_SHELL") {
    event.waitUntil(refreshShell(event.source));
  }
});

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
  //  + 코드 파일(HTML/JS)은 캐시본과 서버본이 다르면 화면에 '새 버전이 있어요' 안내
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") updatePending = false; // 이번 이동은 캐시에 이미 반영된 최신 파일을 받음
    let background = Promise.resolve();
    const respond = caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then(async (res) => {
          if (res && res.status === 200) {
            try {
              if (cached && CODE_PATHS.includes(url.pathname) && (await isChanged(cached, res))) {
                await markUpdated();
                // 나머지 코드 파일도 한꺼번에 최신으로 (출고/입고 중 한쪽만 열어도 다른 쪽까지 갱신 → 여러 번 껐다 켤 필요 없음)
                sweep = sweep || checkForUpdates(true).catch(() => {}).finally(() => (sweep = null));
              }
            } catch (e) {}
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      background = network.catch(() => {}).then(() => sweep); // 백그라운드 갱신이 끝날 때까지 서비스워커 유지
      // 캐시 있으면 즉시 반환 + 백그라운드 갱신, 없으면 네트워크 대기
      return cached || network;
    });
    event.respondWith(respond);
    event.waitUntil(respond.then(() => background));
    return;
  }

  // 그 외(외부 CDN 등): 네트워크, 실패 시 캐시
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});
