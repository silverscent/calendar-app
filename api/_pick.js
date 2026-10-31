// api/_pick.js — 출고 '피킹 리스트' 사진 판독 v2 (파일명이 _ 로 시작 → 별도 API 가 아니라 calendar.js 가 require 해서 사용)
//
//  읽는 값
//   · 인쇄:   출고지시번호, 출고처명, 주의사항(주소 → 호수로 층 구분), 구매처 비고(날짜가 적혀 있기도 함), 택배유형, 출력일시, Sum 줄 RBOX/SBOX(참고용)
//   · 손글씨: PLT(파렛트 수), 완박스, 혼재박스   ※ 날짜·시간·서명·펜 표시(동그라미/체크/빨간 숫자)는 무시
//   · 박스 수 = 완박스 + 혼재박스 (완박스는 같은 출고의 다른 피킹리스트까지 합친 총합이라 인쇄 SBOX 와 다른 게 정상)
//  규칙
//   · 완박스/혼재박스 칸이 비어 있으면 0 (오류 아님)
//   · PLT·완박스·혼재박스가 전부 비어 있으면 '작성 전 피킹지' → 등록 불가(unfinished)
//   · 인쇄 SBOX 로는 값을 채우거나 경고하지 않음 (참고 표시만)
//   · 빨강(red) = 직접 채워야 함 / 주황(orange) = 참고(다시 확인)
"use strict";

const VISION_TIMEOUT_MS = 15000;
let GEMINI_TIMEOUT_MS = 45000; // 판독 한 번에 AI 가 쓸 수 있는 전체 시간(서버 한도 60초·앱 대기 55초 안)
let REREAD_TIMEOUT_MS = 35000; // 2차 판독(앱은 40초까지 기다림)
let ATTEMPT_MS = 20000; // AI 한 번 시도(키·모델 하나)가 이 시간 안에 응답하지 않으면 그 시도를 끊고 다음 모델·키로 넘어감
const SLOW_COOL_MS = 3 * 60 * 1000; // 응답이 없던 키·모델은 이 시간 동안 맨 뒤 순서로 미룸(건너뛰지는 않음 — 한도와 달리 일시적으로 느린 것일 수 있어서)
const _slowUntil = {}; // "키id|모델" → 이 시각까지 순서만 뒤로
function _setTimeouts(o) { o = o || {}; if (o.attempt) ATTEMPT_MS = o.attempt; if (o.total) GEMINI_TIMEOUT_MS = o.total; if (o.reread) REREAD_TIMEOUT_MS = o.reread; } // (시험용)

// ───────────────────────── 외부 호출 ─────────────────────────
async function callVision(b64, fetchFn, apiKey) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), VISION_TIMEOUT_MS);
  try {
    const r = await fetchFn(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: b64 }, features: [{ type: "TEXT_DETECTION" }] }] }),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (j.error || !Array.isArray(j.responses)) return { ok: false, err: (j.error && j.error.message) || "응답 형식 오류" };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "문자인식 시간 초과" : "문자인식 오류" };
  } finally {
    clearTimeout(timer);
  }
}

const GEMINI_PROMPT = `이 이미지는 물류센터 '피킹 리스트'(출고 작업지시서)의 마지막 장을 폰으로 찍은 사진이다(약간 기울거나 그림자가 있을 수 있고, 종이가 옆으로 눕거나 거꾸로 찍혔을 수도 있으니 글자가 읽히는 방향으로 돌려서 읽을 것). 아래 값을 JSON 객체 하나로만 출력해.

[인쇄된 글자 — 사람이 펜으로 쓴 것은 섞지 말 것]
- orderNo: '출고지시번호' (예: SH2610200371). 없으면 null
- customer: '출고처명' 값 전체(예: "(주)백년가게국제의료기", "메디맥 주식회사"). 없으면 null
- address: '주의사항' 줄의 전체 텍스트(주소·호수 포함). 없으면 null
- buyerNote: '구매처 비고' 칸의 텍스트 전체(예: "10월발주) 10/21(수) 부탁드립니다."). 비어 있으면 null
- shipType: '택배유형' 머리글 아래 인쇄된 값(예: "용차", "용마택배", "CJ택배"). 표 아래쪽 '비고 | 택배유형' 두 칸 중 오른쪽 칸이고, 값이 칸 왼쪽 끝에 붙어 있어 '비고' 칸 쪽에 가깝게 보일 수 있다. '용마택배' 처럼 택배 회사 이름이 보이면 그대로 적어라. 없으면 null
- printedAt: 맨 위 '출력일시' (YYYY-MM-DD HH:MM:SS). 없으면 null
- sbox: 표 맨 아래 Sum 줄에서 'SBOX' 열의 인쇄된 숫자(소수 가능). 펜으로 덧쓴 숫자·동그라미는 무시. 없으면 null
- rbox: Sum 줄에서 'RBOX' 열의 인쇄된 숫자. 없으면 null

[손글씨 — 맨 아래 손으로 적는 영역]
- plt: 크게 동그라미 친 "NPLT" 의 N (예: "4PLT" → 4, "11PLT" → 11, "1plt 기존에추가" → 1). 정수. 적힌 게 전혀 없으면 "empty", 있는데 읽을 수 없으면 null
- wanbox: 표 '완박스' 칸 바로 아래 손으로 쓴 숫자(정수, 예: 7, 108, 285). 이 칸에는 숫자만 쓰이며 아무것도 안 쓰였으면 "empty". 뭔가 쓰여 있으면 반드시 가장 그럴듯한 숫자로 답하고(모양이 흐트러져도 null 금지) 확신이 없으면 uncertain 에 "wanbox" 를 넣어.
- honjae: 표 '혼재박스' 칸 바로 아래 손으로 쓴 숫자(정수). 숫자만 쓰이며 아무것도 안 쓰였으면 "empty". 뭔가 쓰여 있으면 가장 그럴듯한 숫자로 답하고(null 금지) 확신이 없으면 uncertain 에 "honjae" 를 넣어.
- 완박스·혼재박스 칸 찾기: 사진이 기울거나 비스듬해도 '완박스'·'혼재박스' 머리글 바로 아래 칸만 본다. 옆 칸(날짜·피킹·검수)의 서명·이니셜·동그라미 글씨는 그 칸의 숫자가 아니다.
- addToExisting: 손글씨 영역(특히 PLT 근처)에 "기존에 추가", "기존 추가", "추가", "합산"처럼 '같은 날 나가는 같은 업체의 이미 잡힌 출고 건에 더한다'는 뜻의 글이 있으면 true, 없으면 false
- mergeToExisting: (손글씨가 아니라 인쇄된 '구매처 비고'가) 같은 날 나가는 다른 건과 합쳐서 보내라는 뜻이면 true. 예: "28일 용차 합배", "합차 부탁", "기존 건과 같이 보내주세요", "동봉". 단순 날짜·일반 요청만 있으면 false
- handNote: 위 뜻의 손글씨 원문(예: "기존에추가"). 없으면 null
- uncertain: 값을 확신하지 못하는 키 이름 배열

날짜(10/15 등)·시간(13:05 등)·피킹/검수 칸의 서명, 빨강·파랑 펜으로 그은 동그라미·체크·계산 메모(예: "145,116,24,+2,+1")는 모두 무시해. 숫자 1 은 짧은 세로선이나 약간 기울어진 선("/" 처럼 사선 한 줄만 그어진 것도 1)으로, 숫자 7 은 윗줄이 구부러져 "ㄱ"처럼 보일 수 있다. 완박스·혼재박스 칸에 사선(/)이나 세로선 한 줄이라도 있으면 빈칸이 아니라 1 이다 — 세 칸을 모두 empty 로 답하기 전에 칸마다 선이 있는지 한 번 더 확인해. PLT 는 읽을 수 없으면 null 로 두되, 완박스·혼재박스는 위 규칙대로 숫자(또는 empty)로만 답해. 두 자리 숫자도 있다: 세로선·사선이 나란히 두 개면 11, 세 개면 111 이니 한 개로 합쳐 읽지 말고 선의 개수를 하나씩 세어서 답한다(예: "11" 을 "1" 로 읽는 것이 가장 흔한 실수).`;

