// _aiusage.js — AI(Gemini)·문자인식(Vision) 사용량을 한 곳에 기록하고 통계로 읽는 공용 모듈
//  · 입고(앱 OCR·대조 AI)·출고(피킹지)·AI 채팅·텔레그램 OCR 이 모두 같은 표(ai_usage_log)에 남기므로 한 화면에서 합쳐 볼 수 있다.
//  · 기록은 '최선 노력' — 실패해도(표 생성·삽입 오류) 본 기능에는 영향을 주지 않는다. 키 원문은 저장하지 않고 키 번호만 남긴다.
//  · 사용법(텔레그램도 동일):  const au = require("./_aiusage");  const f = au.timed(pool, "tg_ocr", fetch, [keys...]);  await f(url, init)  ← fetch 와 똑같이 쓰면 호출·성공·시간이 기록됨

const SOURCES = {
  tg_ocr: "텔레그램 OCR",
  app_ocr: "앱 OCR(입고)",
  ocr_reread: "대조창 AI 다시읽기",
  pick: "피킹지 판독",
  pick_reread: "피킹지 2차 판독",
  ai_chat: "AI 채팅",
  key_test: "키·모델 점검",
};

let _ready = false;
let _hasErr = false; // err(실패 원인 요약) 칸이 있는지 — 추가에 실패해도 기록 자체는 계속(원인 칸만 비움)
async function ensure(pool) {
  if (_ready) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ai_usage_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, day CHAR(10), source VARCHAR(24), provider VARCHAR(12), model VARCHAR(48), key_no TINYINT DEFAULT 0, ok TINYINT DEFAULT 1, status SMALLINT DEFAULT 0, ms INT DEFAULT 0, err VARCHAR(300) NULL, KEY idx_day (day, source), KEY idx_created (created_at))`,
  );
  try {
    const [c] = await pool.query(`SHOW COLUMNS FROM ai_usage_log LIKE 'err'`);
    if (!c.length) await pool.query(`ALTER TABLE ai_usage_log ADD COLUMN err VARCHAR(300) NULL`);
    _hasErr = true;
  } catch (_) {
    _hasErr = false;
  }
  _ready = true;
}

// 실패 원인 요약에서 키 같은 비밀값을 가리고 한 줄로 만든다(저장·복사 모두 이 결과만 사용)
function mask(s) {
  return String(s == null ? "" : s)
    .replace(/AIza[0-9A-Za-z_\-]{10,}/g, "AIza***")
    .replace(/([?&]key=)[^&\s"']+/gi, "$1***")
    .replace(/\s+/g, " ")
    .trim();
}
// 구글 응답 본문(JSON)에서 '상태·코드·메시지' 만 뽑는다. JSON 이 아니면 앞부분 글자만.
function errSummary(text) {
  let t = String(text || "");
  try {
    const j = JSON.parse(t);
    const e = j.error || (j.responses && j.responses[0] && j.responses[0].error);
    if (e) t = [e.status, e.code, e.message].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
  } catch (_) {}
  return mask(t).slice(0, 300);
}

// 한국 날짜(YYYY-MM-DD)
function kstDay(d) {
  const k = new Date((d || new Date()).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, "0")}-${String(k.getDate()).padStart(2, "0")}`;
}
function kstMonthStart(d) {
  return kstDay(d).slice(0, 8) + "01";
}

async function log(pool, rows) {
  try {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return;
    await ensure(pool);
    const day = kstDay();
    const vals = list.map((r) => {
      const row = [day, String(r.source || "").slice(0, 24), String(r.provider || "").slice(0, 12), String(r.model || "").slice(0, 48), Number(r.keyNo) || 0, r.ok ? 1 : 0, Number(r.status) || 0, Math.max(0, Math.round(Number(r.ms) || 0))];
      if (_hasErr) row.push(r.ok || !r.err ? null : mask(r.err).slice(0, 300)); // 실패한 호출만 원인을 남겨 DB 쓰기량을 늘리지 않음
      return row;
    });
    await pool.query(`INSERT INTO ai_usage_log (day, source, provider, model, key_no, ok, status, ms${_hasErr ? ", err" : ""}) VALUES ?`, [vals]);
  } catch (_) {}
}

