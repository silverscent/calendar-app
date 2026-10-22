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

const GEMINI_PROMPT = `이 이미지는 물류센터 '피킹 리스트'(출고 작업지시서)의 마지막 장을 폰으로 찍은 사진이다(약간 기울거나 그림자가 있을 수 있음). 아래 값을 JSON 객체 하나로만 출력해.

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
- wanbox: 표 '완박스' 칸 바로 아래 손으로 쓴 숫자(정수, 예: 108, 285). 칸이 비어 있으면 "empty", 쓰여 있는데 읽을 수 없으면 null
- honjae: 표 '혼재박스' 칸 바로 아래 손으로 쓴 숫자(정수). 칸이 비어 있으면 "empty", 읽을 수 없으면 null
- addToExisting: 손글씨 영역(특히 PLT 근처)에 "기존에 추가", "기존 추가", "추가", "합산"처럼 '같은 날 나가는 같은 업체의 이미 잡힌 출고 건에 더한다'는 뜻의 글이 있으면 true, 없으면 false
- handNote: 위 뜻의 손글씨 원문(예: "기존에추가"). 없으면 null
- uncertain: 값을 확신하지 못하는 키 이름 배열

날짜(10/15 등)·시간(13:05 등)·피킹/검수 칸의 서명, 빨강·파랑 펜으로 그은 동그라미·체크·계산 메모(예: "145,116,24,+2,+1")는 모두 무시해. 숫자 1 은 짧은 세로선이나 약간 기울어진 선으로 쓰일 수 있다. 읽을 수 없는 값은 추측하지 말고 null 로 둬.`;

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
  if (Math.abs(theta) > (12 * Math.PI) / 180) theta = 0;
  const c = Math.cos(-theta), s = Math.sin(-theta);
  return raw.map((r) => {
    const x = r.cx * c - r.cy * s, y = r.cx * s + r.cy * c;
    return { t: r.t, cx: x, cy: y, w: r.w, h: r.h, x0: x - r.w / 2, x1: x + r.w / 2, y0: y - r.h / 2, y1: y + r.h / 2 };
  });
}
const fullText = (vr) => (vr && vr.responses && vr.responses[0] && vr.responses[0].fullTextAnnotation && vr.responses[0].fullTextAnnotation.text) || "";
const findWord = (words, re) => words.filter((w) => re.test(w.t));
const sameRow = (a, b) => Math.abs(a.cy - b.cy) <= Math.max(a.h, b.h) * 0.8;
const rightOf = (words, lab, extra) =>
  words
    .filter((w) => w !== lab && w.x0 >= lab.x1 - 2 && sameRow(w, lab) && (!extra || extra(w)))
    .sort((a, b) => a.x0 - b.x0);
const joinW = (ws) => ws.map((w) => w.t.replace(/^[:：]/, "")).filter((t) => t && !/^[:：]$/.test(t)).join(" ").trim();

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
  while ((m = re2.exec(masked))) push(baseY, +m[1], +m[2]);
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
  if (alias && alias[p] && names.includes(alias[p])) return { status: "alias", company: alias[p], candidates: [alias[p]] };
  const exact = names.filter((n) => normName(n) === p || (compDb[n] && compDb[n].shortName && normName(compDb[n].shortName) === p));
  if (exact.length === 1) return { status: "exact", company: exact[0], candidates: exact };
  let contain = names.filter((n) => {
    const k = normName(n);
    const s = compDb[n] && compDb[n].shortName ? normName(compDb[n].shortName) : "";
    return (k.length >= 3 && (p.includes(k) || k.includes(p))) || (s.length >= 3 && (p.includes(s) || s.includes(p)));
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
  const cands = contain.length > 1 ? contain.slice(0, 5) : ranked;
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

  const orderNo = clean(printed.orderNo) || clean(g.orderNo);
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
  } else if (P.empty) {
    flags.plt = { level: "red", msg: "PLT 가 적혀 있지 않음 — 직접 입력 (없으면 0)" };
  }
  const plt = P.val, wan = W.val, hon = H.val;
  // '기존에 추가': AI 또는 문자인식 중 하나라도 보면 후보로 제시(화면에서 사용자가 새 일정/추가를 최종 선택)
  const gAdd = g.addToExisting === true || String(g.addToExisting).toLowerCase() === "true";
  const addExisting = !!(gAdd || hw.addExisting);
  const addNote = clean(g.handNote) || hw.addNote || null;
  const box = wan !== null && hon !== null ? wan + hon : null;
  if (!orderNo) setFlag("orderNo", { level: "orange", msg: "출고지시번호를 읽지 못함 — 중복 등록 방지가 동작하지 않음" });
  if (!customer) setFlag("customer", { level: "red", msg: "출고처명을 읽지 못함 — 직접 선택" });

  return {
    orderNo, customer, address, floor, buyerNote, shipType, shipDate, shipDateNote,
    plt, wanbox: wan, honjae: hon, box, sbox, rbox,
    addExisting, addNote,
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
  out.ok = true;
  return out;
}

module.exports = { parsePicking, reconcile, extractPrinted, extractHandwritingVision, matchCompany, normName, visionWords, validDate, datesFromNote, floorFromAddress, judgeHandwriting };