// ── Gemini 키·모델 여러 개 ──
// 키: 첫 키가 한도 초과·과부하·키 오류면 다음 키로(서로 다른 프로젝트의 키여야 한도가 따로 계산됨). 막힌 키는 60초 건너뜀.
// 모델: 새 계정은 옛 모델(gemini-2.5-flash)을 더는 못 쓰는 경우가 있어("no longer available to new users") 그러면 다음 모델로 넘어간다.
//   환경변수 GEMINI_MODEL 로 첫 번째로 쓸 모델을 정할 수 있다. 어느 모델이 되는지는 키마다 기억해 다음부터 바로 쓴다.
// 키는 해시 앞 8자리(kid)로만 기억한다(키 자체를 저장·표시하지 않음). 막힘 상태는 calendar.js 가 DB 에 저장해 서버 인스턴스끼리 공유한다.
let _keyBadUntil = {}, _modelBadUntil = {}, _modelGood = {}, _badWhy = {};
let _rr = Math.floor(Math.random() * 1000); // 키 돌려쓰기 시작점 — 서버 인스턴스마다 무작위
let _lastProbe = 0; // 모든 키가 막혀 있을 때 '혹시 풀렸나' 확인용으로 한 번 시도한 시각
const PROBE_MS = 3 * 60 * 1000; // 전부 막혔을 땐 이 간격으로만 한 번씩 확인(그 사이 요청은 AI 호출 없이 바로 실패 처리 → 한도·시간 절약)
const _crypto = require("crypto");
const kid = (k) => _crypto.createHash("sha256").update(String(k)).digest("hex").slice(0, 8);
// 미국 서부(태평양) 시간 자정까지 남은 밀리초 — 구글의 일일 한도는 이때 초기화된다
function msToPacificMidnight(now) {
  try {
    const p = new Date(now).toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false }).match(/(\d+):(\d+):(\d+)/);
    const h = Number(p[1]) % 24;
    return (24 * 3600 - (h * 3600 + Number(p[2]) * 60 + Number(p[3]))) * 1000;
  } catch (_) { return 6 * 3600 * 1000; }
}
// 한도 오류가 알려 주는 정보로 '언제까지 쉬게 할지' 계산: 하루 한도면 초기화 시각까지, 분당 한도면 안내된 대기 시간(없으면 60초)
function coolMs(j, status, now) {
  const t = errText(j);
  const det = JSON.stringify((j && j.error && j.error.details) || "");
  if (/API_KEY_INVALID|PERMISSION_DENIED|api key (not valid|expired)|invalid api key/i.test(t)) return 10 * 60 * 1000;
  if (Number((j && j.error && j.error.code) || status) === 503 || /UNAVAILABLE|overloaded/i.test(t)) return 30 * 1000; // 과부하는 금방 풀림
  if (/PerDay|per day|daily/i.test(det + " " + t)) return Math.max(60 * 1000, msToPacificMidnight(now || Date.now()) + 60 * 1000);
  const d = det.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  if (d) return Math.min(15 * 60 * 1000, Math.max(10 * 1000, Math.round(Number(d[1]) * 1000) + 1000));
  return 60 * 1000;
}
// 막힘 상태 내보내기/불러오기(DB 공유용). 지난 항목은 버린다.
function exportKeyState(now) {
  const n = now || Date.now(), cut = (o) => Object.keys(o).filter((x) => o[x] > n).reduce((a, x) => ((a[x] = o[x]), a), {});
  const mb = cut(_modelBadUntil), kb = cut(_keyBadUntil);
  const why = {}; Object.keys(mb).concat(Object.keys(kb)).forEach((x) => { if (_badWhy[x]) why[x] = _badWhy[x]; });
  return { keyBad: kb, modelBad: mb, why };
}
function importKeyState(o) {
  if (!o || typeof o !== "object") return;
  const n = Date.now();
  const merge = (dst, src) => Object.keys(src || {}).forEach((k) => { const v = Number(src[k]); if (v > n && v > (dst[k] || 0)) dst[k] = v; });
  merge(_keyBadUntil, o.keyBad); merge(_modelBadUntil, o.modelBad);
  Object.keys(o.why || {}).forEach((k) => { if (!_badWhy[k]) _badWhy[k] = String(o.why[k]).slice(0, 20); });
}
function resetKeyState(onlyRotation) { _rr = 0; _lastProbe = 0; if (onlyRotation) return; _keyBadUntil = {}; _modelBadUntil = {}; _modelGood = {}; _badWhy = {}; for (const k in _slowUntil) delete _slowUntil[k]; } // (시험용)
// 화면 표시용: 키별로 쓸 수 있는지, 막혔다면 어떤 모델이 언제까지 왜
function keyStatus(keys, models, now) {
  const n = now || Date.now();
  const ms = modelList(models && models.length ? models : DEFAULT_MODELS);
  return toKeyList(keys).map((k, i) => {
    const id = kid(k);
    const items = ms.map((m) => ({ model: m, until: _modelBadUntil[id + "|" + m] || 0, why: _badWhy[id + "|" + m] || "" })).filter((x) => x.until > n);
    const kb = _keyBadUntil[id] > n ? _keyBadUntil[id] : 0;
    return { no: i + 1, blocked: !!kb || items.length >= ms.length, keyUntil: kb, keyWhy: kb ? _badWhy[id] || "" : "", items };
  });
}
// 키 하나가 다시 쓸 수 있게 되는 시각(ms). 지금 쓸 수 있으면 0
function recoverAtOf(k, ms, n) {
  const id = kid(k);
  if ((_keyBadUntil[id] || 0) > n) return _keyBadUntil[id];
  const ts = ms.map((m) => _modelBadUntil[id + "|" + m] || 0);
  if (ts.some((t) => t <= n)) return 0;
  return Math.min.apply(null, ts);
}
// 키 여유 정도: ok = 쓸 수 있는 키가 충분 / tight = 키가 여러 개인데 쓸 수 있는 것이 1개 이하 / none = 전부 쉬는 중(retryAt = 가장 먼저 풀리는 시각)
//  화면은 이 값으로 '꼭 필요하지 않은 추가 AI 호출'(보정 재판독·2차 확인·자동 재시도)을 줄인다.
function keyPressure(keys, models, now) {
  const n = now || Date.now();
  const ms = modelList(models && models.length ? models : DEFAULT_MODELS);
  const list = toKeyList(keys);
  const at = list.map((k) => recoverAtOf(k, ms, n));
  const usable = at.filter((t) => t === 0).length;
  const level = !list.length || usable === 0 ? "none" : list.length > 1 && usable <= 1 ? "tight" : "ok";
  const wait = at.filter((t) => t > n);
  return { total: list.length, usable, level, retryAt: usable === 0 && wait.length ? Math.min.apply(null, wait) : 0 };
}
const toKeyList = (k) => (Array.isArray(k) ? k : [k]).map((x) => String(x || "").trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
// 기본 순서: 2.5(가장 빠르고 안정적이나 새 키는 못 씀) → 3.6 → 3.5-lite(마지막 예비: 빠르지만 손글씨 숫자 정확도는 아직 확인 중). 3.8 은 과부하가 잦아 뺐다(시험 버튼으로는 계속 골라 볼 수 있음).
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const modelList = (m) => (Array.isArray(m) ? m : [m]).map((x) => String(x || "").trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
const errText = (j) => String((j && j.error && (j.error.status + " " + j.error.message)) || "");
function isModelGone(j, status) {
  const e = j && j.error;
  if (!e) return false;
  const code = Number(e.code || status || 0);
  return /no longer available|not found|NOT_FOUND|is not supported for generateContent|has been deprecated|decommission/i.test(errText(j)) && (code === 404 || code === 400 || code === 403 || /NOT_FOUND|no longer available/i.test(errText(j)));
}
function isQuotaErr(j, status) {
  const e = j && j.error;
  const code = Number((e && e.code) || status || 0);
  const t = errText(j);
  const keyBad = /API_KEY_INVALID|PERMISSION_DENIED/i.test(t) || /api key (not valid|expired)|invalid api key/i.test(t); // 키가 잘못·만료·정지된 경우도 다음 키로
  return code === 429 || code === 503 || keyBad || /RESOURCE_EXHAUSTED|UNAVAILABLE/i.test(t) || /quota|exhausted|overloaded|rate.?limit|try again later/i.test(t);
}
function failLabel(j, status) {
  const t = errText(j);
  if (isModelGone(j, status)) return "모델 사용 불가";
  if (/API_KEY_INVALID|PERMISSION_DENIED|api key (not valid|expired)|invalid api key/i.test(t)) return "키 오류";
  if (Number(j && j.error && j.error.code) === 503 || /UNAVAILABLE|overloaded/i.test(t)) return "서버 과부하";
  if (isQuotaErr(j, status)) return /PerDay|per day|daily/i.test(JSON.stringify((j && j.error && j.error.details) || "") + " " + t) ? "하루 한도 초과" : "한도 초과";
  return String((j && j.error && j.error.message) || "응답 없음").slice(0, 60);
}
// body: 문자열 또는 (model, opts)=>문자열. models: 모델 이름 하나 또는 배열(앞에 있는 것부터).
// 한도(429)·과부하(503)는 모델마다 따로 계산되므로 같은 키에서 다음 모델을 먼저 시도하고, 그래도 안 되면 다음 키로 간다.
// 반환 { j, status, keyNo, model, quota, trail } — 모두 실패하면 마지막 실패와 시도 내역(trail)을 돌려줌
async function geminiPost(fetchFn, keys, models, body, signal, opt) {
  // opt.side: 곁가지 호출(모델 지정 시험·비교용) — 기본 흐름의 '마지막으로 잘 된 모델' 기억과 전부-막힘 확인 시각을 건드리지 않고, 쓸 수 있는 곳이 없으면 확인 시도 없이 바로 실패
  // opt.force: 쉬는 중으로 표시된 키·모델도 무시하고 시도(모델 지정 시험 — 지정한 모델을 반드시 그 모델로 써 봄)
  opt = opt || {};
  const list = toKeyList(keys);
  const ms = modelList(models);
  const now = Date.now();
  const bad = (k, m) => !opt.force && (_modelBadUntil[kid(k) + "|" + m] || 0) > Date.now();
  const keyBadNow = (k) => !opt.force && (_keyBadUntil[kid(k)] || 0) > now;
  const usable = (k) => !keyBadNow(k) && ms.some((m) => !bad(k, m));
  let order = list.map((k, i) => ({ k, i }));
  const live = order.filter((x) => usable(x.k));
  if (live.length) order = live; // 쓸 수 있는 키만(막힌 키·모델은 건너뜀)
  let probe = null;
  if (!live.length && list.length && opt.side) {
    return { j: { error: { message: "이 모델은 모든 키에서 한도·과부하로 쉬는 중" } }, status: 429, keyNo: 0, model: null, quota: true, anyQuota: true, skipped: true, retryAt: 0, trail: [], attempts: [] };
  }
  if (!live.length && list.length) {
    // 전부 막혀 있음: PROBE_MS 안에는 AI 를 부르지 않고 바로 실패 처리한다(한도를 더 쓰지 않고, 사용자가 35초씩 기다리지도 않게).
    // 그 뒤에는 '혹시 풀렸나' 확인으로 가장 먼저 풀릴 키·모델 하나만 시도한다.
    const nowT = Date.now();
    const press = keyPressure(list, ms, nowT);
    if (nowT - _lastProbe < PROBE_MS) {
      const bl = [];
      list.forEach((k, i) => {
        const id = kid(k);
        if ((_keyBadUntil[id] || 0) > nowT) bl.push({ keyNo: i + 1, model: null, why: _badWhy[id] || "키 오류" });
        else ms.forEach((m) => { if (bad(k, m)) bl.push({ keyNo: i + 1, model: m, why: _badWhy[id + "|" + m] || "한도 초과" }); });
      });
      return { j: { error: { message: "AI 키가 모두 한도에 걸려 쉬는 중" } }, status: 429, keyNo: 0, model: null, quota: true, anyQuota: true, skipped: true, retryAt: press.retryAt, trail: bl, attempts: [] };
    }
    _lastProbe = nowT;
    let bi = 0, bt = Infinity;
    list.forEach((k, i) => { const t = recoverAtOf(k, ms, nowT); if (t < bt) { bt = t; bi = i; } });
    const pk = list[bi], pid = kid(pk);
    const pm = ms.slice().sort((x, y) => (_modelBadUntil[pid + "|" + x] || 0) - (_modelBadUntil[pid + "|" + y] || 0))[0];
    order = [{ k: pk, i: bi }];
    probe = pm;
  }
  if (order.length > 1) { const st = (opt.side && !opt.force ? _rr : _rr++) % order.length; order = order.slice(st).concat(order.slice(0, st)); }
  if (order.length > 1) { // 최근 응답이 없던 모델이 첫 순서인 키는 뒤로(건너뛰지는 않음)
    const slowFirst = (x) => { const id = kid(x.k), pf = _modelGood[id], f = pf && ms.includes(pf) ? pf : ms.find((m) => !bad(x.k, m)); return f && (_slowUntil[id + "|" + f] || 0) > Date.now() ? 1 : 0; };
    order = order.map((x, n) => ({ x, n, s: slowFirst(x) })).sort((a, b) => a.s - b.s || a.n - b.n).map((o) => o.x);
  } // 쓸 수 있는 키들을 번갈아 먼저 쓴다(한 키에 몰리지 않게)
  let last = { j: { error: { message: "AI 키 없음" } }, status: 0, keyNo: 0, model: null, quota: false, trail: [] };
  const trail = [], attempts = []; // attempts: 이번 호출에서 실제로 보낸 시도 내역(키·모델·성공 여부·걸린 시간) — 화면의 '판독 상세'에 보여 줌
  let anyQuota = false;
  const fin = () => { const pr = keyPressure(list, ms); if (pr.level === "none" && !opt.side) _lastProbe = Date.now(); return Object.assign(last, { anyQuota, retryAt: pr.retryAt }); }; // retryAt: 전부 막혔을 때 가장 먼저 풀리는 시각. 방금 전부 막힌 걸 알았으니 확인 시도 간격도 지금부터 셈
  for (const { k, i } of order) {
    const id = kid(k);
    const pref = _modelGood[id];
    const base = pref && ms.includes(pref) ? [pref].concat(ms.filter((x) => x !== pref)) : ms;
    const isSlow = (m) => (_slowUntil[id + "|" + m] || 0) > Date.now();
    const mlist = base.filter((m) => !bad(k, m)).sort((a, b) => (isSlow(a) ? 1 : 0) - (isSlow(b) ? 1 : 0)); // 막힌 모델은 건너뛰고, 최근 응답이 없던 모델은 맨 뒤로(안정 정렬)
    for (const m of probe ? [probe] : mlist) {
      // 시도 하나마다 제한 시간을 둔다: 응답이 없는 키·모델에 전체 시간(45초)을 다 쓰지 않고 곧바로 다음으로 넘어가기 위함
      const ac = new AbortController();
      let slow = false;
      const tid = setTimeout(() => { slow = true; ac.abort(); }, ATTEMPT_MS);
      const relay = () => ac.abort();
      if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener("abort", relay); }
      const send = (opts) => fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "function" ? body(m, opts) : body, signal: ac.signal,
      });
      const ta = Date.now();
      let r, j;
      try {
        r = await send(); j = await r.json();
        if (typeof body === "function" && j && j.error && Number(j.error.code || r.status) === 400 && /thinking/i.test(errText(j))) { r = await send({ noThink: true }); j = await r.json(); } // 이 모델이 생각 설정을 모르면 설정 없이
      } catch (e) {
        clearTimeout(tid); if (signal) signal.removeEventListener("abort", relay);
        if (slow && !(signal && signal.aborted)) { // 이 시도만 응답이 없었음(전체 제한 시간은 아직 남음) → 기록하고 잠시 건너뛴 뒤 다음 모델·키로
          const why0 = "시간 초과";
          attempts.push({ keyNo: i + 1, model: m, ok: false, why: why0, ms: Date.now() - ta });
          trail.push({ keyNo: i + 1, model: m, why: why0 });
          _slowUntil[id + "|" + m] = Date.now() + SLOW_COOL_MS;
          last = { j: { error: { message: "AI 응답 시간 초과" } }, status: 0, keyNo: i + 1, model: m, quota: false, trail, attempts };
          continue;
        }
        if (signal && signal.aborted) { // 전체 제한 시간이 다 됨: 어느 키·모델에서 멈췄는지 남기고(다음 요청이 같은 곳에서 또 멈추지 않게 잠시 건너뜀) 바로 실패로 돌려줌
          attempts.push({ keyNo: i + 1, model: m, ok: false, why: "시간 초과", ms: Date.now() - ta });
          trail.push({ keyNo: i + 1, model: m, why: "시간 초과" });
          _slowUntil[id + "|" + m] = Date.now() + SLOW_COOL_MS;
          last = { j: { error: { message: "AI 판독 시간 초과" } }, status: 0, keyNo: i + 1, model: m, quota: false, trail, attempts };
          return fin();
        }
        throw e; // 그 밖의 오류(통신 실패 등) → 호출한 쪽이 처리
      }
      clearTimeout(tid); if (signal) signal.removeEventListener("abort", relay);
      const hasErr = !!(j && j.error);
      attempts.push({ keyNo: i + 1, model: m, ok: !hasErr, why: hasErr ? failLabel(j, r.status) : "", ms: Date.now() - ta });
      const gone = hasErr && isModelGone(j, r.status);
      const quota = hasErr && !gone && isQuotaErr(j, r.status);
      last = { j, status: r.status, keyNo: i + 1, model: m, quota, trail, attempts };
      if (!hasErr) { delete _slowUntil[id + "|" + m]; _keyBadUntil[id] = 0; delete _modelBadUntil[id + "|" + m]; delete _badWhy[id + "|" + m]; if (!opt.side) _modelGood[id] = m; return Object.assign(last, { anyQuota: false, retryAt: 0 }); }
      const why = failLabel(j, r.status);
      trail.push({ keyNo: i + 1, model: m, why });
      if (gone) { _modelBadUntil[id + "|" + m] = Date.now() + 6 * 3600 * 1000; _badWhy[id + "|" + m] = why; continue; } // 이 키로는 이 모델을 못 씀 → 다음 모델
      if (quota) {
        anyQuota = true;
        const until = Date.now() + coolMs(j, r.status, Date.now());
        if (/API_KEY_INVALID|PERMISSION_DENIED|api key (not valid|expired)|invalid api key/i.test(errText(j))) { _keyBadUntil[id] = until; _badWhy[id] = why; break; } // 키 자체 문제 → 다음 키
        _modelBadUntil[id + "|" + m] = until; _badWhy[id + "|" + m] = why; // 이 모델만 한도·과부하 → 같은 키의 다음 모델
        continue;
      }
      return fin(); // 요청 자체 오류 등은 키·모델을 바꿔도 소용없음
    }
  }
  return fin();
}
// 실패 사유 문장: 키가 여러 개면 "키1: 한도 초과 / 키2: 모델 사용 불가" 처럼 키별로
function geminiWhy(g) {
  const t = (g && g.trail) || [];
  if (!t.length) return (g && g.j && g.j.error && g.j.error.message) || "AI 응답 없음";
  const by = {};
  t.forEach((x) => { (by[x.keyNo] = by[x.keyNo] || []).push(x.why); });
  const keys = Object.keys(by);
  const one = (w) => w.filter((x, i, a) => a.indexOf(x) === i).join("·");
  return ("AI " + (keys.length > 1 ? keys.map((k) => `키${k} ${one(by[k])}`).join(" / ") : one(by[keys[0]]))).slice(0, 120);
}
// 🔑 키·모델 점검(시스템 관리자가 버튼으로 실행): 키마다 ① 구글에 '쓸 수 있는 모델 목록'을 묻고(호출 한도를 쓰지 않음) ② 모델마다 아주 작은 글자 요청을 한 번씩 보내 실제로 되는지 본다.
//  막힘 상태(쉬는 키·모델 기록)는 건드리지 않는다. 키 자체는 결과에 넣지 않는다(번호만).
async function testKeys(fetchFn, keys, models, extra) {
  const ks = toKeyList(keys), main = modelList(models), ex = modelList(extra).filter((m) => !main.includes(m));
  const tmo = () => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000); return { signal: c.signal, done: () => clearTimeout(t) }; };
  const one = async (k, i) => {
    const out = { no: i + 1, listed: null, listErr: null, models: [] };
    try {
      const ids = []; let tok = "";
      for (let pg = 0; pg < 3; pg++) {
        const tm = tmo();
        let r, j;
        try { r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${k}${tok ? "&pageToken=" + encodeURIComponent(tok) : ""}`, { signal: tm.signal }); j = await r.json(); } finally { tm.done(); }
        if (j && j.error) { out.listErr = failLabel(j, r.status); break; }
        ((j && j.models) || []).forEach((x) => ids.push(String(x.name || "").replace(/^models\//, "")));
        tok = (j && j.nextPageToken) || "";
        if (!tok) break;
      }
      if (!out.listErr) out.listed = ids;
    } catch (e) { out.listErr = e && e.name === "AbortError" ? "목록 조회 시간 초과" : "목록 조회 실패"; }
    out.models = await Promise.all(main.concat(ex).map(async (m) => {
      const row = { model: m, extra: ex.includes(m), ok: false, ms: 0, why: "", until: 0, listed: out.listed ? out.listed.includes(m) : null };
      const t0 = Date.now(), tm = tmo();
      try {
        const send = (opts) => fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: tm.signal,
          body: JSON.stringify({ contents: [{ parts: [{ text: "숫자 1만 답해." }] }], generationConfig: Object.assign({ maxOutputTokens: 64 }, genCfg(m, opts)) }),
        });
        let r = await send(), j = await r.json();
        if (j && j.error && Number(j.error.code || r.status) === 400 && /thinking/i.test(errText(j))) { r = await send({ noThink: true }); j = await r.json(); }
        if (j && j.error) { row.why = failLabel(j, r.status); if (isQuotaErr(j, r.status) && !isModelGone(j, r.status)) row.until = Date.now() + coolMs(j, r.status, Date.now()); }
        else row.ok = true;
      } catch (e) { row.why = e && e.name === "AbortError" ? "시간 초과(20초)" : "통신 실패"; }
      finally { tm.done(); row.ms = Date.now() - t0; }
      return row;
    }));
    return out;
  };
  return Promise.all(ks.map(one));
}
// 시스템 관리자가 시험용으로 고를 수 있는 모델(화면 버튼 이름 → 모델 id). 이 목록 밖의 값은 무시한다
const PIN_MODELS = { "2.5": "gemini-2.5-flash", "3.8": "gemini-3.8-flash", "3.6": "gemini-3.6-flash", "lite": "gemini-3.5-flash-lite" };
const SHADOW_MODEL = PIN_MODELS.lite; // 비교 기록용으로 뒤에서 한 번 더 읽어 볼 모델
const resolvePin = (v) => { const t = String(v == null ? "" : v).trim(); if (PIN_MODELS[t]) return PIN_MODELS[t]; return Object.values(PIN_MODELS).includes(t) ? t : null; };
const GEMINI_MODELS = () => modelList([process.env.GEMINI_MODEL].concat(DEFAULT_MODELS));
// 2.5 계열만 thinkingBudget 설정을 알고 있다. 다른 계열은 설정을 빼서 모델이 정한 기본값을 쓴다(알 수 없는 옵션으로 400 이 나는 것을 막음)
//   3.x 계열은 생각을 끌 수 없고(공식 문서상 gemini-3.8-flash 는 low 가 가장 낮음) 기본값(medium)이면 느려지므로 thinkingLevel "low" 로 줄인다.
//   그 설정을 서버가 거부하면(thinking 관련 400) geminiPost 가 설정 없이 한 번 더 보낸다(opts.noThink).
const genCfg = (m, opts) => Object.assign({ temperature: 0.0, responseMimeType: "application/json" }, /^gemini-2\.5/.test(m) ? { thinkingConfig: { thinkingBudget: 0 } } : opts && opts.noThink ? {} : { thinkingConfig: { thinkingLevel: "low" } });
async function callGemini(b64, mime, fetchFn, apiKey, pin, side) { // pin: 이 모델 하나만 사용(시험) / side: 곁가지 호출(비교 기록)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const g = await geminiPost(fetchFn, apiKey, pin ? [pin] : GEMINI_MODELS(), (m, o) => JSON.stringify({
      contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: mime || "image/jpeg", data: b64 } }] }],
      generationConfig: genCfg(m, o),
    }), ctl.signal, pin ? { side: true, force: !side } : undefined);
    const j = g.j;
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    if (!txt) return { ok: false, err: j && j.error ? geminiWhy(g) : "AI 응답 없음", quota: !!g.anyQuota, retryAt: g.retryAt || 0, attempts: g.attempts || [], skipped: !!g.skipped };
    const obj = JSON.parse(String(txt).replace(/```json/gi, "").replace(/```/g, "").trim());
    const o = Array.isArray(obj) ? obj[0] || {} : obj;
    return { ok: true, data: o && typeof o === "object" ? o : {}, model: g.model, keyNo: g.keyNo, attempts: g.attempts || [] };
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "AI 판독 시간 초과" : "AI 판독 오류" };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── Vision 단어 → 좌표 (기울기 보정 포함) ─────────────────────────
// 사진이 기울어 있으면 칸·줄 판단이 어긋나므로, 단어 윗변 기울기의 중앙값을 페이지 기울기로 보고 좌표를 되돌려 놓는다.
function visionWords(vr) {
  const raw = [];
  const ann = vr && vr.responses && vr.responses[0] && vr.responses[0].textAnnotations;
  if (!Array.isArray(ann)) return raw;
  for (let i = 1; i < ann.length; i++) {
    const a = ann[i];
    const vs = (a.boundingPoly && a.boundingPoly.vertices) || [];
    if (vs.length < 4) continue;
    const P = vs.map((v) => ({ x: v.x || 0, y: v.y || 0 }));
    const cx = (P[0].x + P[1].x + P[2].x + P[3].x) / 4, cy = (P[0].y + P[1].y + P[2].y + P[3].y) / 4;
    const w = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y), h = Math.hypot(P[3].x - P[0].x, P[3].y - P[0].y);
    raw.push({ t: String(a.description || ""), cx, cy, w, h, ang: Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) });
  }
  // 페이지 기울기 = 길쭉한 단어들(글자 한두 개 제외)의 윗변 각도 중앙값. ±12° 를 넘으면 보정하지 않음(오판 방지)
  const angs = raw.filter((r) => r.w > r.h * 2.2 && r.t.length >= 3).map((r) => r.ang).sort((a, b) => a - b);
  let theta = angs.length >= 5 ? angs[Math.floor(angs.length / 2)] : 0;
  // 종이가 옆으로(90°)·거꾸로(180°) 찍힌 사진도 바로 세운다: 가장 가까운 90° 배수에서 ±12° 이내면 그 각도 그대로 되돌림.
  //   (단어 꼭짓점은 글자가 읽히는 방향 기준이라, 누운 종이는 각도가 ±90°·180° 근처로 나온다)
  {
    const q = Math.PI / 2, k = Math.round(theta / q), resid = theta - k * q;
    if (Math.abs(resid) > (12 * Math.PI) / 180) theta = 0;
  }
  const c = Math.cos(-theta), s = Math.sin(-theta);
  const outW = raw.map((r) => {
    const x = r.cx * c - r.cy * s, y = r.cx * s + r.cy * c;
    return { t: r.t, cx: x, cy: y, w: r.w, h: r.h, x0: x - r.w / 2, x1: x + r.w / 2, y0: y - r.h / 2, y1: y + r.h / 2 };
  });
  outW.theta = theta; // 되돌린 각도(라디안) — 좌표를 원래 사진 좌표로 다시 돌릴 때 필요
  return outW;
}
const fullText = (vr) => (vr && vr.responses && vr.responses[0] && vr.responses[0].fullTextAnnotation && vr.responses[0].fullTextAnnotation.text) || "";
const findWord = (words, re) => words.filter((w) => re.test(w.t));
const sameRow = (a, b) => Math.abs(a.cy - b.cy) <= Math.max(a.h, b.h) * 0.8;
const rightOf = (words, lab, extra) =>
  words
    .filter((w) => w !== lab && w.x0 >= lab.x1 - 2 && sameRow(w, lab) && (!extra || extra(w)))
    .sort((a, b) => a.x0 - b.x0);
const joinW = (ws) => ws.map((w) => w.t.replace(/^[:：]/, "")).filter((t) => t && !/^[:：]$/.test(t)).join(" ").trim();

// ───────────────────────── 손글씨 영역 좌표 (2차 판독용) ─────────────────────────
// 표 머리글('완박스'·'혼재박스' …) 위치를 기준으로 A=머리글 바로 아래 손글씨 줄, B=그 아래 여백(PLT·'기존에추가' 메모)을 잡는다.
// 돌려 놓은 좌표(기울기·옆으로 누운 사진 보정 후)에서 계산한 뒤, 원래 사진 좌표의 사각형으로 되돌려 돌려준다. 못 찾으면 null.
// 같은 줄에서 바로 이어진 두 낱말(예: "혼재" + "박스")을 하나의 머리글처럼 합쳐 돌려줌
function findSplit(words, a, b) {
  for (const x of words.filter((w) => w.t === a)) {
    const y = words.find((w) => w.t === b && sameRow(w, x) && w.cx > x.cx && w.x0 - x.x1 < Math.max(x.h, 30) * 2);
    if (y) return { t: a + b, cx: (x.x0 + y.x1) / 2, cy: (x.cy + y.cy) / 2, w: y.x1 - x.x0, h: Math.max(x.h, y.h), x0: x.x0, x1: y.x1, y0: Math.min(x.y0, y.y0), y1: Math.max(x.y1, y.y1) };
  }
  return null;
}
function handDiag(vr) {
  if (!vr) return { words: 0, note: "문자인식 실패", seen: [] };
  const words = visionWords(vr);
  const seen = words.filter((w) => /박스|완|혼재|날짜|피킹|검수|PLT/i.test(w.t)).slice(0, 14).map((w) => w.t);
  return { words: words.length, seen, tilt: Math.round(((words.theta || 0) * 180) / Math.PI) };
}
function handRegions(vr) {
  const words = visionWords(vr);
  // 머리글이 "완 박스"·"혼재 박스"처럼 쪼개지거나 다른 글자와 붙어 읽혀도 찾는다
  const hW = findWord(words, /^완박스$/)[0] || findWord(words, /완박스/)[0] || findSplit(words, "완", "박스");
  const hH = findWord(words, /^혼재박스$/)[0] || findWord(words, /혼재박스/)[0] || findSplit(words, "혼재", "박스");
  const anchor = hW || hH;
  if (!anchor) return null;
  const hdr = words.filter((w) => /^(날짜|피킹|검수|완박스|혼재박스)$/.test(w.t) && sameRow(w, anchor)).concat([hW, hH].filter((w) => w && !words.includes(w) || (w && !/^(완박스|혼재박스)$/.test(w.t))).filter((w) => sameRow(w, anchor)));
  const left = Math.min(...hdr.map((w) => w.x0)), right = Math.max(...hdr.map((w) => w.x1));
  const width = right - left;
  if (!(width > 80)) return null;
  const hh = Math.max(...hdr.map((w) => w.h));
  const pad = width * 0.03;
  const aTop = Math.min(...hdr.map((w) => w.y0)) - hh * 0.6;
  const aBot = Math.max(...hdr.map((w) => w.y1)) + Math.max(width * 0.075, hh * 8);
  const bBot = aBot + width * 0.5;
  const th = words.theta || 0, ct = Math.cos(th), st = Math.sin(th);
  const toRaw = (x, y) => ({ x: x * ct - y * st, y: x * st + y * ct });
  const box = (x0, y0, x1, y1) => {
    const P = [toRaw(x0, y0), toRaw(x1, y0), toRaw(x1, y1), toRaw(x0, y1)];
    const xs = P.map((q) => q.x), ys = P.map((q) => q.y);
    const bx = Math.max(0, Math.min(...xs)), by = Math.max(0, Math.min(...ys));
    return { x: Math.round(bx), y: Math.round(by), w: Math.round(Math.max(...xs) - bx), h: Math.round(Math.max(...ys) - by) };
  };
  return { A: box(left - pad, aTop, right + pad, aBot), B: box(left - pad, aBot, right + pad, bBot), tilt: Math.round((th * 180) / Math.PI) };
}

// ───────────────────────── 손글씨 2차 판독 (Gemini, 잘라 낸 그림만) ─────────────────────────
const REREAD_PROMPT = `아래 그림은 물류 '피킹 리스트'를 찍은 사진에서 손글씨가 쓰이는 부분만 잘라 확대한 것이다.
- 그림 1: 표 머리글(날짜·피킹·검수·완박스·혼재박스) 바로 아래 손으로 적는 줄
- 그림 2(있으면): 그 아래 여백 — 크게 동그라미 친 "NPLT"(예: 4PLT, 1plt 기존에추가)와 메모가 적히는 곳
(그림이 90도 돌아가 있거나 기울어 있을 수 있으니 글자가 읽히는 방향으로 판단해라)

아래 JSON 하나만 답해라.
{
 "wanbox": 그림 1에서 '완박스' 머리글 바로 아래 칸에 손으로 쓴 숫자(정수). 아무것도 안 쓰였으면 "empty". 쓰여 있는데 읽을 수 없으면 null,
 "honjae": 그림 1에서 '혼재박스' 머리글 바로 아래 칸의 숫자(정수). 아무것도 안 쓰였으면 "empty". 읽을 수 없으면 null,
 "plt": 그림 2(없으면 그림 1)에서 크게 동그라미 친 "NPLT"의 N(정수). 적힌 게 전혀 없으면 "empty". 읽을 수 없으면 null,
 "addToExisting": '기존에 추가'·'기존 추가'·'합산'처럼 같은 날 이미 잡힌 출고 건에 더한다는 뜻의 손글씨가 있으면 true, 없으면 false,
 "handNote": 위 손글씨 원문(없으면 null),
 "uncertain": 값을 확신하지 못하는 키 이름 배열(예: ["wanbox"])
}
주의: 날짜(10/23 등)·시간·피킹/검수 칸의 서명·이니셜, 펜으로 그은 동그라미·체크·계산 메모는 값이 아니다. 완박스·혼재박스 칸에는 숫자만 쓰이며, 숫자 1은 짧은 세로선, 7은 위에 가로선이 있는 꼴일 수 있다. 칸이 비었으면 반드시 "empty". 단 칸 안에 사선(/)·세로선(|) 한 줄이라도 그어져 있으면 비어 있는 게 아니라 숫자 1 이다(글자 모양이 단순해서 빈칸으로 착각하기 쉬우니, 완박스·혼재박스 칸에 선이 있는지 꼭 확인). 세 칸이 모두 "empty" 라고 답하기 전에 칸마다 작은 선이라도 없는지 한 번 더 본다. 두 자리 숫자도 있다: 세로선·사선이 나란히 두 개면 11, 세 개면 111 이니 한 개로 합쳐 읽지 말고 선의 개수를 하나씩 세어서 답한다(예: "11" 을 "1" 로 읽는 것이 가장 흔한 실수).`;

async function rereadHandwriting(imgs, mime, fetchFn, apiKey, pin) {
  const t0r = Date.now();
  const list = (Array.isArray(imgs) ? imgs : []).filter((x) => typeof x === "string" && x.length > 200).slice(0, 2);
  if (!list.length) return { ok: false, err: "그림이 없습니다" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REREAD_TIMEOUT_MS);
  try {
    const parts = [{ text: REREAD_PROMPT }];
    list.forEach((b64, i) => { parts.push({ text: `그림 ${i + 1}:` }); parts.push({ inline_data: { mime_type: mime || "image/jpeg", data: b64 } }); });
    const g = await geminiPost(fetchFn, apiKey, pin ? [pin] : GEMINI_MODELS(), (m, o) => JSON.stringify({ contents: [{ parts }], generationConfig: genCfg(m, o) }), ctl.signal, pin ? { side: true, force: true } : undefined);
    const j = g.j;
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    if (!txt) return { ok: false, err: j && j.error ? geminiWhy(g) : "AI 응답 없음", quota: !!g.anyQuota, retryAt: g.retryAt || 0, ms: Date.now() - t0r, attempts: g.attempts || [] };
    const obj = JSON.parse(String(txt).replace(/```json/gi, "").replace(/```/g, "").trim());
    return { ok: true, data: normReread(Array.isArray(obj) ? obj[0] : obj), ms: Date.now() - t0r, model: g.model, keyNo: g.keyNo, attempts: g.attempts || [] };
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "2차 판독 시간 초과" : "2차 판독 오류" };
  } finally {
    clearTimeout(timer);
  }
}
// ───────────────────────── 입고 OCR 대조: 의심 줄 AI 다시 읽기 ─────────────────────────
// items: [{ n, img(base64) }] — 앱이 의심 줄만 잘라 보낸 그림(줄마다 1장, 위·아래 이웃 줄이 조금 같이 찍힘). 한 번의 AI 호출로 여러 줄을 읽는다.
const OCR_ROW_PROMPT = `아래 그림들은 입고 스케줄 표(인쇄된 표)를 찍은 사진에서 '한 줄'씩 잘라 낸 것이다. 각 그림 위에 번호(그림 n)가 붙어 있다.
그림 한 장에는 읽을 줄이 딱 하나뿐이다. 위·아래 가장자리에 반쯤 잘려 보이는 다른 줄의 글자는 절대 읽지 않는다(그림에 줄이 하나만 보이면 그 줄이다).
인쇄된 글자가 그림 안에 온전히 보이는 줄만 읽고, 다른 그림의 내용과 섞지 않는다.
열 순서(왼쪽→오른쪽): B/L, PAL(숫자), ETA(날짜), 입고일(날짜), FWD(포워더), 유형(SEA/AIR 등), 인보이스(7~8자리 숫자 또는 PI-…), 비고(자유 문장, 없을 수 있음).
각 칸에 '인쇄된 글자 그대로' 적어라. 날짜는 YYYY-MM-DD 로. 값이 없는 칸은 "" , 글자가 있는데 읽을 수 없으면 null.
추측해서 채우지 말 것(특히 B/L·인보이스는 한 글자씩 정확히, O/0·I/1·S/5·B/8 을 구별).
아래 JSON 배열 하나만 답해라:
[{"n":그림번호,"bl":"","pal":"","eta":"","inDate":"","fwd":"","sType":"","invoice":"","etc":""}, ...]`;
const OCR_ROW_KEYS = ["bl", "pal", "eta", "inDate", "fwd", "sType", "invoice", "etc"];
function normOcrRowReread(arr, wantNs) {
  const out = {};
  (Array.isArray(arr) ? arr : []).forEach((o) => {
    if (!o || typeof o !== "object") return;
    const n = parseInt(o.n, 10);
    if (!(wantNs || []).includes(n)) return;
    const r = {};
    OCR_ROW_KEYS.forEach((k) => {
      const v = o[k];
      if (v === null || v === undefined) return; // 읽지 못함 → 비교 안 함
      r[k] = String(v).replace(/\s+/g, " ").trim().slice(0, 120);
    });
    out[n] = r;
  });
  return out;
}
async function rereadOcrRows(items, fetchFn, apiKey) {
  const t0 = Date.now();
  const list = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.img === "string" && x.img.length > 200).slice(0, 8);
  if (!list.length) return { ok: false, err: "그림이 없습니다" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REREAD_TIMEOUT_MS);
  try {
    const parts = [{ text: OCR_ROW_PROMPT }];
    list.forEach((it) => { parts.push({ text: `그림 ${it.n}:` }); parts.push({ inline_data: { mime_type: "image/jpeg", data: it.img } }); });
    const g = await geminiPost(fetchFn, apiKey, GEMINI_MODELS(), (m, o) => JSON.stringify({ contents: [{ parts }], generationConfig: genCfg(m, o) }), ctl.signal);
    const j = g.j;
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    if (!txt) return { ok: false, err: j && j.error ? geminiWhy(g) : "AI 응답 없음", quota: !!g.anyQuota, retryAt: g.retryAt || 0, ms: Date.now() - t0, attempts: g.attempts || [] };
    const obj = JSON.parse(String(txt).replace(/```json/gi, "").replace(/```/g, "").trim());
    return { ok: true, rows: normOcrRowReread(obj, list.map((x) => x.n)), ms: Date.now() - t0, model: g.model, keyNo: g.keyNo, attempts: g.attempts || [] };
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "AI 판독 시간 초과" : "AI 판독 오류" };
  } finally {
    clearTimeout(timer);
  }
}

// 2차 판독 결과를 화면이 쓰기 쉬운 꼴로: 숫자 | "empty" | null
function normReread(o) {
  o = o && typeof o === "object" ? o : {};
  const one = (v) => {
    if (v === "empty") return "empty";
    const n = toInt(v);
    return n !== null && n >= 0 && n <= 9999 ? n : null;
  };
  return {
    plt: one(o.plt), wanbox: one(o.wanbox), honjae: one(o.honjae),
    addToExisting: o.addToExisting === true || String(o.addToExisting).toLowerCase() === "true",
    handNote: typeof o.handNote === "string" ? o.handNote.slice(0, 40) : null,
    uncertain: Array.isArray(o.uncertain) ? o.uncertain.filter((k) => ["plt", "wanbox", "honjae"].includes(k)) : [],
  };
}

// ───────────────────────── 판독 정확도 집계 ─────────────────────────
// rows: [{ order_no, parsed:{...}, reread:{...}|null, final:{...}|null }]  — 등록까지 끝난(final 있는) 행만 정확도에 쓴다.
// 필드값: 숫자 | "empty" | null. 완박스·혼재박스·PLT 의 'empty' 는 0 으로 본다(등록 때 빈칸=0).
function computePickStats(rows) {
  const zero = (v) => (v === "empty" ? 0 : v);
  const FIELDS = [["plt", "plt", "PLT"], ["wanbox", "wan", "완박스"], ["honjae", "hon", "혼재박스"]];
  const out = { parses: rows.length, registered: 0, fields: {}, company: { n: 0, ok: 0 }, mismatches: [], reread: { n: 0, used: 0, errors: 0 }, timing: null, retries: { rot: 0, enh: 0 }, hw: { n: 0, found: 0 }, unreg: 0, cross: { n: 0, same: 0, skipped: 0, fields: {}, diffs: [] }, models: [], shadow: { n: 0, fail: 0, agreeN: 0, agree: 0, diffs: [] } };
  FIELDS.forEach(([k]) => { out.cross.fields[k] = { n: 0, same: 0 }; });
  FIELDS.forEach(([k, , lab]) => { out.fields[k] = { label: lab, n: 0, first: 0, second: 0, secondN: 0, agreeN: 0, agreeOk: 0, diffN: 0, diffFirstOk: 0, diffSecondOk: 0, diffNeither: 0 }; });
  const tt = [], tv = [], tg = [], kb = [], byModel = {};
  const mstat = {}; // 모델별 정확도(AI 가 직접 읽은 값 기준): { n: 읽은 건수, nf: 사람이 확정한 건수, ok: {필드: 맞은 수}, pinned: 지정 시험 건수, ms: [걸린 시간] }
  const mget = (m) => (mstat[m] = mstat[m] || { model: m, n: 0, nf: 0, ok: { plt: 0, wanbox: 0, honjae: 0 }, allOk: 0, pinned: 0, ms: [] });
  const rawNum = (v) => (v === "empty" ? 0 : v === undefined ? null : v);
  for (const r of rows) {
    const P = r.parsed || {}, S = r.reread || null, F = r.final || null;
    if (P.timing && Number(P.timing.total) > 0) { tt.push(Number(P.timing.total)); if (Number(P.timing.vision) > 0) tv.push(Number(P.timing.vision)); if (Number(P.timing.gemini) > 0) { tg.push(Number(P.timing.gemini)); if (P.timing.model) { const mm = (byModel[P.timing.model] = byModel[P.timing.model] || []); mm.push(Number(P.timing.gemini)); } } }
    if (Number(P.kb) > 0) kb.push(Number(P.kb));
    if (P.hwFound === true || P.hwFound === false) { out.hw.n++; if (P.hwFound) out.hw.found++; }
    if (P.meta && P.meta.rot) out.retries.rot++;
    if (P.meta && P.meta.enh) out.retries.enh++;
    if (S && S.error) out.reread.errors++;
    if (S && !S.error) out.reread.used++;
    // 등록하지 않아도 볼 수 있는 신뢰도: 1차 판독과 2차 판독(손글씨 줄만 잘라 다시 읽기)이 같은 값인지. 정답은 모르지만 서로 다르면 어느 한쪽은 틀린 것이다.
    //   (한쪽이 '못 읽음' 이고 다른 쪽이 0/빈칸이면 빈칸으로 보고 같은 것으로 센다 — 위 blankOk 와 같은 규칙)
    if (!F) out.unreg++;
    // 모델별 비교: 주 판독(AI 가 직접 읽은 값)과 곁가지 lite 판독 각각을 사람이 확정한 값과 견줌
    for (const [src, isShadow] of [[P.aiRaw, false], [P.shadow && P.shadow.ok ? P.shadow : null, true]]) {
      if (!src || !src.model) continue;
      const ms = mget(src.model);
      ms.n++;
      if (!isShadow && P.pinned) ms.pinned++;
      const tm = isShadow ? src.ms : P.timing && P.timing.gemini;
      if (Number(tm) > 0) ms.ms.push(Number(tm));
      if (F) {
        ms.nf++;
        let all = true, any = false;
        for (const [k, fk] of FIELDS) {
          const fin = F[fk];
          if (fin === undefined || fin === null || fin === "") continue;
          any = true;
          const fnum = Number(fin), v = rawNum(src[k]);
          const ok = (v !== null && Number(v) === fnum) || (v === null && fnum === 0);
          if (ok) ms.ok[k]++; else all = false;
        }
        if (any && all) ms.allOk++;
      }
    }
    if (P.shadow) {
      if (P.shadow.ok) {
        out.shadow.n++;
        if (P.aiRaw && P.aiRaw.model !== P.shadow.model) {
          out.shadow.agreeN++;
          const same = FIELDS.every(([k]) => { const a = rawNum(P.aiRaw[k]), b = rawNum(P.shadow[k]); return (a !== null && b !== null && Number(a) === Number(b)) || (a === null && b === 0) || (b === null && a === 0); });
          if (same) out.shadow.agree++;
          else if (out.shadow.diffs.length < 20) out.shadow.diffs.push({ orderNo: r.order_no || "", main: { model: P.aiRaw.model, plt: P.aiRaw.plt, wanbox: P.aiRaw.wanbox, honjae: P.aiRaw.honjae }, lite: { plt: P.shadow.plt, wanbox: P.shadow.wanbox, honjae: P.shadow.honjae }, final: F ? { plt: F.plt, wan: F.wan, hon: F.hon } : null });
        }
      } else out.shadow.fail++;
    }
    if (S && !S.error) {
      out.cross.n++;
      let allSame = true; const items = [];
      const shOk = !!(P.shadow && P.shadow.ok); // 곁가지 lite 판독이 있으면 세 번째 의견으로 같이 보여준다
      const FIN = { plt: "plt", wanbox: "wan", honjae: "hon" };
      for (const [k, , lab] of FIELDS) {
        const p = zero(P[k]), q = zero(S[k]);
        const pn = p === null || p === undefined, qn = q === null || q === undefined;
        const same = (!pn && !qn && Number(p) === Number(q)) || (pn && q === 0) || (qn && p === 0);
        const cf = out.cross.fields[k]; cf.n++;
        if (same) cf.same++; else {
          allSame = false;
          const it = { field: lab, first: pn ? null : Number(p), second: qn ? null : Number(q) };
          if (shOk) { const l = zero(P.shadow[k]); it.lite = l === null || l === undefined ? null : Number(l); }
          // 다수결: 1차·2차·lite 중 두 곳 이상이 같은 값(못 읽음=빈칸=0)이면 그 값
          const votes = [pn ? 0 : Number(p), qn ? 0 : Number(q)].concat(shOk ? [it.lite === null ? 0 : it.lite] : []);
          const cnt = {}; votes.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
          const top = Object.keys(cnt).filter((v) => cnt[v] >= 2)[0];
          if (top !== undefined) it.major = Number(top);
          if (F && F[FIN[k]] !== undefined && F[FIN[k]] !== null && F[FIN[k]] !== "") it.final = Number(F[FIN[k]]); // 등록한 건이면 사람이 확정한 값
          items.push(it);
        }
      }
      if (allSame) out.cross.same++;
      else {
        // 같은 출고지시번호를 여러 번 시험한 건은 한 줄로 합침(최신 기록 기준, ×횟수 표시)
        const ex = out.cross.diffs.find((d) => d.orderNo && d.orderNo === (r.order_no || ""));
        if (ex) ex.n++;
        else if (out.cross.diffs.length < 20) out.cross.diffs.push({ orderNo: r.order_no || "", n: 1, m1: (P.aiRaw && P.aiRaw.model) || (P.timing && P.timing.model) || null, m2: S._m || null, items });
      }
    } else if (P.hwAgree === true && !(S && S.error)) out.cross.skipped++; // AI 와 문자인식이 세 칸을 같게 읽어 2차 확인을 생략한 건
    if (!F) continue;
    out.registered++;
    if (P.company && F.company) { out.company.n++; if (String(P.company) === String(F.company)) out.company.ok++; }
    for (const [k, fk, lab] of FIELDS) {
      const fin = F[fk];
      if (fin === undefined || fin === null || fin === "") continue;
      const f = out.fields[k];
      const p = zero(P[k]), s = S && !S.error ? zero(S[k]) : undefined;
      const fnum = Number(fin);
      f.n++;
      // 종이에 아무것도 안 적힌 칸(실제 0)을 판독기가 "못 읽음(null)"로 돌려준 뒤 사람이 0을 넣은 경우는 틀린 판독이 아니라 맞은 것으로 센다
      const blankOk = (v) => (v === null || v === undefined) && fnum === 0;
      const pOk = (p !== null && p !== undefined && Number(p) === fnum) || blankOk(p);
      if (pOk) f.first++;
      if (s !== undefined) {
        f.secondN++;
        const sOk = (s !== null && Number(s) === fnum) || blankOk(s);
        if (sOk) f.second++;
        const agree = (p !== null && p !== undefined && s !== null && Number(p) === Number(s)) || (blankOk(p) && blankOk(s));
        if (agree) { f.agreeN++; if (pOk) f.agreeOk++; }
        else { f.diffN++; if (pOk) f.diffFirstOk++; else if (sOk) f.diffSecondOk++; else f.diffNeither++; }
      }
      if (!pOk && out.mismatches.length < 30) out.mismatches.push({ orderNo: r.order_no || "", field: lab, parsed: p === undefined ? null : p, reread: s === undefined ? null : s, final: fnum });
    }
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  out.models = Object.keys(mstat).map((m) => { const x = mstat[m]; return { model: x.model, n: x.n, nf: x.nf, ok: x.ok, allOk: x.allOk, pinned: x.pinned, msAvg: avg(x.ms) }; }).sort((a, b) => b.n - a.n);
  if (tt.length) out.timing = { n: tt.length, avg: avg(tt), max: Math.max(...tt), over20: tt.filter((x) => x > 20000).length, visionAvg: avg(tv), geminiAvg: avg(tg), kbAvg: avg(kb), models: Object.keys(byModel).map((m) => ({ model: m, n: byModel[m].length, avg: avg(byModel[m]) })) };
  return out;
}

// ───────────────────────── 인쇄값 추출 (Vision) ─────────────────────────
function extractPrinted(vr) {
  const words = visionWords(vr);
  const text = fullText(vr);
  const res = { orderNo: null, customer: null, address: null, buyerNote: null, shipType: null, shipScan: null, printedAt: null, shipDate: null, sbox: null, rbox: null };

  const m = text.match(/\b([A-Z]{2,3}\d{9,12})\b/);
  if (m) res.orderNo = m[1];

  const pa = text.match(/출력일시\s*[:：]?\s*(\d{4})[-./](\d{2})[-./](\d{2})/);
  if (pa) res.printedAt = `${pa[1]}-${pa[2]}-${pa[3]}`;

  const lab = findWord(words, /^출고처명$/)[0];
  if (lab) { const v = joinW(rightOf(words, lab)); if (v) res.customer = v; }

  const adr = findWord(words, /^주의사항$/)[0];
  if (adr) { const v = joinW(rightOf(words, adr)); if (v) res.address = v; }

  // 구매처 비고: '구매처' 오른쪽의 '비고' 라벨 → 그 오른쪽 같은 줄
  const buyer = findWord(words, /^구매처$/)[0];
  if (buyer) {
    const bl = rightOf(words, buyer).find((w) => /^비고$/.test(w.t));
    if (bl) { const v = joinW(rightOf(words, bl)); if (v) res.buyerNote = v; }
  }

  // 택배유형: 같은 줄 왼쪽의 '비고' 머리글과 '택배유형' 머리글 사이를 경계로, 오른쪽 칸(값은 칸 왼쪽에 붙어 인쇄됨)의 첫 값
  const th = findWord(words, /^택배유형$/)[0];
  if (th) {
    const left = words.filter((w) => /^비고$/.test(w.t) && sameRow(w, th) && w.x1 < th.x0).sort((a, b) => b.x1 - a.x1)[0];
    const midX = left ? (left.cx + th.cx) / 2 : th.cx - 260;
    const below = words
      .filter((w) => w.cy > th.cy + th.h * 0.6 && w.cy < th.cy + th.h * 5 && w.cx > midX)
      .sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    if (below.length) {
      const first = below[0];
      const line = below.filter((w) => sameRow(w, first)).sort((a, b) => a.x0 - b.x0);
      res.shipType = joinW(line) || null;
    }
  }

  // 택배유형 칸 위치를 못 잡았거나 값이 어긋난 경우를 위한 보조: 문서 전체 글자에서 '용마택배·CJ택배…' 를 직접 찾음
  //   (문서에는 택배 회사명 + '택배' 가 택배유형 칸 말고는 거의 나오지 않음)
  {
    const flat = text.replace(/\s+/g, "");
    const sm = flat.match(/(용마|CJ대한통운|CJ|씨제이|대한통운|한진|롯데|로젠|우체국)택배/i);
    if (sm) res.shipScan = sm[0];
  }

  // 출고일 라벨이 따로 있으면(드묾) 그 오른쪽 날짜
  const dl = findWord(words, /^출고(예정)?일(자)?$/)[0];
  if (dl) {
    const near = joinW(rightOf(words, dl));
    const dm = near.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
    if (dm) res.shipDate = `${dm[1]}-${String(dm[2]).padStart(2, "0")}-${String(dm[3]).padStart(2, "0")}`;
  }

  // Sum 줄: SBOX/RBOX 머리글과 같은 열의 숫자(펜으로 덧쓴 숫자가 옆에 있어도 열이 다르면 제외). 참고용 값.
  const sum = findWord(words, /^sum$/i)[0];
  if (sum) {
    const nums = words.filter((w) => w !== sum && w.x0 > sum.x1 && Math.abs(w.cy - sum.cy) <= Math.max(w.h, sum.h) * 1.2 && /^\d+(\.\d+)?$/.test(w.t));
    const colVal = (hdr) => {
      if (!hdr) return null;
      const c = nums.filter((w) => Math.abs(w.cx - hdr.cx) <= Math.max(hdr.w * 0.8, 30)).sort((a, b) => Math.abs(a.cx - hdr.cx) - Math.abs(b.cx - hdr.cx))[0];
      return c ? parseFloat(c.t) : null;
    };
    res.sbox = colVal(findWord(words, /^SBOX$/i)[0]);
    res.rbox = colVal(findWord(words, /^RBOX$/i)[0]);
    if (res.sbox === null && res.rbox === null) {
      const sorted = nums.sort((a, b) => a.x0 - b.x0);
      if (sorted.length >= 3) { res.sbox = parseFloat(sorted[sorted.length - 1].t); res.rbox = parseFloat(sorted[sorted.length - 2].t); }
    }
  }
  return res;
}

// ───────────────────────── 손글씨 (Vision 보조 판독) ─────────────────────────
const ONE_LIKE = /^[1lI|!ㅣ/\\]$/;
function hwDigits(t) {
  t = String(t || "").trim();
  if (/^\d{1,3}$/.test(t)) return parseInt(t, 10);
  if (ONE_LIKE.test(t)) return 1;
  return null;
}
// 반환: 숫자 | undefined(해당 칸에서 아무것도 못 찾음). Vision 은 손글씨를 놓치는 경우가 많아 '없음'을 빈칸으로 단정하지 않는다.
function extractHandwritingVision(vr) {
  const words = visionWords(vr);
  const out = { plt: undefined, wanbox: undefined, honjae: undefined, addExisting: false, addNote: null };
  const hW = findWord(words, /^완박스$/)[0];
  const hH = findWord(words, /^혼재박스$/)[0];
  const colVal = (hd) => {
    if (!hd) return undefined;
    const c = words
      .filter((w) => w.cy > hd.cy + hd.h * 0.8 && w.cy < hd.cy + hd.h * 5 && Math.abs(w.cx - hd.cx) <= Math.max(hd.w * 1.2, 60))
      .sort((a, b) => a.cy - b.cy)[0];
    const v = c ? hwDigits(c.t) : null;
    return v === null ? undefined : v;
  };
  out.wanbox = colVal(hW);
  out.honjae = colVal(hH);
  const below = hW || hH;
  // PLT: 표 아래 '4PLT' · '11PLT' · 'IPLt' 꼴 (분리돼 읽히면 숫자 단어 + PLT 단어)
  const cand = words.filter((w) => (!below || w.cy > below.cy) && /^(\d{1,2}|[Il|])\s*P\s*L?\s*T?([가-힣].*)?$/i.test(w.t)); // '1plt기존에추가' 처럼 붙여 써도 숫자만 취함
  // '기존에 추가' 류 손글씨: 표 아래(손글씨 영역) 단어에서만 찾음 — 인쇄 영역의 '추가' 같은 글자와 섞이지 않게
  if (below) {
    const addW = words.filter((w) => w.cy > below.cy && /기존|추가|합산|합쳐|더해/.test(w.t));
    if (addW.length) { out.addExisting = true; out.addNote = addW.map((w) => w.t).join(" ").slice(0, 40); }
  }
  if (cand.length) {
    const t = cand[0].t.match(/^(\d{1,2}|[Il|])/);
    out.plt = t ? (/^\d/.test(t[1]) ? parseInt(t[1], 10) : 1) : undefined;
  } else if (below) {
    const p = words.find((w) => w.cy > below.cy + below.h * 3 && /^P\s*L?\s*T$/i.test(w.t));
    if (p) {
      const num = words.filter((w) => w !== p && sameRow(w, p) && w.x1 <= p.x0 + 4 && p.x0 - w.x1 < p.h * 3 && /^\d{1,2}$/.test(w.t)).sort((a, b) => b.x1 - a.x1)[0];
      if (num) out.plt = parseInt(num.t, 10);
    }
  }
  return out;
}

// 구매처 비고 속 '합쳐서 보내라' 표현 (딱 정해진 말은 아니라 AI 판단(mergeToExisting)과 함께 쓴다)
const MERGE_RE = /합\s*배|합\s*차|합쳐|합포|합\s*출고|(?:같이|함께)\s*(?:배송|보내|출고|나가|실어)|동봉|묶어/;

// ───────────────────────── 날짜 (구매처 비고 등 자유 문장) ─────────────────────────
// "10월발주) 10/21(수) 부탁드립니다." → 10/21.  'N월' 만 있고 일이 없는 표현(10월발주)은 날짜로 보지 않는다.
function datesFromNote(note, printedAt) {
  const t = String(note || "");
  if (!t) return [];
  const base = String(printedAt || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const baseY = base ? +base[1] : new Date().getFullYear();
  const baseD = base ? new Date(+base[1], +base[2] - 1, +base[3]) : new Date();
  const found = [];
  const seen = new Set();
  const push = (y, mo, d) => {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return;
    let yy = y;
    let dt = new Date(yy, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return;
    const key = `${mo}-${d}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ mo, d, y: yy, dt });
  };
  let m;
  const full = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?/g;
  const masked = t.replace(full, (all, y, mo, d) => { push(+y, +mo, +d); return " "; });
  const re1 = /(?<![\d.])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d.]|\s*[:시])/g; // 10/21  (소수 1.5·전화번호·시각은 날짜로 보지 않음)
  while ((m = re1.exec(masked))) push(baseY, +m[1], +m[2]);
  const re2 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g; // 10월 21일
  const masked2 = masked.replace(re2, (all, mo, d) => { push(baseY, +mo, +d); return " "; });
  // '28일 용차 합배' 처럼 월 없이 일만 적은 경우 → 출력일 기준 가장 가까운 앞날(이미 지난 날이면 다음 달). 다른 날짜가 하나도 없을 때만.
  //   '3일 이내'·'2일 전' 같은 기간 표현은 날짜가 아님
  if (!found.length) {
    const re3 = /(?<![\d월./-])(\d{1,2})\s*일(?!\s*(?:이내|이후|이상|이하|전|후|간|동안|치|분|째|정도))/g;
    while ((m = re3.exec(masked2))) {
      const d = +m[1];
      if (d < 1 || d > 31) continue;
      let mo = baseD.getMonth() + 1, yy = baseD.getFullYear();
      if (d < baseD.getDate()) { mo += 1; if (mo > 12) { mo = 1; yy += 1; } }
      push(yy, mo, d);
    }
  }
  // 연도 보정
  return found.map((f) => {
    let { y, mo, d } = f;
    let dt = new Date(y, mo - 1, d);
    if (y === baseY && baseD - dt > 183 * 86400000) dt = new Date(y + 1, mo - 1, d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  });
}

