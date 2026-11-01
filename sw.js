// sw.js (서비스 워커) — 앱 셸 캐싱으로 콜드 스타트(검은 화면) 단축
const CACHE = "cal-shell-v138";
const META = "cal-meta-v1"; // 화면(창)마다 "내가 받은 코드 파일의 지문"을 적어 두는 곳 (서비스워커가 꺼졌다 켜져도 남음)

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
let sweep = null; // 진행 중인 '코드 파일 전체 확인'

// ── 새 버전 알림 방식 (v138) ──
//  예전: "바뀐 걸 발견한 순간" 열려 있는 화면에 한 번 방송 + 메모리 깃발. → 출고 앱이 먼저 확인하면서 캐시를 새 걸로 바꿔 버리면,
//        입고 앱은 방송을 못 받았을 때(앱이 멈춰 있었거나 서비스워커가 꺼졌다 켜짐) 영영 "이미 최신"으로 보여 알림이 안 떴음.
//  지금: 화면(창)마다 '내가 받은 파일 지문'을 기록해 두고, 확인할 때마다 "그 화면이 받은 것 ≠ 지금 캐시의 최신" 이면 그 화면에 알림.
//        → 누가 먼저 확인했든, 방송을 놓쳤든, 서비스워커가 재시작됐든 판단이 같음. 출고만 바뀌면 입고 화면엔 안 뜸(그 반대도).
const hashMemo = new Map(); // etag → 본문 해시 (같은 etag 면 다시 계산 안 함)
async function bodyHash(res) {
  const buf = await res.clone().arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function rid(res) {
  if (!res) return "";
  const et = res.headers.get("etag");
  if (et && hashMemo.has(et)) return hashMemo.get(et);
  const h = await bodyHash(res);
  if (et) {
    if (hashMemo.size > 200) hashMemo.clear();
    hashMemo.set(et, h);
  }
  return h;
}

// 캐시본(oldRes)과 서버본(newRes)이 실제로 다른 내용인지. ETag 가 같으면 같은 것, 다르거나 없으면 본문 해시로 최종 확인(오탐 방지)
async function isChanged(oldRes, newRes) {
  if (!oldRes || !newRes) return false;
  const oe = oldRes.headers.get("etag");
  const ne = newRes.headers.get("etag");
  if (oe && ne && oe === ne) return false;
  return (await rid(oldRes)) !== (await rid(newRes));
}

const metaKey = (cid) => new Request(self.location.origin + "/__served/" + encodeURIComponent(cid));
let metaQ = Promise.resolve(); // 같은 화면의 여러 파일 기록이 서로 덮어쓰지 않게 한 줄로 처리
function recordServed(cid, path, res) {
  if (!cid || !res) return Promise.resolve();
  const task = metaQ.then(async () => {
    try {
      const id = await rid(res);
      const m = await caches.open(META);
      const key = metaKey(cid);
      const old = await m.match(key);
      let cur = {};
      try { cur = old ? await old.json() : {}; } catch (e) { cur = {}; }
      cur[path] = id;
      await m.put(key, new Response(JSON.stringify(cur), { headers: { "content-type": "application/json" } }));
    } catch (e) {}
  });
  metaQ = task.catch(() => {});
  return task;
}

// 열려 있는 화면 중 '받은 코드 ≠ 최신 캐시'인 화면에만 알림 (targetId 가 있으면 그 화면만)
async function notifyStale(targetId) {
  try {
    await metaQ;
    const cache = await caches.open(CACHE);
    const m = await caches.open(META);
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const alive = new Set(wins.map((c) => c.id));
    for (const req of await m.keys()) { // 닫힌 화면 기록 정리
      const cid = decodeURIComponent(req.url.split("/__served/")[1] || "");
      if (!alive.has(cid)) await m.delete(req);
    }
    const latest = {};
    for (const c of wins) {
      if (targetId && c.id !== targetId) continue;
      const r = await m.match(metaKey(c.id));
      if (!r) continue; // 기록이 없는 화면(예전 버전에서 열린 것)은 판단 보류
      let served = {};
      try { served = await r.json(); } catch (e) { continue; }
      let stale = false;
      for (const p of Object.keys(served)) {
        if (!(p in latest)) {
          const cr = await cache.match(p);
          latest[p] = cr ? await rid(cr) : null;
        }
        if (latest[p] && latest[p] !== served[p]) { stale = true; break; }
      }
      if (stale) c.postMessage({ type: "SHELL_UPDATED" });
    }
  } catch (e) {}
}

// 서버의 새 배포를 확인해서 바뀐 코드 파일은 캐시를 갱신하고, 낡은 화면에 알림 (앱으로 돌아올 때 화면이 요청함)
async function checkForUpdates() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    CODE_PATHS.map(async (p) => {
      try {
        const res = await fetch(p, { cache: "no-cache" });
        if (!res || res.status !== 200) return;
        const old = await cache.match(p);
        if (!old || (await isChanged(old, res))) await cache.put(p, res.clone());
      } catch (e) {}
    }),
  );
  await notifyStale();
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
  if (client) client.postMessage({ type: "SHELL_REFRESHED" });
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "HELLO") {
    // 화면 로딩 중에 알림을 놓쳤을 수 있으니, 그 화면이 낡았는지 다시 판단해서 알려줌
    event.waitUntil(notifyStale(event.source && event.source.id));
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== META).map((k) => caches.delete(k))))
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
  //  + 코드 파일(HTML/JS)은 '이 화면이 받은 파일 지문'을 기록해 두고, 서버본이 다르면 그 화면(들)에 '새 버전이 있어요' 안내
  if (url.origin === self.location.origin) {
    const isCode = CODE_PATHS.includes(url.pathname);
    const cid = req.mode === "navigate" ? event.resultingClientId || event.clientId : event.clientId;
    let background = Promise.resolve();
    const respond = caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      let served = Promise.resolve();
      if (cached && isCode) served = recordServed(cid, url.pathname, cached.clone()); // 화면에 준 건 캐시본
      const network = fetch(req)
        .then(async (res) => {
          if (res && res.status === 200) {
            const forRecord = !cached && isCode ? res.clone() : null;
            let changed = false;
            try {
              changed = !!(cached && isCode && (await isChanged(cached, res)));
            } catch (e) {}
            const putP = cache.put(req, res.clone()).catch(() => {});
            if (forRecord) served = recordServed(cid, url.pathname, forRecord); // 캐시가 없었으면 서버본을 준 것
            if (changed) {
              await putP;
              await served;
              // 나머지 코드 파일도 한꺼번에 최신으로 (출고/입고 중 한쪽만 열어도 다른 쪽까지 갱신 → 여러 번 껐다 켤 필요 없음)
              sweep = sweep || checkForUpdates().catch(() => {}).finally(() => (sweep = null));
            }
          }
          return res;
        })
        .catch(() => cached);
      background = network.catch(() => {}).then(() => sweep).then(() => served); // 백그라운드 갱신이 끝날 때까지 서비스워커 유지
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
