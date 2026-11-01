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
async function ensure(pool) {
  if (_ready) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ai_usage_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, day CHAR(10), source VARCHAR(24), provider VARCHAR(12), model VARCHAR(48), key_no TINYINT DEFAULT 0, ok TINYINT DEFAULT 1, status SMALLINT DEFAULT 0, ms INT DEFAULT 0, KEY idx_day (day, source), KEY idx_created (created_at))`,
  );
  _ready = true;
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
    const vals = list.map((r) => [day, String(r.source || "").slice(0, 24), String(r.provider || "").slice(0, 12), String(r.model || "").slice(0, 48), Number(r.keyNo) || 0, r.ok ? 1 : 0, Number(r.status) || 0, Math.max(0, Math.round(Number(r.ms) || 0))]);
    await pool.query(`INSERT INTO ai_usage_log (day, source, provider, model, key_no, ok, status, ms) VALUES ?`, [vals]);
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
      await log(pool, { source, provider: isV ? "vision" : "gemini", model, keyNo, ok: !!res.ok, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      await log(pool, { source, provider: isV ? "vision" : "gemini", model, keyNo, ok: false, status: e && e.name === "AbortError" ? 0 : -1, ms: Date.now() - t0 });
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

module.exports = { SOURCES, ensure, log, timed, stats, kstDay, kstMonthStart, kindOf };