// ───────────────────────── 업체 매칭 ─────────────────────────
const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/㈜|\(주\)|\(유\)|\(재\)|\(사\)|주식회사|유한회사/g, "")
    // 끝에 붙은 "(II)" "(Ⅱ)" 같은 로마자 구분 표시는 같은 업체로 본다 (인쇄본에만 붙는 경우가 많음)
    .replace(/\(\s*[ivxⅰ-ⅹⅠ-Ⅹl1|]{1,4}\s*\)\s*$/i, "")
    .replace(/[\s()\[\]{}·.,\-_/\\:：]/g, "")
    // 앤/엔 같이 자주 헷갈리는 글자는 같은 글자로 본다
    .replace(/앤/g, "엔")
    // 메디칼/메디컬, 메디맥/메디멕, 써/서 처럼 인쇄·손글씨에서 자주 바뀌는 글자도 같은 글자로 본다
    .replace(/컬/g, "칼").replace(/멕/g, "맥").replace(/캐/g, "케").replace(/써/g, "서").replace(/쎄/g, "세");
// ── 업체 약어·옛 이름 사전 (출고 화면 out.js 의 compFullMap 과 같은 내용 — 한쪽을 고치면 다른 쪽도 고칠 것) ──
// 화면은 약어를 정식명으로 바꿔 저장하지만, 옛 데이터·손으로 쓴 이름에는 약어/옛 이름이 남아 있을 수 있어 서버도 같은 사전으로 맞춘다.
const LEGACY_COMP_MAP = {
  // 💡 1. 약어를 새 이름으로 연결
  메2: "(주)메디맥 2층",
  메디맥2층: "(주)메디맥 2층",
  메3: "(주)메디맥 3층",
  메디맥3층: "(주)메디맥 3층",
  메뱅: "(주)메디뱅크",
  메써: "메디칼써프라이",
  서호: "서호메디코",
  엠코: "엠코리아토탈서비스",
  국제: "백년가게국제의료기",
  드림: "드림케어메디칼",
  지엔: "지엔씨메딕",
  지엔씨: "지엔씨메딕",
  링랩: "링크더랩",
  링크: "링크더랩",
  위비: "위드비아",
  위드: "위드비아",
  하메: "하이메드",
  하이: "하이메드",
  스엠: "스마트엠케어",
  스마: "스마트엠케어",
  제니: "제니스엠지",
  세람: "세람메디칼",

  // 🚨 2. [가장 중요!] 과거 DB에 박혀있는 옛날 이름을 -> '새 이름'으로 강제 세탁!!
  "메디맥 주식회사 2층": "(주)메디맥 2층",
  "메디맥 주식회사 3층": "(주)메디맥 3층",
  "메디멕 주식회사 2층": "(주)메디맥 2층", // 멕/맥 오타까지 방어
  "메디멕 주식회사 3층": "(주)메디맥 3층",
  제니스: "제니스엠지",
  국제의료기: "백년가게국제의료기",
};
const _LEGACY_N = {};
Object.keys(LEGACY_COMP_MAP).forEach((k) => { const nk = normName(k); if (nk) _LEGACY_N[nk] = LEGACY_COMP_MAP[k]; });
// CRM 약어 칸에 "메3, 메디맥3" 처럼 여러 개를 적어도 각각 약어로 취급
function shortsOf(entry) {
  const s = entry && entry.shortName ? String(entry.shortName) : "";
  return s.split(/[,，/·;]+/).map((x) => normName(x)).filter(Boolean);
}
// 어떤 이름(정식명·CRM 약어·옛 약어/옛 이름)이든 마스터 업체명(compDb 의 키)으로 환원. 못 찾거나 애매하면 null
function canonCompany(name, compDb) {
  const n = normName(name);
  if (!n) return null;
  const names = Object.keys(compDb || {});
  const full = names.find((f) => normName(f) === n);
  if (full) return full;
  const sh = names.filter((f) => shortsOf(compDb[f]).includes(n));
  if (sh.length === 1) return sh[0];
  if (sh.length > 1) return null; // 같은 약어를 쓰는 업체가 여럿 → 애매
  const L = _LEGACY_N[n];
  if (L) {
    const m = names.find((f) => normName(f) === normName(L));
    return m || L;
  }
  return null;
}
function bigrams(s) { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; }
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((g) => { if (B.has(g)) inter++; });
  return inter / (A.size + B.size - inter);
}
// 주소의 호수 → 층: 301호 → 3, 215호 → 2, 1203호 → 12
function floorFromAddress(addr) {
  const m = String(addr || "").match(/(\d{3,4})\s*호/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const f = Math.floor(n / 100);
  return f >= 1 && f <= 60 ? f : null;
}
const floorOfName = (n) => { const m = String(n).match(/(\d{1,2})\s*층/); return m ? parseInt(m[1], 10) : null; };

// compDb: {마스터이름: {shortName,...}}, alias: {정규화된 인쇄이름: 마스터이름}, opts.floor: 주소 호수로 얻은 층
function matchCompany(printed, compDb, alias, opts) {
  const floor = opts && opts.floor;
  const p = normName(printed);
  const names = Object.keys(compDb || {});
  if (!p) return { status: "none", company: null, candidates: [] };
  // 학습된 연결(alias)이 우선이되, 주소 호수로 층이 정해졌는데 연결된 업체의 층과 다르면(메디맥 2층↔3층) 무시하고 아래에서 층으로 고른다
  if (alias && alias[p] && names.includes(alias[p])) {
    const af = floorOfName(alias[p]);
    // 같은 이름이 여러 업체(층 구분)에 걸리는데 호수로 층을 못 정했으면 학습값을 믿지 않고 후보로 보여 준다
    const ambAlias = names.filter((n) => { const k = normName(n); return k.length >= 3 && (k.includes(p) || p.includes(k)); }).length > 1;
    if (!(floor && af !== null && af !== floor) && !(ambAlias && !floor)) return { status: "alias", company: alias[p], candidates: [alias[p]] };
  }
  const exact = names.filter((n) => normName(n) === p || shortsOf(compDb[n]).includes(p));
  if (exact.length === 1) return { status: "exact", company: exact[0], candidates: exact };
  if (exact.length > 1) { // 같은 이름·약어를 쓰는 업체가 여럿 → 층(호수)으로 좁혀지면 그것, 아니면 자동 연결하지 않고 후보로
    const byF = floor ? exact.filter((n) => floorOfName(n) === floor) : [];
    if (byF.length === 1) return { status: "floor", company: byF[0], candidates: byF };
    return { status: "candidates", company: null, candidates: exact.slice(0, 5) };
  }
  // 옛 약어/옛 이름 사전 (엠코·국제·메3 …) 으로 마스터 업체 찾기
  if (exact.length === 0) {
    const cc = canonCompany(printed, compDb);
    if (cc && names.includes(cc)) return { status: "alias", company: cc, candidates: [cc] };
  }
  let contain = names.filter((n) => {
    const k = normName(n);
    const ss = shortsOf(compDb[n]);
    return (k.length >= 3 && (p.includes(k) || k.includes(p))) || ss.some((s) => s.length >= 3 && (p.includes(s) || s.includes(p)));
  });
  // 같은 회사의 층 구분: 주소 호수로 좁힘 (301호 → 3층)
  if (contain.length > 1 && floor) {
    const byFloor = contain.filter((n) => floorOfName(n) === floor);
    if (byFloor.length === 1) return { status: "floor", company: byFloor[0], candidates: byFloor };
  }
  if (contain.length === 1) return { status: "contain", company: contain[0], candidates: contain };
  const rankedS = names
    .map((n) => ({ n, s: similarity(p, normName(n)) }))
    .filter((x) => x.s >= 0.35)
    .sort((a, b) => b.s - a.s);
  // 철자가 한두 글자 다른 정도(유사도 0.5 이상)이고 2등과 충분히 차이 나며, 층 구분 업체가 아니거나 호수로 층이 맞을 때만 자동 연결
  if (!contain.length && rankedS.length && p.length >= 4) {
    const t = rankedS[0], sec = rankedS[1];
    const tf = floorOfName(t.n);
    const floorOk = tf === null ? true : !!floor && tf === floor;
    const siblings = rankedS.filter((x) => floorOfName(x.n) !== null && normName(x.n).replace(/\d+층/, "") === normName(t.n).replace(/\d+층/, ""));
    if (t.s >= 0.5 && (!sec || t.s - sec.s >= 0.2) && floorOk && (tf === null || siblings.length < 2 || floor)) {
      return { status: "fuzzy", company: t.n, candidates: [t.n] };
    }
  }
  const ranked = names
    .map((n) => ({ n, s: Math.max(similarity(p, normName(n)), compDb[n] && compDb[n].shortName ? similarity(p, normName(compDb[n].shortName)) : 0) }))
    .filter((x) => x.s >= 0.35)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map((x) => x.n);
  // 2글자 약어(예: 엠코)는 우연히 겹치기 쉬워 자동 연결하지 않고, 출고처명이 그 약어로 '시작'하면 후보로만 올린다
  let cands = contain.length > 1 ? contain.slice(0, 5) : ranked;
  if (!contain.length) {
    const pre = names.filter((n) => shortsOf(compDb[n]).some((s) => s.length === 2 && p.startsWith(s)));
    Object.keys(_LEGACY_N).forEach((k) => {
      if (k.length === 2 && p.startsWith(k)) {
        const m = names.find((f) => normName(f) === normName(_LEGACY_N[k]));
        if (m && !pre.includes(m)) pre.push(m);
      }
    });
    if (pre.length) cands = pre.concat(cands.filter((c) => !pre.includes(c))).slice(0, 5);
  }
  return { status: cands.length ? "candidates" : "none", company: null, candidates: cands };
}

// ───────────────────────── 종합 ─────────────────────────
const toInt = (v) => {
  if (v === null || v === undefined || v === "" || v === "empty") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return isFinite(n) && n >= 0 && n <= 999 ? n : null;
};
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isFinite(n) && n >= 0 && n < 1000000 ? n : null;
};
const validDate = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y >= 2000 && y <= 2100 ? s : null;
};
const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// 손글씨 한 칸을 AI 값(G) 과 문자인식 값(V) 으로 판정
//   G: 숫자 | "empty" | null/undefined(못 읽음/AI 없음)    V: 숫자 | undefined
//   반환 {val: 숫자|null, empty: bool, flag?: {level,msg}}
function judgeHandwriting(label, G, V, uncertain, key, zeroWhenEmpty) {
  const Gnum = toInt(G);
  const Gempty = G === "empty";
  const unsure = Array.isArray(uncertain) && uncertain.includes(key);
  if (Gnum !== null) {
    if (V !== undefined && V !== Gnum) return { val: Gnum, empty: false, flag: { level: "orange", msg: `${label}: AI ${Gnum} / 문자인식 ${V} — 확인` } };
    if (unsure) return { val: Gnum, empty: false, flag: { level: "orange", msg: `${label}: AI가 확신하지 못함 — 확인` } };
    return { val: Gnum, empty: false };
  }
  if (Gempty) {
    if (V !== undefined) return { val: V, empty: false, flag: { level: "orange", msg: `${label}: AI는 빈칸, 문자인식은 ${V} — 확인` } };
    return { val: zeroWhenEmpty ? 0 : null, empty: true };
  }
  // AI 가 못 읽음 / 실패
  if (V !== undefined) return { val: V, empty: false, flag: { level: "orange", msg: `${label}: AI 판독 없음, 문자인식 값 ${V} — 확인` } };
  return { val: null, empty: false, flag: { level: "red", msg: `${label}: 읽지 못함 — 직접 입력 (없으면 0)` } };
}

