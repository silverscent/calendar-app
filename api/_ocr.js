// api/_ocr.js — 입고 OCR 읽기 엔진 (앱에서 사진 업로드용)
//
//  · 파일명이 _ 로 시작 → Vercel 이 별도 API 로 만들지 않고 calendar.js 가 require 해서 사용
//  · 아래 '읽기 함수' 5개(attachRowYCoords · joinEtcWords · realignInvoiceEtcByPosition · readTableByGeometry · parseOcrLinesLocal)는
//    telegram.js 의 것을 한 글자도 바꾸지 않고 복사한 것입니다. (telegram.js 는 수정하지 않음 → 텔레그램 /ocr 동작은 그대로)
//  · runOcrPipeline: telegram.js /ocr 의 읽기 순서와 동일
//      Vision(글자+좌표) → 규칙 파싱 → Gemini 교정 → 행 좌표 부착 → 좌표 독립 판독 → 좌표 재배정
//  · cleanEtcText: telegram.js 가 DB 반영 직전 비고에 적용하는 정리 규칙과 동일 (필터·월주·인사말·구분자·길이)
"use strict";

const VISION_TIMEOUT_MS = 15000;

const safeStr = (v, max) =>
  String(v == null ? "" : v)
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim()
    .slice(0, max);

// telegram.js 와 동일한 비고 정리
function cleanEtcText(rawEtc, customFilters) {
  let etc = safeStr(rawEtc, 500);
  (Array.isArray(customFilters) ? customFilters : []).forEach((word) => {
    const cleanWord = String(word || "").trim();
    if (cleanWord) {
      const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      etc = etc.replace(new RegExp(escaped, "g"), "");
    }
  });
  etc = etc.replace(/\d+월\s*(첫|둘째|둘쨋|셋째|셋쨋|넷째|넷쨋|다섯|마지막)?\s*주/g, "");
  etc = etc.replace(/안녕하세요[^가-힣a-z0-9]*/gi, "").replace(/감사합니다\.?/gi, "").replace(/\bregards\b[\s\S]*$/gi, "").replace(/\bthank\s+you\b[\s\S]*$/gi, "");
  etc = etc
    .replace(/^[\s\/,|_|-]+|[\s\/,|_|-]+$/g, "")
    .replace(/\/+/g, "/")
    .trim();
  if (etc.length > 250) etc = etc.substring(0, 250);
  return etc;
}

