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
  try {
    const qs = new URLSearchParams({ api: "true", ...params, t: Date.now() }).toString();
    const r = await fetch(`${VERCEL_API_URL}?${qs}`);
    const d = await r.json();
    if (d && d.error) {
      _notify("🔥 에러: " + d.error);
      return null;
    }
    return d;
  } catch (e) {
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