// printed: extractPrinted 결과, hw: extractHandwritingVision 결과, g: Gemini 결과
function reconcile(printed, hw, g, errs) {
  printed = printed || {}; hw = hw || {}; g = g || {};
  const flags = {};
  const setFlag = (f, fl) => { if (!fl) return; if (!flags[f] || (flags[f].level === "orange" && fl.level === "red")) flags[f] = fl; };

  const orderNo = ((clean(printed.orderNo) || clean(g.orderNo) || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40)) || null; // 등록 때와 같은 규칙으로 정리(중복판단 키 일치)
  const customer = clean(printed.customer) || clean(g.customer);
  if (clean(printed.customer) && clean(g.customer) && normName(printed.customer) !== normName(g.customer) && similarity(normName(printed.customer), normName(g.customer)) < 0.6)
    setFlag("customer", { level: "orange", msg: `문자인식 "${printed.customer}" / AI "${g.customer}" 불일치` });
  const address = clean(printed.address) || clean(g.address);
  const buyerNote = clean(printed.buyerNote) || clean(g.buyerNote);
  // 택배유형: ① 문서의 택배유형 칸에서 읽은 값(용차·택배 종류처럼 그럴듯할 때만) ② 문서 전체 글자에서 찾은 '○○택배' ③ AI 판독 값
  const _shipOk = (v) => /용차|택배|CJ|씨제이|대한통운|직송|퀵|화물/i.test(String(v || ""));
  const shipType = (_shipOk(printed.shipType) ? clean(printed.shipType) : null) || clean(printed.shipScan) || clean(g.shipType) || clean(printed.shipType);
  const printedAt = validDate(printed.printedAt) || validDate(String(g.printedAt || "").slice(0, 10)) || null;

  // 출고일: 인쇄된 '출고일' 라벨 > 구매처 비고 속 날짜 > 미정
  let shipDate = validDate(printed.shipDate);
  let shipDateNote = null;
  if (!shipDate && buyerNote) {
    const ds = datesFromNote(buyerNote, printedAt).filter(validDate);
    if (ds.length >= 1) {
      shipDate = ds[0];
      setFlag("shipDate", { level: "orange", msg: ds.length > 1 ? `구매처 비고에 날짜가 여러 개(${ds.join(", ")}) — 확인` : `구매처 비고에서 찾은 날짜 — 확인: "${buyerNote}"` });
    }
  }
  // 층: 문자인식 주소와 AI 주소 중 호수가 읽힌 쪽을 사용 (한쪽이 주소를 일부만 읽어도 다른 쪽으로 보완). 둘 다 읽혔는데 다르면 주황
  const fV = floorFromAddress(printed.address), fG = floorFromAddress(g.address);
  const floor = fV !== null ? fV : fG;
  if (fV !== null && fG !== null && fV !== fG) setFlag("customer", { level: "orange", msg: `주소 호수: 문자인식 ${fV}층 / AI ${fG}층 — 업체(층)를 확인하세요` });

  const sbox = toNum(printed.sbox) !== null ? toNum(printed.sbox) : toNum(g.sbox);
  const rbox = toNum(printed.rbox) !== null ? toNum(printed.rbox) : toNum(g.rbox);

  const P = judgeHandwriting("PLT", g.plt, hw.plt, g.uncertain, "plt", false);
  const W = judgeHandwriting("완박스", g.wanbox, hw.wanbox, g.uncertain, "wanbox", true);
  const H = judgeHandwriting("혼재박스", g.honjae, hw.honjae, g.uncertain, "honjae", true);
  setFlag("plt", P.flag); setFlag("wanbox", W.flag); setFlag("honjae", H.flag);

  // 세 칸이 전부 '빈칸' → 작성 전 피킹지
  const unfinished = P.empty && W.empty && H.empty;
  if (unfinished) {
    flags.plt = { level: "red", msg: "PLT·완박스·혼재박스가 모두 비어 있습니다 — 작성 전 피킹지로 보여 등록할 수 없습니다" };
  }
  // '기존에 추가': AI 또는 문자인식 중 하나라도 보면 후보로 제시(화면에서 사용자가 새 일정/추가를 최종 선택)
  const gAdd = g.addToExisting === true || String(g.addToExisting).toLowerCase() === "true";
  const addExisting = !!(gAdd || hw.addExisting);
  // 구매처 비고가 '같은 날 이미 잡힌 출고와 합쳐 보내라'는 뜻(예: "28일 용차 합배")이면 기존 일정에 추가를 먼저 제안한다(최종 선택은 화면에서 사람이)
  const gMerge = g.mergeToExisting === true || String(g.mergeToExisting).toLowerCase() === "true";
  const mergeHint = !!(MERGE_RE.test(String(buyerNote || "")) || gMerge);
  const mergeNote = mergeHint ? String(buyerNote || "").slice(0, 60) || null : null;
  // PLT 가 비어 있고 '기존에 추가' 이면 → 파렛트 없이 박스 수량만 더하는 건 (PLT 0 으로 두고 빨간 경고 없음)
  let pltAddZero = false;
  if (!unfinished && P.empty) {
    if (addExisting || mergeHint) {
      pltAddZero = true;
      delete flags.plt;
    } else {
      flags.plt = { level: "red", msg: "PLT 가 적혀 있지 않음 — 직접 입력 (없으면 0). 기존 일정에 추가라면 비워 두면 박스만 더해져요" };
    }
  }
  const plt = pltAddZero ? 0 : P.val, wan = W.val, hon = H.val;
  const addNote = (clean(typeof g.handNote === "string" ? g.handNote : null) || hw.addNote || "").slice(0, 40) || null;
  const box = wan !== null && hon !== null ? wan + hon : null;
  if (!orderNo) setFlag("orderNo", { level: "orange", msg: "출고지시번호를 읽지 못함 — 중복 등록 방지가 동작하지 않음" });
  if (!customer) setFlag("customer", { level: "red", msg: "출고처명을 읽지 못함 — 직접 선택" });

  return {
    orderNo, customer, address, floor, buyerNote, shipType, shipDate, shipDateNote,
    plt, wanbox: wan, honjae: hon, box, sbox, rbox,
    addExisting, addNote, pltAddZero, mergeHint, mergeNote,
    unfinished, flags,
    ai: g && Object.keys(g).length ? "ok" : "fail",
    errs: errs || [],
  };
}