// telegram.js /ocr 와 같은 읽기 순서. opts: { fetch, visionKey, geminiKey }
async function runOcrPipeline(base64Image, opts) {
  const fetchFn = (opts && opts.fetch) || fetch;
  const startedAt = Date.now();

  // 1) Vision
  const vc = new AbortController();
  const vt = setTimeout(() => vc.abort(), VISION_TIMEOUT_MS);
  let visionData;
  try {
    const r = await fetchFn(`https://vision.googleapis.com/v1/images:annotate?key=${opts.visionKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: base64Image }, features: [{ type: "TEXT_DETECTION" }] }] }),
      signal: vc.signal,
    });
    visionData = await r.json();
  } catch (e) {
    return { ok: false, err: e.name === "AbortError" ? "OCR 응답 지연(시간 초과). 잠시 후 다시 시도해주세요." : "OCR 서버 오류. 잠시 후 다시 시도해주세요.", visionCalled: false };
  } finally {
    clearTimeout(vt);
  }
  if (visionData.error || !Array.isArray(visionData.responses)) {
    return { ok: false, err: `OCR 엔진 오류: ${(visionData.error && visionData.error.message) || "응답 형식 오류"} (API 키 또는 이번 달 할당량을 확인해주세요)`, visionCalled: true };
  }
  const extractedText = (visionData.responses[0] && visionData.responses[0].fullTextAnnotation && visionData.responses[0].fullTextAnnotation.text) || "";
  if (!extractedText) return { ok: false, err: "텍스트를 찾을 수 없습니다.", visionCalled: true };

  // 2) 규칙 파싱
  const parsedResult = parseOcrLinesLocal(extractedText);
  if (parsedResult.length === 0) return { ok: false, err: "인식된 데이터가 없습니다.", visionCalled: true };

  // 3) Gemini 교정 (실패·지연 시 기본 파싱으로 계속)
  let finalRows = parsedResult;
  let aiSuccess = false;
  try {
    const prompt = `너는 물류 데이터베이스 전문 AI 관리자야.\n[원본 텍스트]\n${extractedText}\n[기존 파싱 결과]\n${JSON.stringify(parsedResult)}\n\n[임무 및 규칙]\n1. 빠진 B/L 채워 넣어.\n2. 오타 수정해.\n3. '발행전'은 B/L번호에 넣어.\n4. [bl, pal, eta, inDate, fwd, sType, invoice, etc] 키를 가진 JSON 배열만 출력.`;
    const ac = new AbortController();
    const at = setTimeout(() => ac.abort(), Math.max(5000, Math.min(25000, 52000 - (Date.now() - startedAt))));
    let geminiRes;
    try {
      geminiRes = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${opts.geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(at);
    }
    const geminiJson = await geminiRes.json();
    if (geminiJson.candidates && geminiJson.candidates.length > 0) {
      const aiText = geminiJson.candidates[0].content.parts[0].text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const aiData = JSON.parse(aiText);
      const aiRows = Array.isArray(aiData) ? aiData.filter((o) => o && typeof o === "object" && !Array.isArray(o)) : []; // 문자열·null 같은 잘못된 항목은 버림
      if (aiRows.length > 0) {
        finalRows = aiRows;
        aiSuccess = true;
      }
    }
  } catch (e) {
    /* AI 지연·오류 → 기본 파싱 결과로 계속 */
  }

  // 4) 행 좌표 부착 → 좌표 독립 판독 → 좌표 재배정 (각각 실패해도 본 흐름 유지)
  try { attachRowYCoords(finalRows, visionData); } catch (e) { console.error("행 좌표 매핑 실패:", e); }
  let geo = null;
  try { geo = readTableByGeometry(visionData); } catch (e) { console.error("좌표 독립 판독 실패:", e); geo = null; }
  try { realignInvoiceEtcByPosition(finalRows, visionData); } catch (e) { console.error("좌표 기반 재배정 실패:", e); }

  return { ok: true, rows: finalRows, text: extractedText, geo, aiSuccess, visionCalled: true };
}

// ═════════ 아래는 telegram.js 에서 그대로 복사한 읽기 함수 (1748줄~끝) ═════════
function attachRowYCoords(rows, visionData) {
  if (!Array.isArray(rows) || rows.length === 0 || !visionData) return;
  const anns = visionData.responses && visionData.responses[0] && visionData.responses[0].textAnnotations;
  if (!Array.isArray(anns) || anns.length < 2) return;
  const digits = (v) => (String(v || "").match(/\d+/g) || []).join(""); // 숫자만 추출
  const upper = (v) =>
    String(v || "")
      .toUpperCase()
      .replace(/[\s•·\-\*]/g, ""); // 텍스트 비교용 정규화
  const words = anns.slice(1).map((a) => {
    const vs = (a.boundingPoly && a.boundingPoly.vertices) || [];
    const ys = vs.map((v) => v.y || 0);
    const xs = vs.map((v) => v.x || 0);
    const top = ys.length ? Math.min(...ys) : 0;
    const bot = ys.length ? Math.max(...ys) : 0;
    const lft = xs.length ? Math.min(...xs) : 0;
    const rgt = xs.length ? Math.max(...xs) : 0;
    return {
      d: digits(a.description),
      t: upper(a.description),
      cy: Math.round((top + bot) / 2),
      cx: Math.round((lft + rgt) / 2),
      h: Math.max(1, bot - top),
    };
  });
  const used = new Set();
  // 키(숫자)로 미사용 단어 매칭 (Vision 이 'DSV'와 숫자를 쪼개도 매칭되도록)
  const matchKey = (key) => {
    if (!key || key.length < 6) return null;
    for (let j = 0; j < words.length; j++) {
      if (used.has(j)) continue;
      const wd = words[j].d;
      if (wd && wd.length >= 6 && (wd === key || wd.includes(key) || key.includes(wd))) {
        used.add(j);
        return words[j];
      }
    }
    return null;
  };
  // 1차 B/L 숫자, 2차 인보이스 숫자(발행전 행도 인보이스로 위치 잡힘). 열별 X는 r.cx 에 저장
  rows.forEach((r) => {
    const mb = matchKey(digits(r.bl));
    const mi = matchKey(digits(r.invoice));
    const m = mb || mi;
    if (m) {
      r.iy = m.cy;
      r.ih = m.h;
      r._anc = true; // 실제 단어 위치로 잡힌 행(보간 아님) — realignInvoiceEtcByPosition 에서 사용 후 삭제
    }
    r.cx = {};
    if (mb) r.cx.bl = mb.cx;
    if (mi) r.cx.invoice = mi.cx;
  });
  // 매칭된 앵커들로 평균 행간격(pitch) 추정 → 보간 + 외삽(앞뒤 앵커 없는 구간도 분산)
  const anchors = [];
  rows.forEach((r, i) => {
    if (typeof r.iy === "number") anchors.push({ i, iy: r.iy });
  });
  if (anchors.length === 0) return;
  const pitch =
    anchors.length >= 2
      ? (anchors[anchors.length - 1].iy - anchors[0].iy) / (anchors[anchors.length - 1].i - anchors[0].i)
      : 0;
  for (let i = 0; i < rows.length; i++) {
    if (typeof rows[i].iy === "number") continue;
    let prev = null;
    let next = null;
    for (let a = i - 1; a >= 0; a--)
      if (typeof rows[a].iy === "number") {
        prev = { i: a, iy: rows[a].iy };
        break;
      }
    for (let b = i + 1; b < rows.length; b++)
      if (typeof rows[b].iy === "number") {
        next = { i: b, iy: rows[b].iy };
        break;
      }
    if (prev && next) rows[i].iy = Math.round(prev.iy + (next.iy - prev.iy) * ((i - prev.i) / (next.i - prev.i)));
    else if (prev)
      rows[i].iy = Math.round(prev.iy + (i - prev.i) * pitch); // 뒤쪽(발행전 줄줄이) 외삽
    else if (next) rows[i].iy = Math.round(next.iy - (next.i - i) * pitch); // 앞쪽 외삽
  }

  // 2차: 각 행 Y 근처 단어에서 열별 X 채우기 (eta/입고일/fwd/type) → 탭한 열로 가로 정렬
  rows.forEach((r) => {
    if (typeof r.iy !== "number") return;
    if (!r.cx) r.cx = {};
    const band = Math.max((typeof r.ih === "number" ? r.ih : 20) * 1.4, 16);
    // 왼→오 순으로 정렬 + 이미 쓴 단어는 건너뜀(ETA·입고일 날짜가 같아도 각각 다른 칸에 매칭)
    const near = words.filter((w) => Math.abs(w.cy - r.iy) <= band).sort((a, b) => a.cx - b.cx);
    const usedW = new Set();
    const findDigit = (val) => {
      const k = digits(val);
      if (!k || k.length < 4) return null;
      for (const w of near) {
        if (!usedW.has(w) && w.d === k) {
          usedW.add(w);
          return w.cx;
        }
      }
      return null;
    };
    const findText = (val) => {
      const k = upper(val);
      if (!k) return null;
      for (const w of near) {
        if (!usedW.has(w) && w.t === k) {
          usedW.add(w);
          return w.cx;
        }
      }
      return null;
    };
    const setc = (f, x) => {
      if (typeof x === "number" && r.cx[f] == null) r.cx[f] = x;
    };
    setc("eta", findDigit(r.eta)); // 왼쪽 날짜
    setc("inDate", findDigit(r.inDate)); // 그다음(오른쪽) 날짜
    setc("fwd", findText(r.fwd));
    setc("sType", findText(r.sType));
    // PAL: 1-3자리 짧은 숫자라 findDigit(4자 이상 필터) 우회 — BL 오른쪽 & ETA 왼쪽 범위 내 매칭
    const palStr = digits(String(r.pal || "0"));
    if (palStr && palStr !== "0" && r.cx.pal == null) {
      const blX  = typeof r.cx.bl  === "number" ? r.cx.bl  : 0;
      const etaX = typeof r.cx.eta === "number" ? r.cx.eta : Infinity;
      for (const w of near) {
        if (!usedW.has(w) && w.d === palStr && w.cx > blX && w.cx < etaX) {
          usedW.add(w);
          setc("pal", w.cx);
          break;
        }
      }
    }
  });

  // 3차: 열 위치는 테이블이라 행마다 거의 동일 → 매칭된 X 중앙값을 '전역 열 X'로 만들어 빈 칸 보정
  //      (발행전 행의 B/L 열, 비어있는 ETC 열 등도 올바른 열 위치로 이동)
  const colKeys = ["bl", "pal", "invoice", "eta", "inDate", "fwd", "sType"];
  const globalCx = {};
  colKeys.forEach((c) => {
    const xs = rows
      .map((r) => r.cx && r.cx[c])
      .filter((x) => typeof x === "number")
      .sort((a, b) => a - b);
    if (xs.length) globalCx[c] = xs[Math.floor(xs.length / 2)]; // 중앙값
  });
  const etcHdr = words.find((w) => w.t === "ETC"); // ETC 헤더 X
  if (etcHdr) globalCx.etc = etcHdr.cx;
  rows.forEach((r) => {
    if (!r.cx) r.cx = {};
    Object.keys(globalCx).forEach((c) => {
      if (typeof r.cx[c] !== "number") r.cx[c] = globalCx[c];
    });
  });
}

// =================================================================
// 🧷 좌표 기반 인보이스/비고 재배정
//    Vision 은 표를 읽을 때 열 순서가 뒤섞여, 마지막 몇 행의 인보이스·비고가 엉뚱한 행에 붙는 경우가 있음.
//    (텍스트 순서는 틀려도 단어 박스의 Y좌표는 정확하므로, 같은 높이의 행에 다시 붙인다)
//    안전장치: 앵커 행 부족·단어 대부분이 행에 안 붙음·열 위치 불명 → 아무것도 바꾸지 않음
// =================================================================
// 비고 단어들을 읽는 순서대로 이어 붙임.
//  - Vision 은 "11월" 을 "11" + "월" 두 단어로 쪼개는데, 숫자·한글은 박스 높이/중심Y가 달라
//    Y만으로 정렬하면 "11" 이 맨 끝이나 맨 앞으로 튀어 "월 지연 가능성 높음 11" 처럼 됨 →
//    ① 비슷한 높이끼리 같은 줄로 묶고 ② 줄 안에서는 X(왼→오) 순으로 정렬,
//    ③ 글자 사이 틈이 거의 없으면(같은 단어를 쪼갠 것) 공백 없이 붙임.
function joinEtcWords(ws) {
  if (!ws || ws.length === 0) return "";
  const hs = ws.map((w) => w.h).filter((v) => v > 0).sort((a, b) => a - b);
  const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;
  const lineTol = Math.max(4, medH * 0.75); // 같은 줄 판정 폭 (줄바꿈된 비고의 다음 줄은 보통 글자높이 이상 떨어져 있음)
  const lines = [];
  ws.slice().sort((a, b) => a.cy - b.cy).forEach((w) => {
    const ln = lines.find((l) => Math.abs(l.cy - w.cy) <= lineTol);
    if (ln) { ln.w.push(w); ln.cy = ln.w.reduce((s, x) => s + x.cy, 0) / ln.w.length; }
    else lines.push({ cy: w.cy, w: [w] });
  });
  lines.sort((a, b) => a.cy - b.cy);
  // 글자 종류: 숫자 / 영문 / 한글 / 그 외(기호·한자 등). 종류가 바뀌는 지점에서 Vision 이 단어를 쪼개므로 틈이 아주 작으면 같은 단어로 본다.
  const cls = (ch) => (/\d/.test(ch) ? "d" : /[A-Za-z]/.test(ch) ? "a" : /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch) ? "k" : "o");
  return lines
    .map((ln) => {
      const a = ln.w.slice().sort((x, y) => x.lft - y.lft);
      let out = a[0].t;
      for (let k = 1; k < a.length; k++) {
        const gap = a[k].lft - a[k - 1].rgt;
        const prevCh = a[k - 1].t.slice(-1);
        const curCh = a[k].t.slice(0, 1);
        const sameWordGap = gap <= Math.max(1, medH * 0.12);                       // 글자가 거의 붙어 있음
        const splitAtScript = gap <= medH * 0.2 && cls(prevCh) !== cls(curCh);    // 숫자|한글, 영문|한글, 기호 경계에서 쪼개진 경우
        out += (sameWordGap || splitAtScript ? "" : " ") + a[k].t;
      }
      return out;
    })
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function realignInvoiceEtcByPosition(rows, visionData) {
  const cleanup = () => rows.forEach((r) => { if (r) delete r._anc; });
  try {
    if (!Array.isArray(rows) || rows.length < 2 || !visionData) return;
    const anns = visionData.responses && visionData.responses[0] && visionData.responses[0].textAnnotations;
    if (!Array.isArray(anns) || anns.length < 2) return;
    const median = (arr) => {
      const a = arr.filter((v) => typeof v === "number").sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    };
    // 1) 행 높이: 실제 단어로 앵커된 행이 80% 이상일 때만 신뢰
    const ancCnt = rows.filter((r) => r._anc && typeof r.iy === "number").length;
    if (ancCnt < Math.max(2, Math.ceil(rows.length * 0.8))) return;
    const iys = rows.map((r) => r.iy).filter((v) => typeof v === "number").sort((a, b) => a - b);
    const diffs = [];
    for (let i = 1; i < iys.length; i++) if (iys[i] - iys[i - 1] > 4) diffs.push(iys[i] - iys[i - 1]);
    const pitch = median(diffs);
    if (!pitch || pitch < 8 || pitch > 200) return;
    const tol = pitch * 0.6;
    // 2) 열 위치(X): 인보이스·S.Type 열은 attachRowYCoords 가 구해 둔 값, ETC 는 헤더 단어
    const invX = median(rows.map((r) => r.cx && r.cx.invoice));
    const typeX = median(rows.map((r) => r.cx && r.cx.sType));
    if (invX == null) return;
    const words = anns.slice(1).map((a) => {
      const vs = (a.boundingPoly && a.boundingPoly.vertices) || [];
      const ys = vs.map((v) => v.y || 0);
      const xs = vs.map((v) => v.x || 0);
      return {
        t: String(a.description || "").trim(),
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        lft: Math.min(...xs),
        rgt: Math.max(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    });
    const etcHdr = words.find((w) => w.t.toUpperCase() === "ETC");
    const etcX = etcHdr ? etcHdr.cx : null;
    const invLeft = typeX != null ? (typeX + invX) / 2 : invX - (etcX != null ? (etcX - invX) : 60);
    const invSym = invX + (invX - invLeft); // 인보이스 열 오른쪽 한계(왼쪽과 대칭으로 추정)
    const invRight = etcX != null ? Math.min((invX + etcX) / 2, invSym) : invSym;
    // 3) 단어 → 가장 가까운 행 (허용 범위 밖이면 표 밖 글자라 무시)
    const rowOf = (w) => {
      let best = -1;
      let bd = Infinity;
      rows.forEach((r, i) => {
        if (typeof r.iy !== "number") return;
        const d = Math.abs(w.cy - r.iy);
        if (d < bd) { bd = d; best = i; }
      });
      return bd <= tol ? best : -1;
    };
    // 3-1) 인보이스(7~8자리 숫자) — 인보이스 열 영역
    const invWords = words.filter((w) => /^\d{7,8}$/.test(w.t) && w.cx >= invLeft && w.cx <= invRight);
    const posInv = rows.map(() => []);
    let assignedInv = 0;
    invWords
      .slice()
      .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
      .forEach((w) => {
        const i = rowOf(w);
        if (i >= 0) { posInv[i].push(w.t); assignedInv++; }
      });
    if (invWords.length === 0 || assignedInv < invWords.length * 0.7) return; // 위치가 어긋난 이미지 → 건드리지 않음
    const invEdge = Math.max(...invWords.map((w) => w.rgt)); // 인보이스 숫자의 오른쪽 끝 — 이보다 오른쪽 글자만 비고
    // 3-2) 비고 — ETC 헤더가 있을 때만(열 경계를 알 수 있을 때). 비고는 왼쪽 정렬이라 중심이 아니라 왼쪽 끝으로 판정
    let posEtc = null;
    if (etcX != null) {
      posEtc = rows.map(() => []);
      words
        .filter((w) => w.lft > invEdge + 2 && w !== etcHdr) // 헤더 단어 자체만 제외 (비고 내용에 "etc" 가 있어도 보존)
        .sort((a, b) => a.cy - b.cy || a.cx - b.cx)
        .forEach((w) => {
          const i = rowOf(w);
          if (i >= 0) posEtc[i].push(w);
        });
    }
    // 4) 반영
    rows.forEach((r, i) => {
      if (typeof r.iy !== "number") return;
      const exist = String(r.invoice || "").split(/[,\s]+/).filter(Boolean);
      const keep = exist.filter((v) => !/^\d{7,8}$/.test(v)); // PI-형식 등 숫자 아닌 인보이스는 유지
      r.invoice = [...keep, ...posInv[i]].join(", ");
      if (posEtc && posEtc.some((a) => a.length > 0)) { // 위치로 읽은 비고가 전혀 없으면(좌표 이상) 기존 값 유지
        // 같은 줄(Y 차이 작음)끼리 이어 붙이고 줄 사이는 공백
        r.etc = joinEtcWords(posEtc[i]);
      }
    });
  } finally {
    cleanup();
  }
}

// =================================================================
// 🧭 좌표 기반 독립 판독 (검증용) — 파싱 결과와는 무관하게, 단어 좌표만으로 표를 다시 읽는다.
//    ① 헤더(PAL·ETA·Invoice# 등)의 X 위치로 열을 나누고 ② PAL·B/L 단어의 Y 위치로 행을 나눈 뒤
//    ③ 단어를 (행, 열) 칸에 넣어 읽는다. 웹 '검증'이 파싱된 표와 칸별로 대조해 어긋난 칸만 표시한다.
//    저장 값/확정 로직에는 쓰이지 않으며, 헤더를 못 찾는 등 불확실하면 null(= 기존 검증만 사용).
// =================================================================
function readTableByGeometry(visionData) {
  const anns = visionData && visionData.responses && visionData.responses[0] && visionData.responses[0].textAnnotations;
  if (!Array.isArray(anns) || anns.length < 20) return null;
  let imgW = 0;
  let imgH = 0;
  const words = [];
  anns.slice(1).forEach((a) => {
    const vs = (a.boundingPoly && a.boundingPoly.vertices) || [];
    if (!vs.length) return;
    const xs = vs.map((v) => v.x || 0);
    const ys = vs.map((v) => v.y || 0);
    const t = String(a.description || "").trim();
    if (!t) return;
    const w = {
      t,
      lft: Math.min(...xs),
      rgt: Math.max(...xs),
      top: Math.min(...ys),
      bot: Math.max(...ys),
    };
    w.cx = (w.lft + w.rgt) / 2;
    w.cy = (w.top + w.bot) / 2;
    w.h = Math.max(1, w.bot - w.top);
    imgW = Math.max(imgW, w.rgt);
    imgH = Math.max(imgH, w.bot);
    words.push(w);
  });
  if (words.length < 20) return null;
  const U = (w) => w.t.toUpperCase();
  const median = (arr) => {
    const a = arr.filter((v) => typeof v === "number").sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };
  // 1) 헤더: PAL 단어와 같은 높이의 단어들에서 열 기준 X 를 잡는다
  const palH = words.find((w) => U(w) === "PAL");
  if (!palH) return null;
  const band = words.filter((w) => Math.abs(w.cy - palH.cy) <= Math.max(6, palH.h * 0.8));
  const findH = (re) => band.find((w) => re.test(U(w)));
  const anc = {};
  const set = (k, w) => { if (w) anc[k] = w.cx; };
  set("bl", findH(/^B\/?L#?$/));
  set("pal", palH);
  set("eta", findH(/^ETA$/));
  set("inDate", findH(/^3PL$/));
  set("fwd", findH(/^FWD$/));
  set("sType", findH(/^(S\.?TYPE|TYPE)$/));
  set("invoice", findH(/^INVOICE#?$/));
  const etcH = findH(/^ETC$/);
  if (etcH) anc.etc = etcH.cx;
  const keys = Object.keys(anc);
  if (keys.length < 6 || anc.pal == null || anc.invoice == null) return null;
  const sorted = keys.map((k) => ({ k, x: anc[k] })).sort((a, b) => a.x - b.x);
  const colOf = (cx) => {
    let best = sorted[0];
    sorted.forEach((c) => { if (Math.abs(c.x - cx) < Math.abs(best.x - cx)) best = c; });
    return best.k;
  };
  // 2) 본문 단어(헤더·인사말 제외)
  const hdrLike = /^(입고|3PL|TYPE|S\.?TYPE|INVOICE#?|B\/?L#?|FWD|ETA|PAL|ETC)$/i;
  let body = words.filter((w) => w.cy > palH.cy + palH.h * 0.9);
  if (body.length < 6) return null;
  const medH = median(body.map((w) => w.h)) || 12;
  // 3) 행 앵커: PAL 열의 1~3자리 숫자 + B/L 열의 B/L 모양 단어("발행" 포함)
  const seeds = body.filter((w) => {
    const c = colOf(w.cx);
    if (c === "pal") return /^\d{1,3}$/.test(w.t);
    if (c === "bl") return /^[A-Za-z]{1,8}\d{5,12}$/.test(w.t) || /^발행/.test(w.t);
    return false;
  });
  if (seeds.length < 2) return null;
  const rows = [];
  seeds.slice().sort((a, b) => a.cy - b.cy).forEach((w) => {
    const r = rows.find((q) => Math.abs(q.cy - w.cy) <= Math.max(4, medH * 0.6));
    if (r) { r.seeds.push(w); r.cy = median(r.seeds.map((x) => x.cy)); }
    else rows.push({ cy: w.cy, seeds: [w], words: [] });
  });
  rows.sort((a, b) => a.cy - b.cy);
  if (rows.length < 2) return null;
  const diffs = [];
  for (let i = 1; i < rows.length; i++) diffs.push(rows[i].cy - rows[i - 1].cy);
  const pitch = median(diffs) || medH * 1.6;
  if (pitch < 6 || pitch > 300) return null;
  const tol = pitch * 0.6;
  // 헤더가 두 줄로 줄바꿈된 경우("3PL" / "입고")의 둘째 줄 단어는 첫 행보다 위에 있으므로 제외 (첫 행 안의 같은 단어는 보존)
  body = body.filter((w) => !(hdrLike.test(w.t) && w.cy < rows[0].cy - tol));
  // 4) 단어 → 가장 가까운 행
  body.forEach((w) => {
    let best = null;
    let bd = Infinity;
    rows.forEach((r) => {
      const d = Math.abs(w.cy - r.cy);
      if (d < bd) { bd = d; best = r; }
    });
    if (best && bd <= tol) best.words.push(w);
  });
  // 5) 비고 영역 경계: 인보이스 숫자(7~8자리)의 오른쪽 끝보다 오른쪽이면 비고
  const invWords = body.filter((w) => colOf(w.cx) === "invoice" && /^\d{7,8}$/.test(w.t));
  const invEdge = invWords.length ? Math.max(...invWords.map((w) => w.rgt)) : null;
  const etcLeft = invEdge != null ? invEdge + 2 : anc.etc != null ? (anc.invoice + anc.etc) / 2 : null;
  const hasEtcCol = etcLeft != null;
  const DATE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;
  const out = rows.map((r) => {
    const cells = { bl: [], pal: [], eta: [], inDate: [], fwd: [], sType: [], invoice: [], etc: [] };
    r.words.forEach((w) => {
      if (hasEtcCol && w.lft > etcLeft) { cells.etc.push(w); return; }
      const c = colOf(w.cx);
      if (c === "etc") { cells.etc.push(w); return; }
      if (cells[c]) cells[c].push(w);
    });
    const byX = (a) => a.slice().sort((x, y) => x.lft - y.lft);
    const bl = byX(cells.bl).map((w) => w.t).join("").replace(/[^A-Za-z0-9가-힣]/g, "");
    const palW = cells.pal.find((w) => /^\d{1,3}$/.test(w.t));
    const dates = (a) => byX(a).filter((w) => DATE.test(w.t)).map((w) => w.t.replace(/[/.]/g, "-"));
    const inv = byX(cells.invoice).map((w) => w.t).filter((t) => /^\d{7,8}$/.test(t) || /^PI-?\d{4}-?\d{3,4}$/i.test(t));
    const st = cells.sType.map((w) => w.t.toUpperCase()).find((t) => t === "AIR" || t === "SEA") || "";
    return {
      y: Math.round(r.cy),
      bl,
      pal: palW ? palW.t : "",
      eta: dates(cells.eta)[0] || "",
      inDate: dates(cells.inDate)[0] || "",
      fwd: joinEtcWords(cells.fwd),
      sType: st,
      invoice: inv.join(", "),
      etc: hasEtcCol ? joinEtcWords(cells.etc) : "",
    };
  });
  return { rows: out, pitch: Math.round(pitch), w: Math.round(imgW), h: Math.round(imgH), cols: keys, hasEtc: hasEtcCol };
}

// =================================================================
// 🧠 로컬 정규식 파싱 엔진
// =================================================================
function parseOcrLinesLocal(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cleanBL = (v) => String(v).replace(/[\s•·\-\*]/g, "");
  // 프리픽스 하드코딩 제거 — SCAC 코드(2~5알파벳) + 일련번호(5~9숫자) 구조면 BL로 인식
  // 대시는 제거하지 않음: 실제 BL에는 대시 없고, PI-2026-0312 같은 인보이스는 대시가 구분자 → 자동 제외
  const isBL = (v) => {
    const cleaned = String(v).trim().replace(/[\s•·*]/g, "");
    if (cleaned === "발행전") return true;
    //return /^[A-Za-z]{2,5}\d{5,9}$/.test(cleaned);
    //2026-09-18: SCAC 1글자도 허용 (예: D12345678) → {1,5}로 변경
    //2026-10-20: 다른 선사 B/L 형식도 인식 (MAEU123456789, COSU6123456789, EGLV142500012345, HDMUBUSA12345678, ONEYTYOG12345600 등)
    //            → 영문 4~8자 + 숫자 6~12자. in.js 의 isBLok / rawRowCount 와 동일 규칙 유지할 것
    return /^[A-Za-z]{1,5}\d{5,9}$/.test(cleaned) || /^[A-Za-z]{4,8}\d{6,12}$/.test(cleaned);
  };
  const isPal = (v) => /^\d{1,3}$/.test(v);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isSType = (v) => /^(AIR|SEA)$/i.test(v);
  const isFwd = (v) => /^[A-Za-z]+$/.test(v) && !isSType(v);
  const isInvoice = (v) => /^\d{7,8}$/.test(v);
  // PI-2026-0312 같은 특수 인보이스 형식(드물게 등장) — 비고로 새지 않도록 인보이스로 인식
  const isPiInvoice = (v) => /^PI-?\d{4}-?\d{3,4}$/i.test(String(v).trim());

  const rows = [];
  let orphanInvoices = [];
  let orphanEtc = [];
  let activeRowIndex = 0;
  const tokens = [];
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    if (/^(안녕하세요|B\/?L|PAL|ETA|3PL\s*입고|Fwd|S\.?Type|Invoice|ETC|Free time)/i.test(raw)) continue;
    if (!isBL(raw) && raw.includes(" ")) {
      const parts = raw.split(/\s+/);
      const strongTokens = parts.filter((p) => isDate(p) || isSType(p) || isInvoice(p) || isBL(p));
      if (strongTokens.length > 0 && parts.length <= 5) {
        tokens.push(...parts);
        continue;
      }
    }
    tokens.push(raw);
  }
  for (let raw of tokens) {
    if (isBL(raw)) {
      if (rows.length > 0) {
        let lastRow = rows[rows.length - 1];
        let hasData =
          lastRow.pal || lastRow.eta || lastRow.inDate || lastRow.sType || lastRow.fwd || lastRow.invoices.length > 0;
        if (hasData) {
          rows.push({
            bl: cleanBL(raw),
            pal: "",
            eta: "",
            inDate: "",
            fwd: "",
            sType: "",
            invoices: [...orphanInvoices],
            etc: [...orphanEtc],
          });
          activeRowIndex = rows.length - 1;
          orphanInvoices = [];
          orphanEtc = [];
          continue;
        }
      }
      rows.push({
        bl: cleanBL(raw),
        pal: "",
        eta: "",
        inDate: "",
        fwd: "",
        sType: "",
        invoices: [...orphanInvoices],
        etc: [...orphanEtc],
      });
      orphanInvoices = [];
      orphanEtc = [];
      continue;
    }
    if (rows.length === 0) {
      let invMatch = raw.match(/\b\d{7,8}\b/g);
      if (invMatch && !isDate(raw)) {
        invMatch.forEach((inv) => orphanInvoices.push(inv));
        let cleanEtc = raw
          .replace(/\b\d{7,8}\b/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        if (cleanEtc) orphanEtc.push(cleanEtc);
      } else if (isInvoice(raw)) {
        orphanInvoices.push(raw);
      } else {
        orphanEtc.push(raw);
      }
      continue;
    }
    let assigned = false;
    let curr = activeRowIndex;
    while (curr < rows.length) {
      if (isPal(raw)) {
        if (!rows[curr].pal) {
          rows[curr].pal = raw;
          activeRowIndex = curr;
          assigned = true;
          break;
        }
      } else if (isDate(raw)) {
        if (!rows[curr].eta) {
          rows[curr].eta = raw;
          activeRowIndex = curr;
          assigned = true;
          break;
        } else if (!rows[curr].inDate) {
          rows[curr].inDate = raw;
          activeRowIndex = curr;
          assigned = true;
          break;
        }
      } else if (isSType(raw)) {
        if (!rows[curr].sType) {
          rows[curr].sType = raw.toUpperCase();
          activeRowIndex = curr;
          assigned = true;
          break;
        }
      } else if (isFwd(raw)) {
        if (!rows[curr].fwd) {
          rows[curr].fwd = raw;
          activeRowIndex = curr;
          assigned = true;
          break;
        }
      } else {
        break;
      }
      curr++;
    }
    if (!assigned) {
      if (isInvoice(raw)) {
        rows[activeRowIndex].invoices.push(raw);
      } else if (isPiInvoice(raw)) {
        rows[activeRowIndex].invoices.push(raw.trim()); // PI-형식 인보이스
      } else if (!isPal(raw) && !isDate(raw) && !isSType(raw) && !isFwd(raw)) {
        let invMatch = raw.match(/\b\d{7,8}\b/g);
        if (invMatch) {
          invMatch.forEach((inv) => rows[activeRowIndex].invoices.push(inv));
          let cleanEtc = raw
            .replace(/\b\d{7,8}\b/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
          if (cleanEtc) rows[activeRowIndex].etc.push(cleanEtc);
        } else {
          rows[activeRowIndex].etc.push(raw);
        }
      } else {
        rows[activeRowIndex].etc.push(raw);
      }
    }
  }
  return rows.map((r) => ({
    bl: r.bl,
    pal: Number(r.pal) || 0,
    eta: r.eta || "",
    inDate: r.inDate || "",
    fwd: r.fwd || "",
    sType: r.sType || "",
    invoice: r.invoices.join(", "),
    etc: r.etc.join(" "),
  }));
}

module.exports = { runOcrPipeline, cleanEtcText, attachRowYCoords, joinEtcWords, realignInvoiceEtcByPosition, readTableByGeometry, parseOcrLinesLocal };
