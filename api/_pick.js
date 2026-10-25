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
const GEMINI_TIMEOUT_MS = 35000;

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
- shipType: '택배유형' 아래 인쇄된 값(예: "용차", "CJ택배"). 없으면 null
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

날짜(10/15 등)·시간(13:05 등)·피킹/검수 칸의 서명, 빨강·파랑 펜으로 그은 동그라미·체크·계산 메모(예: "145,116,24,+2,+1")는 모두 무시해. 숫자 1 은 짧은 세로선이나 약간 기울어진 선으로, 숫자 7 은 윗줄이 구부러져 "ㄱ"처럼 보일 수 있다. PLT 는 읽을 수 없으면 null 로 두되, 완박스·혼재박스는 위 규칙대로 숫자(또는 empty)로만 답해.`;

async function callGemini(b64, mime, fetchFn, apiKey) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: mime || "image/jpeg", data: b64 } }] }],
        generationConfig: { temperature: 0.0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: ctl.signal,
    });
    const j = await r.json();
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    if (!txt) return { ok: false, err: (j.error && j.error.message) || "AI 응답 없음" };
    const obj = JSON.parse(String(txt).replace(/```json/gi, "").replace(/```/g, "").trim());
    const o = Array.isArray(obj) ? obj[0] || {} : obj;
    return { ok: true, data: o && typeof o === "object" ? o : {} };
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
function handRegions(vr) {
  const words = visionWords(vr);
  const hW = findWord(words, /^완박스$/)[0];
  const hH = findWord(words, /^혼재박스$/)[0];
  const anchor = hW || hH;
  if (!anchor) return null;
  const hdr = words.filter((w) => /^(날짜|피킹|검수|완박스|혼재박스)$/.test(w.t) && sameRow(w, anchor));
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
주의: 날짜(10/23 등)·시간·피킹/검수 칸의 서명·이니셜, 펜으로 그은 동그라미·체크·계산 메모는 값이 아니다. 완박스·혼재박스 칸에는 숫자만 쓰이며, 숫자 1은 짧은 세로선, 7은 위에 가로선이 있는 꼴일 수 있다. 칸이 비었으면 반드시 "empty".`;

async function rereadHandwriting(imgs, mime, fetchFn, apiKey) {
  const list = (Array.isArray(imgs) ? imgs : []).filter((x) => typeof x === "string" && x.length > 200).slice(0, 2);
  if (!list.length) return { ok: false, err: "그림이 없습니다" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const parts = [{ text: REREAD_PROMPT }];
    list.forEach((b64, i) => { parts.push({ text: `그림 ${i + 1}:` }); parts.push({ inline_data: { mime_type: mime || "image/jpeg", data: b64 } }); });
    const r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } } }),
      signal: ctl.signal,
    });
    const j = await r.json();
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text;
    if (!txt) return { ok: false, err: (j.error && j.error.message) || "AI 응답 없음" };
    const obj = JSON.parse(String(txt).replace(/```json/gi, "").replace(/```/g, "").trim());
    return { ok: true, data: normReread(Array.isArray(obj) ? obj[0] : obj) };
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "2차 판독 시간 초과" : "2차 판독 오류" };
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
  const out = { parses: rows.length, registered: 0, fields: {}, company: { n: 0, ok: 0 }, mismatches: [], reread: { n: 0, used: 0, errors: 0 } };
  FIELDS.forEach(([k, , lab]) => { out.fields[k] = { label: lab, n: 0, first: 0, second: 0, secondN: 0, agreeN: 0, agreeOk: 0, diffN: 0, diffFirstOk: 0, diffSecondOk: 0, diffNeither: 0 }; });
  for (const r of rows) {
    const P = r.parsed || {}, S = r.reread || null, F = r.final || null;
    if (S && S.error) out.reread.errors++;
    if (S && !S.error) out.reread.used++;
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
      const pOk = p !== null && p !== undefined && Number(p) === fnum;
      if (pOk) f.first++;
      if (s !== undefined) {
        f.secondN++;
        const sOk = s !== null && Number(s) === fnum;
        if (sOk) f.second++;
        const agree = p !== null && p !== undefined && s !== null && Number(p) === Number(s);
        if (agree) { f.agreeN++; if (pOk) f.agreeOk++; }
        else { f.diffN++; if (pOk) f.diffFirstOk++; else if (sOk) f.diffSecondOk++; else f.diffNeither++; }
      }
      if (!pOk && out.mismatches.length < 30) out.mismatches.push({ orderNo: r.order_no || "", field: lab, parsed: p === undefined ? null : p, reread: s === undefined ? null : s, final: fnum });
    }
  }
  return out;
}

// ───────────────────────── 인쇄값 추출 (Vision) ─────────────────────────
function extractPrinted(vr) {
  const words = visionWords(vr);
  const text = fullText(vr);
  const res = { orderNo: null, customer: null, address: null, buyerNote: null, shipType: null, printedAt: null, shipDate: null, sbox: null, rbox: null };

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
    .replace(/[\s()\[\]{}·.,\-_/\\:：]/g, "");
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
  const shipType = clean(printed.shipType) || clean(g.shipType);
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
  const [v, g] = await Promise.all([
    callVision(b64, fetchFn, opts.visionKey),
    callGemini(b64, mime, fetchFn, opts.geminiKey),
  ]);
  if (!v.ok) errs.push(v.err);
  if (!g.ok) errs.push(g.err);
  if (!v.ok && !g.ok) return { ok: false, err: errs.join(" / ") };
  const printed = v.ok ? extractPrinted(v.data) : {};
  const hw = v.ok ? extractHandwritingVision(v.data) : {};
  const out = reconcile(printed, hw, g.ok ? g.data : {}, errs);
  try { out.hwRegions = v.ok ? handRegions(v.data) : null; } catch (_) { out.hwRegions = null; }
  out.ok = true;
  return out;
}

module.exports = { handRegions, rereadHandwriting, normReread, computePickStats, canonCompany, shortsOf, LEGACY_COMP_MAP, parsePicking, reconcile, extractPrinted, extractHandwritingVision, matchCompany, normName, visionWords, validDate, datesFromNote, floorFromAddress, judgeHandwriting };
