// ============================================================
// common-core.js — 출고/입고 공통 코어
// 두 페이지 100% 동일. renderCalendar 등 페이지 함수보다 먼저 로드.
// ============================================================

const VERCEL_API_URL = "/api/calendar";

// 에러 알림: 가능하면 비차단 토스트, 없으면 alert 폴백
function _notify(msg) {
  if (typeof showToast === "function") showToast(msg, 2500);
  else alert(msg);
}

// ── YYYY-MM-DD 날짜 문자열 조립 (두 파일에서 수십 번 반복되던 패턴 공통화)
function _ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function _dateToYmd(date) {
  return _ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

// ── 사용자 입력을 innerHTML에 삽입할 때 XSS 방지
function _esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── onclick="fn('${...}')" 안에 안전하게 넣기 위한 JS+HTML 이중 이스케이프
function _argq(s) {
  return _esc(
    String(s == null ? "" : s)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'"),
  );
}

// ── 네트워크 에러 중 조용히 넘길 것들 판별 (오프라인·abort·fetch실패)
function _isSilentError(e) {
  if (!navigator.onLine) return true;
  const msg = (e.message || e.name || "").toLowerCase();
  return (
    msg.includes("abort") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("networkerror")
  );
}

// ── POST 요청 공통 래퍼. 성공 시 데이터 반환, 실패/에러 시 null 반환.
async function apiCall(payload) {
  setLoadingState(true);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  // session_token 자동 포함 (있을 때만)
  const sessionToken =
    window._sessionToken || localStorage.getItem("session_token") || sessionStorage.getItem("session_token");
  if (sessionToken && !payload.session_token) payload = { ...payload, session_token: sessionToken };
  try {
    const r = await fetch(VERCEL_API_URL, { method: "POST", body: JSON.stringify(payload), signal: controller.signal });
    clearTimeout(timeoutId);
    const raw = await r.json();
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (d && d.forceLogout) {
      alert(d.msg || "🚨 계정이 비활성화되어 로그아웃됩니다.");
      executeLogout();
      return null;
    }
    if (d && d.error) {
      _notify("🔥 서버 에러: " + d.error);
      return null;
    }
    return d;
  } catch (e) {
    clearTimeout(timeoutId);
    if (_isSilentError(e)) {
      console.warn("스텔스 차단 (POST):", e.message);
      return null;
    }
    _notify("🔥 통신 에러: " + e.message);
    return null;
  } finally {
    setLoadingState(false);
  }
}

// ── GET 요청 공통 래퍼. params 객체를 쿼리스트링으로 변환.
async function apiGet(params) {
  setLoadingState(true);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const qs = new URLSearchParams({ api: "true", ...params, t: Date.now() }).toString();
    const r = await fetch(`${VERCEL_API_URL}?${qs}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    const d = await r.json();
    if (d && d.error) {
      _notify("🔥 에러: " + d.error);
      return null;
    }
    return d;
  } catch (e) {
    clearTimeout(timeoutId);
    if (_isSilentError(e)) {
      console.warn("스텔스 차단 (GET):", e.message);
      return null;
    }
    _notify("🔥 통신 에러: " + e.message);
    return null;
  } finally {
    setLoadingState(false);
  }
}

// ── 커스텀 확인창 (Promise<boolean>). iOS WebKit에서 native confirm()이 멈추는(프리징) 버그 회피용.
//    사용: if (!(await uiConfirm("메시지"))) return;
function uiConfirm(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const prev = document.getElementById("uiConfirmOverlay");
    if (prev) prev.remove();
    const ov = document.createElement("div");
    ov.id = "uiConfirmOverlay";
    ov.style.cssText =
      "position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px); padding:24px; box-sizing:border-box;";
    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--card-bg,#26282c); color:var(--text-main,#fff); width:100%; max-width:340px; border-radius:18px; padding:22px 20px 16px; box-shadow:0 12px 40px rgba(0,0,0,0.45); text-align:center; box-sizing:border-box;";
    const msg = document.createElement("div");
    msg.style.cssText =
      "font-size:1em; font-weight:700; line-height:1.55; white-space:pre-line; margin-bottom:18px; word-break:keep-all;";
    msg.textContent = message; // 텍스트로 안전하게 삽입(HTML 주입 방지)
    const row = document.createElement("div");
    row.style.cssText = "display:flex; gap:8px;";
    const cancel = document.createElement("button");
    cancel.textContent = opts.cancelText || "취소";
    cancel.style.cssText =
      "flex:1; padding:13px; border:none; border-radius:12px; background:var(--border-color,#3a3d42); color:var(--text-main,#fff); font-weight:800; font-size:1em; cursor:pointer;";
    const ok = document.createElement("button");
    ok.textContent = opts.okText || "확인";
    ok.style.cssText =
      "flex:1; padding:13px; border:none; border-radius:12px; background:" +
      (opts.danger ? "#ff3b30" : "#0a84ff") +
      "; color:#fff; font-weight:800; font-size:1em; cursor:pointer;";
    row.appendChild(cancel);
    row.appendChild(ok);
    box.appendChild(msg);
    box.appendChild(row);
    ov.appendChild(box);
    document.body.appendChild(ov);
    const done = (val) => {
      ov.remove();
      resolve(val);
    };
    ok.addEventListener("click", () => done(true));
    cancel.addEventListener("click", () => done(false));
    ov.addEventListener("click", (e) => {
      if (e.target === ov) done(false);
    });
  });
}

// ── 두 페이지 완전 동일 유틸 (in.js / out.js 중복 제거)

function updateSyncTime() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("lastSyncTime").innerText = `${hh}:${mm}`;
}

function changeSize(size) {
  document.querySelectorAll(".size-btn").forEach((btn) => btn.classList.remove("active"));
  const body = document.body;
  if (size === "S") { body.style.fontSize = "80%"; document.getElementById("btnS").classList.add("active"); }
  if (size === "M") { body.style.fontSize = "95%";  document.getElementById("btnM").classList.add("active"); }
  if (size === "L") { body.style.fontSize = "120%"; document.getElementById("btnL").classList.add("active"); }
  localStorage.setItem("cal_fontSize", size);
}

function togglePcLeft() {
  const c = document.body.classList.toggle("pc-left-collapsed");
  try { localStorage.setItem("pc_left", c ? "collapsed" : "open"); } catch (e) {}
}
function togglePcRight() {
  const c = document.body.classList.toggle("pc-right-collapsed");
  try { localStorage.setItem("pc_right", c ? "collapsed" : "open"); } catch (e) {}
}
function closePcOverlays() {
  document.body.classList.add("pc-left-collapsed", "pc-right-collapsed");
  try { localStorage.setItem("pc_left", "collapsed"); localStorage.setItem("pc_right", "collapsed"); } catch (e) {}
}

// ============================================================
// 서비스워커 등록 + 새 버전 알림 (출고/입고 공통 — out.js / in.js 에서 이동)
//  · 새 배포가 올라가면 앱에 돌아왔을 때 "새 버전이 있어요 [새로고침]" 안내
//    (sw.js 가 코드 파일 내용이 바뀐 걸 감지해서 알려줌 → 코드만 고칠 때는 sw.js 의 CACHE 버전을 안 올려도 됨)
//  · '새로고침'을 눌러야만 바뀜 (작업 중인 화면이 갑자기 사라지지 않음)
// ============================================================
(function () {
  if (!("serviceWorker" in navigator)) return;

  const hadController = !!navigator.serviceWorker.controller; // 첫 설치(컨트롤러 없음)에는 안내하지 않음
  let dismissed = false; // '나중에'를 누르면 이 화면에서는 다시 안 물음
  let reloading = false;
  let lastCheck = 0;

  function postToSW(msg) {
    const c = navigator.serviceWorker.controller;
    if (c) c.postMessage(msg);
    return !!c;
  }

  // 저장/조회 요청이 진행 중이면 끝날 때까지 잠깐(최대 5초) 기다렸다가 새로고침 — 저장 직후에 눌러도 요청이 끊기지 않게
  function reloadWhenIdle(deadline) {
    let busy = false;
    try {
      busy = typeof activeRequests !== "undefined" && activeRequests > 0;
    } catch (e) {}
    if (!busy || Date.now() > deadline) return location.reload();
    setTimeout(() => reloadWhenIdle(deadline), 200);
  }

  function reloadWithFreshShell() {
    if (reloading) return;
    reloading = true;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      reloadWhenIdle(Date.now() + 5000);
    };
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "SHELL_REFRESHED") finish();
    });
    if (!postToSW({ type: "REFRESH_SHELL" })) return finish();
    setTimeout(finish, 4000); // 서비스워커 응답이 없어도 4초 뒤엔 새로고침
  }

  window.applyShellUpdate = reloadWithFreshShell; // 당겨서 새로고침(common-ui.js)에서 사용

  function showUpdateBanner() {
    if (dismissed || !document.body || document.getElementById("appUpdateBanner")) return;
    const bar = document.createElement("div");
    bar.id = "appUpdateBanner";
    bar.setAttribute("role", "status");
    bar.style.cssText =
      "position:fixed; left:12px; right:12px; top:calc(env(safe-area-inset-top,0px) + 10px); z-index:99998; max-width:460px; margin:0 auto; display:flex; align-items:center; gap:8px; padding:10px 10px 10px 14px; border-radius:14px; background:var(--card-bg,#26282c); color:var(--text-main,#fff); border:1px solid var(--border-color,#3a3d42); box-shadow:0 8px 28px rgba(0,0,0,0.4); font-size:0.9em; font-weight:700; box-sizing:border-box;";
    const msg = document.createElement("span");
    msg.style.cssText = "flex:1; min-width:0; word-break:keep-all;";
    msg.textContent = "🔄 새 버전이 있어요";
    const later = document.createElement("button");
    later.textContent = "나중에";
    later.style.cssText =
      "border:none; background:transparent; color:var(--text-sub,#9a9da3); font-weight:700; padding:8px 6px; cursor:pointer; font-size:1em;";
    const now = document.createElement("button");
    now.textContent = "새로고침";
    now.style.cssText =
      "border:none; border-radius:10px; background:#0a84ff; color:#fff; font-weight:800; padding:8px 14px; cursor:pointer; font-size:1em;";
    later.addEventListener("click", () => {
      dismissed = true;
      bar.remove();
    });
    now.addEventListener("click", () => {
      now.disabled = true;
      now.textContent = "적용 중…";
      reloadWithFreshShell();
    });
    bar.appendChild(msg);
    bar.appendChild(later);
    bar.appendChild(now);
    document.body.appendChild(bar);
  }

  // 서비스워커가 "코드 파일이 서버와 달라졌다"고 알려옴
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "SHELL_UPDATED") {
      window._shellUpdatePending = true; // '나중에'를 눌러도 기억 → 당겨서 새로고침 때 통째로 새로고침
      showUpdateBanner();
    }
  });
  // sw.js 자체가 새로 설치돼 제어권을 넘겨받음 (첫 설치는 제외)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloading) {
      window._shellUpdatePending = true;
      showUpdateBanner();
    }
  });

  // 앱으로 돌아올 때 서버에 새 배포가 있는지 확인 (1분에 한 번만)
  function checkForUpdate() {
    if (!navigator.onLine) return;
    const now = Date.now();
    if (now - lastCheck < 60000) return;
    lastCheck = now;
    postToSW({ type: "CHECK_UPDATE" });
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r && r.update())
      .catch(() => {});
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("서비스 워커 등록 실패:", err));
    setTimeout(() => postToSW({ type: "HELLO" }), 1500); // 로딩 중 놓친 '새 버전' 알림 다시 받기
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      postToSW({ type: "HELLO" });
      checkForUpdate();
    }
  });
  window.addEventListener("online", checkForUpdate);
})();