// fetch 와 똑같이 쓰는 기록용 껍데기. Vision·Gemini 주소만 기록하고(그 외 주소는 그냥 통과), 응답 본문은 건드리지 않는다.
function timed(pool, source, fetchFn, keys) {
  const kl = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  const aiKey = process.env.GEMINI_API_KEY_AI || "";
  return async function (url, init) {
    const u = String(url || "");
    const isG = /generativelanguage\.googleapis\.com/.test(u);
    const isV = /vision\.googleapis\.com/.test(u);
    if (!isG && !isV) return fetchFn(url, init);
    const t0 = Date.now();
    const km = u.match(/[?&]key=([^&]+)/);
    const key = km ? decodeURIComponent(km[1]) : "";
    let keyNo = 0;
    if (isG) {
      const i = kl.indexOf(key);
      keyNo = i >= 0 ? i + 1 : key && key === aiKey ? 9 : 0; // 9 = AI 채팅 전용 키
    }
    const model = isV ? "vision" : ((u.match(/models\/([^:?\/]+)/) || [])[1] || "");
    try {
      const res = await fetchFn(url, init);
      let err = "";
      if (!res.ok && res && typeof res.clone === "function") {
        try { err = errSummary(await res.clone().text()); } catch (_) {} // 원래 응답은 그대로 두고 복제본만 읽음(실패일 때만)
      }
      await log(pool, { source, provider: isV ? "vision" : "gemini", model, keyNo, ok: !!res.ok, status: res.status, ms: Date.now() - t0, err });
      return res;
    } catch (e) {
      const err = e && e.name === "AbortError" ? "시간 초과(AbortError)" : mask((e && e.message) || e);
      await log(pool, { source, provider: isV ? "vision" : "gemini", model, keyNo, ok: false, status: e && e.name === "AbortError" ? 0 : -1, ms: Date.now() - t0, err });
      throw e;
    }
  };
}

const kindOf = (status) => (status === 429 ? "limit" : status === 503 || status === 500 || status === 502 || status === 504 ? "overload" : status === 0 ? "timeout" : "error");

// 통계: 최근 30일 기록을 출처·날짜·모델·키별로 모아 돌려줌
async function stats(pool) {
  await ensure(pool);
  try { await pool.query(`DELETE FROM ai_usage_log WHERE day < ?`, [kstDay(new Date(Date.now() - 150 * 86400000))]); } catch (_) {}
  const today = kstDay();
  const d30 = kstDay(new Date(Date.now() - 29 * 86400000));
  const d7 = kstDay(new Date(Date.now() - 6 * 86400000));
  const [g] = await pool.query(`SELECT day, source, provider, ok, COUNT(*) n FROM ai_usage_log WHERE day >= ? GROUP BY day, source, provider, ok`, [d30]);
  const [m] = await pool.query(`SELECT model, provider, ok, COUNT(*) n, ROUND(AVG(ms)) ms FROM ai_usage_log WHERE day >= ? GROUP BY model, provider, ok`, [d30]);
  const [k] = await pool.query(`SELECT key_no, ok, COUNT(*) n FROM ai_usage_log WHERE day >= ? AND provider = 'gemini' GROUP BY key_no, ok`, [d30]);
  const [f] = await pool.query(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') t, source, provider, model, key_no, status, ms FROM ai_usage_log WHERE ok = 0 ORDER BY id DESC LIMIT 12`);
  const [first] = await pool.query(`SELECT MIN(day) d FROM ai_usage_log`);
  const [mv] = await pool.query(`SELECT COUNT(*) n FROM ai_usage_log WHERE day >= ? AND provider = 'vision' AND ok = 1 AND source = 'app_ocr'`, [kstMonthStart()]);
  const [tgSeen] = await pool.query(`SELECT COUNT(*) n FROM ai_usage_log WHERE source = 'tg_ocr'`);
  // 날짜 14칸 시리즈(제미나이 호출 수 / 실패 수)
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = kstDay(new Date(Date.now() - i * 86400000));
    let n = 0, bad = 0;
    g.forEach((r) => { if (r.day === day && r.provider === "gemini") { n += Number(r.n); if (!r.ok) bad += Number(r.n); } });
    series.push({ day, n, bad });
  }
  const bySource = {};
  Object.keys(SOURCES).forEach((s) => { bySource[s] = { label: SOURCES[s], gemini: { today: 0, d7: 0, d30: 0, bad30: 0 }, vision: { today: 0, d7: 0, d30: 0, bad30: 0 } }; });
  g.forEach((r) => {
    const o = bySource[r.source] || (bySource[r.source] = { label: r.source, gemini: { today: 0, d7: 0, d30: 0, bad30: 0 }, vision: { today: 0, d7: 0, d30: 0, bad30: 0 } });
    const p = o[r.provider === "vision" ? "vision" : "gemini"];
    const n = Number(r.n);
    p.d30 += n;
    if (!r.ok) p.bad30 += n;
    if (r.day >= d7) p.d7 += n;
    if (r.day === today) p.today += n;
  });
  return {
    today,
    since: first && first[0] && first[0].d ? first[0].d : null,
    bySource,
    series,
    models: m.map((r) => ({ model: r.model, provider: r.provider, ok: !!r.ok, n: Number(r.n), ms: Number(r.ms) || 0 })),
    keys: k.map((r) => ({ keyNo: Number(r.key_no), ok: !!r.ok, n: Number(r.n) })),
    failures: f.map((r) => ({ t: r.t, source: r.source, provider: r.provider, model: r.model, keyNo: Number(r.key_no), status: Number(r.status), kind: kindOf(Number(r.status)), ms: Number(r.ms) })),
    appVisionMonth: Number(mv[0].n) || 0,
    telegramLogged: Number(tgSeen[0].n) > 0,
  };
}