// ───────────────────────── 진입점 ─────────────────────────
async function parsePicking(b64, mime, opts) {
  const fetchFn = (opts && opts.fetch) || fetch;
  const errs = [];
  const t0 = Date.now();
  const timed = async (p) => { const r = await p; r.ms = Date.now() - t0; return r; }; // 단계별 소요시간(ms) — 어디서 느려지는지 통계로 보기 위함
  const pin = resolvePin(opts && opts.model); // 시스템 관리자가 모델을 지정한 시험 판독이면 그 모델만 사용(기본 흐름·기억에는 영향 없음)
  // 비교 기록: 기본 판독 중이고 키 여유가 충분하면(ok) lite 모델로 같은 사진을 뒤에서 한 번 더 읽어 결과만 남긴다(화면·등록에는 쓰지 않음)
  //   본 판독을 먼저 시작해 키 돌려쓰기·모델 순서가 곁가지 때문에 달라지지 않게 한다
  const pVision = timed(callVision(b64, fetchFn, opts.visionKey));
  const pMain = timed(callGemini(b64, mime, fetchFn, opts.geminiKey, pin, false));
  let shadowP = null;
  try {
    if (!pin && !(opts && opts.shadow === false) && keyPressure(opts.geminiKey, GEMINI_MODELS()).level === "ok") {
      const ts = Date.now();
      shadowP = callGemini(b64, mime, fetchFn, opts.geminiKey, SHADOW_MODEL, true).then((r) => { r.ms = Date.now() - ts; return r; });
    }
  } catch (_) { shadowP = null; }
  const [v, g] = await Promise.all([pVision, pMain]);
  if (!v.ok) errs.push(v.err);
  if (!g.ok) errs.push(g.err);
  if (!v.ok && !g.ok) return { ok: false, err: errs.join(" / ") };
  const printed = v.ok ? extractPrinted(v.data) : {};
  const hw = v.ok ? extractHandwritingVision(v.data) : {};
  const out = reconcile(printed, hw, g.ok ? g.data : {}, errs);
  try { out.hwRegions = v.ok ? handRegions(v.data) : null; } catch (_) { out.hwRegions = null; }
  // 손글씨 칸 위치를 못 찾았을 때 이유를 볼 수 있게: 문자인식이 읽은 글자 수와 머리글 비슷한 글자들
  try { out.hwDiag = out.hwRegions ? null : handDiag(v.ok ? v.data : null); } catch (_) { out.hwDiag = null; }
  // 사진이 옆으로·거꾸로 찍혔는지(도): 화면이 이 값으로 사진을 바로 세워 다시 보낸다. 0 이면 바른 방향
  try { const th = v.ok ? visionWords(v.data).theta || 0 : 0; out.pageTilt = Math.round((th * 180) / Math.PI); } catch (_) { out.pageTilt = 0; }
  // 이 키 여유 정도와 AI 실패 원인(한도 때문인지) — 화면이 '꼭 필요하지 않은 추가 AI 호출'을 줄이고 안내 문구를 고르는 데 쓴다
  out.aiQuota = !g.ok && !!g.quota;
  out.aiRetryAt = !g.ok && g.retryAt ? g.retryAt : 0;
  try { out.pressure = keyPressure(opts.geminiKey, GEMINI_MODELS()); } catch (_) { out.pressure = null; }
  // 손글씨 세 칸을 AI 와 문자인식이 서로 따로 읽어 모두 같은 숫자로 맞으면 2차 확인(AI 한 번 더)을 건너뛸 수 있다
  try {
    const gd = g.ok ? g.data || {} : {};
    out.hwAgree = !!(g.ok && ["plt", "wanbox", "honjae"].every((k) => { const G = toInt(gd[k]); return G !== null && hw[k] !== undefined && hw[k] === G && !(Array.isArray(gd.uncertain) && gd.uncertain.includes(k)); }));
  } catch (_) { out.hwAgree = false; }
  // 모델별 정확도 비교용: 합치기 전 AI 가 직접 읽은 값(모델 이름 포함)과, 곁가지로 읽은 lite 결과
  try {
    const pickRaw = (d) => { const o = {}; ["plt", "wanbox", "honjae"].forEach((k) => { const x = d ? d[k] : undefined; o[k] = x === undefined ? null : x === "empty" ? "empty" : toInt(x); }); return o; };
    out.aiRaw = g.ok ? Object.assign({ model: g.model || null, keyNo: g.keyNo || null }, pickRaw(g.data)) : null;
    out.pinned = pin || null;
    out.shadow = null;
    if (shadowP) {
      const sr = await Promise.race([shadowP, new Promise((r) => setTimeout(() => r({ ok: false, err: "대기 시간 초과", timeout: true }), 3000))]); // 본 판독이 끝난 뒤 최대 3초만 더 기다림
      out.shadow = sr.ok ? Object.assign({ model: SHADOW_MODEL, ok: true, ms: sr.ms || null }, pickRaw(sr.data)) : { model: SHADOW_MODEL, ok: false, err: String(sr.err || "실패").slice(0, 40), ms: sr.ms || null };
      if (sr.skipped) out.shadow = null; // 쉬는 중이라 부르지도 않았으면 기록하지 않음
    }
  } catch (_) { out.shadow = null; }
  out.timing = { total: Date.now() - t0, vision: v.ms || null, gemini: g.ms || null, model: g.ok ? g.model || null : null, keyNo: g.ok ? g.keyNo || null : null, attempts: Array.isArray(g.attempts) ? g.attempts.slice(0, 9) : [], aiSkipped: !!g.skipped, visionOk: !!v.ok, pinned: pin || null };
  out.ok = true;
  return out;
}

module.exports = { PIN_MODELS, SHADOW_MODEL, resolvePin, _setTimeouts, testKeys, keyPressure, geminiPost, geminiWhy, exportKeyState, importKeyState, resetKeyState, keyStatus, coolMs, msToPacificMidnight, DEFAULT_MODELS, GEMINI_MODELS, genCfg, toKeyList, handRegions, rereadHandwriting, normReread, rereadOcrRows, normOcrRowReread, computePickStats, canonCompany, shortsOf, LEGACY_COMP_MAP, parsePicking, reconcile, extractPrinted, extractHandwritingVision, matchCompany, normName, visionWords, validDate, datesFromNote, floorFromAddress, judgeHandwriting };