// ── 진단 복사용 ─────────────────────────────────────────
const KIND_TX = { limit: "한도 초과", overload: "서버 과부하", timeout: "시간 초과", error: "오류" };
// 최근 실패 n건(원인 요약 포함)
async function failureDetail(pool, n) {
  await ensure(pool);
  const [f] = await pool.query(`SELECT DATE_FORMAT(created_at, '%m-%d %H:%i:%s') t, source, provider, model, key_no, status, ms, ${_hasErr ? "err" : "NULL AS err"} FROM ai_usage_log WHERE ok = 0 ORDER BY id DESC LIMIT ?`, [Math.max(1, Math.min(100, n | 0 || 40))]);
  return f.map((r) => ({ t: r.t, source: r.source, provider: r.provider, model: r.model, keyNo: Number(r.key_no), status: Number(r.status), ms: Number(r.ms), err: r.err || "" }));
}
// 최근 7일 실패를 출처·모델·키·상태별로 묶음(같은 문제가 몇 번 반복됐나)
async function failureGroups(pool) {
  await ensure(pool);
  const d7 = kstDay(new Date(Date.now() - 6 * 86400000));
  const [g] = await pool.query(`SELECT source, provider, model, key_no, status, COUNT(*) n, DATE_FORMAT(MAX(created_at), '%m-%d %H:%i') last FROM ai_usage_log WHERE ok = 0 AND day >= ? GROUP BY source, provider, model, key_no, status ORDER BY n DESC LIMIT 25`, [d7]);
  return g.map((r) => ({ source: r.source, provider: r.provider, model: r.model, keyNo: Number(r.key_no), status: Number(r.status), n: Number(r.n), last: r.last }));
}
const _kstFmt = (ms) => { try { return new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false }); } catch (_) { return ""; } };
const _lv = (l) => (l === "down" ? "🔴" : l === "warn" ? "🟡" : "🟢");
// 모든 입력(payload=AI 사용량 화면 데이터, failures·groups, picks=최근 피킹지 판독 요약)을 받아 복사용 글 한 덩어리를 만든다. 비밀값(키 원문)은 어디에도 넣지 않는다.
function buildDiagText(o) {
  const p = o.payload || {}, st = p.stats || {}, v = p.vision || {}, g = p.gemini || {};
  const L = [];
  L.push(`[AI 진단 리포트] ${_kstFmt(o.now || Date.now())} (서버 기준, 한국 시간)`);
  L.push(`전체 상태: ${_lv(p.overall)} ${p.overall || "?"}`);
  L.push("", "== 기능별 상태 ==");
  (p.features || []).forEach((f) => L.push(`${_lv(f.level)} ${f.name} — ${f.why || ""}`));
  L.push("", "== 문자인식(Vision) ==");
  L.push(`이번 달 ${v.used ?? "?"}/${v.limit ?? 1000} (입고 OCR 카운터 ${v.ocrCount ?? "?"} + 출고 피킹지 ${v.pickMonth ?? "?"}) · 남은 ${v.left ?? "?"} · 키 ${v.keyConfigured ? "설정됨" : "없음"}`);
  L.push("", "== Gemini ==");
  L.push(`키 ${g.keyCount ?? "?"}개${g.chatKeySeparate ? " + 채팅 전용 키" : ""} · 쓸 수 있는 키 ${g.pressure ? g.pressure.usable : "?"}/${g.pressure ? g.pressure.total : "?"} · 모델 순서: ${(g.models || []).join(" → ")}`);
  const kInfo = {};
  (st.keys || []).forEach((k) => { const x = kInfo[k.keyNo] || (kInfo[k.keyNo] = { n: 0, bad: 0 }); x.n += k.n; if (!k.ok) x.bad += k.n; });
  (g.keys || []).forEach((k) => {
    const ki = kInfo[k.no] || { n: 0, bad: 0 };
    L.push(`키 ${k.no}: ${k.blocked ? "쉬는 중" + (k.keyUntil ? ` (${_kstFmt(k.keyUntil)}까지${k.keyWhy ? ", " + k.keyWhy : ""})` : "") : "사용 가능"} · 30일 호출 ${ki.n}회 중 실패 ${ki.bad}`);
  });
  L.push("", "== 출처별 호출(30일, 실패) ==");
  Object.keys(st.bySource || {}).forEach((k) => {
    const x = st.bySource[k];
    if (!x.gemini.d30 && !x.vision.d30) return;
    L.push(`${x.label}: Gemini 오늘 ${x.gemini.today} · 7일 ${x.gemini.d7} · 30일 ${x.gemini.d30}(실패 ${x.gemini.bad30}) / Vision 30일 ${x.vision.d30}(실패 ${x.vision.bad30})`);
  });
  L.push("", "== 최근 7일 실패 묶음 ==");
  if (!(o.groups || []).length) L.push("(없음)");
  (o.groups || []).forEach((x) => L.push(`${SOURCES[x.source] || x.source} · ${x.provider}${x.model ? " " + x.model : ""}${x.keyNo ? " · 키" + x.keyNo : ""} · 상태 ${x.status}(${KIND_TX[kindOf(x.status)]}) × ${x.n}회, 마지막 ${x.last}`));
  L.push("", "== 최근 실패 " + (o.failures || []).length + "건 (최신 먼저) ==");
  if (!(o.failures || []).length) L.push("(없음)");
  (o.failures || []).forEach((x) => L.push(`${x.t} · ${SOURCES[x.source] || x.source} · ${x.provider}${x.model ? " " + x.model : ""}${x.keyNo ? " 키" + x.keyNo : ""} · ${x.status}(${KIND_TX[kindOf(x.status)]}) · ${x.ms}ms${x.err ? " · " + x.err : ""}`));
  const hasErr = (o.failures || []).some((x) => x.err);
  if ((o.failures || []).length && !hasErr) L.push("※ 원인 요약은 이 기능을 배포한 뒤 새로 생긴 실패부터 기록돼요(이전 실패는 상태 코드만 남아 있음).");
  L.push("", "== 최근 피킹지 판독 " + (o.picks || []).length + "건 ==");
  if (!(o.picks || []).length) L.push("(없음)");
  (o.picks || []).forEach((x) => L.push(x));
  return L.join("\n");
}

module.exports = { SOURCES, ensure, log, timed, stats, kstDay, kstMonthStart, kindOf, mask, errSummary, failureDetail, failureGroups, buildDiagText };
