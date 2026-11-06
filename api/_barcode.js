// _barcode.js — 피킹지 사진 속 인쇄된 Code128 바코드(= 출고지시번호)를 직접 읽는다.
//  · 글자(문자인식·AI)와 달리 바코드는 체크 규칙이 있어 '틀리게 읽힌 그럴듯한 번호'가 나올 가능성이 매우 낮다 → 출고지시번호의 기준값으로 쓴다.
//  · 선택 의존성: zxing-wasm, jpeg-js. 설치돼 있지 않거나 읽지 못하면 조용히 건너뛴다(결과에 이유만 남김) → 기존 흐름은 그대로.
//  · 사진 위쪽 띠(없으면 아래쪽 띠)를 2·4·3·1.5배로 키워 순서대로 시도한다(바코드 막대가 가늘어 원본 크기에서는 안 읽히는 경우가 많음).
//  · 반환: { ok, text, why, ms, scale, band }  — text 는 읽은 바코드 글자(예 SH2611050372), ok=false 면 why 에 이유
"use strict";
const path = require("path");
const fs = require("fs");

let _mods = null;
let _modErr = null;
function load() {
  if (_mods || _modErr) return _mods;
  try {
    const jpeg = require("jpeg-js");
    const zx = require("zxing-wasm/reader");
    // 서버(Node)에서는 wasm 을 주소로 못 불러오므로 파일을 직접 읽어 넘긴다
    const entry = require.resolve("zxing-wasm/reader"); // …/dist/cjs/reader/index.js  → wasm 은 …/dist/reader/zxing_reader.wasm
    const wasmBinary = fs.readFileSync(path.join(path.dirname(entry), "..", "..", "reader", "zxing_reader.wasm"));
    zx.setZXingModuleOverrides({ wasmBinary });
    _mods = { jpeg, zx };
  } catch (e) {
    _modErr = String((e && e.message) || e).slice(0, 80);
  }
  return _mods;
}

// 밝기(회색) 이중선형 확대로 가로세로 s 배 키운 조각을 만든다
function cropScale(im, x0, y0, x1, y1, s) {
  const w = x1 - x0, h = y1 - y0, W = Math.round(w * s), H = Math.round(h * s);
  const d = new Uint8ClampedArray(W * H * 4);
  const g = (x, y) => {
    x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
    const a = ((y + y0) * im.width + (x + x0)) * 4;
    return (im.data[a] * 299 + im.data[a + 1] * 587 + im.data[a + 2] * 114) / 1000;
  };
  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / s - 0.5, yi = Math.floor(fy), ty = fy - yi;
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / s - 0.5, xi = Math.floor(fx), tx = fx - xi;
      const v = (g(xi, yi) * (1 - tx) + g(xi + 1, yi) * tx) * (1 - ty) + (g(xi, yi + 1) * (1 - tx) + g(xi + 1, yi + 1) * tx) * ty;
      const b = (y * W + x) * 4;
      d[b] = d[b + 1] = d[b + 2] = v; d[b + 3] = 255;
    }
  }
  return { data: d, width: W, height: H, colorSpace: "srgb" };
}

// 출고지시번호 모양(영문 2~3자 + 숫자 9~12자)인 것만 받는다
const ORDER_RE = /^[A-Z]{2,3}\d{9,12}$/;

async function readOrderBarcode(b64, mime, opts) {
  const t0 = Date.now();
  const o = opts || {};
  const done = (r) => Object.assign({ ok: false, text: null, why: "", ms: Date.now() - t0, scale: null, band: null }, r);
  try {
    if (o.disabled) return done({ why: "꺼짐" });
    const m = load();
    if (!m) return done({ why: "바코드 모듈 없음(" + _modErr + ")" });
    if (mime && !/jpe?g/i.test(mime)) return done({ why: "JPEG 아님" });
    const buf = Buffer.from(String(b64 || ""), "base64");
    if (!buf.length) return done({ why: "사진 없음" });
    if (buf.length > 6 * 1024 * 1024) return done({ why: "사진이 너무 큼" });
    const im = m.jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    if (!im || !im.width || !im.height) return done({ why: "사진 해석 실패" });
    const maxMs = o.maxMs || 2500;
    const bands = [["top", 0, 0.25], ["bottom", 0.75, 1]];
    const scales = [2, 4, 3, 1.5];
    for (const [name, a, b] of bands) {
      const y0 = Math.floor(im.height * a), y1 = Math.floor(im.height * b);
      for (const s of scales) {
        if (Date.now() - t0 > maxMs) return done({ why: "시간 초과" });
        const c = cropScale(im, 0, y0, im.width, y1, s);
        const rs = await m.zx.readBarcodes(c, { formats: ["Code128"], tryHarder: true, maxNumberOfSymbols: 3 });
        const hit = (rs || []).map((r) => String(r.text || "").trim().toUpperCase()).find((t) => ORDER_RE.test(t));
        if (hit) return done({ ok: true, text: hit, scale: s, band: name });
      }
    }
    return done({ why: "바코드를 못 찾음" });
  } catch (e) {
    return done({ why: "오류: " + String((e && e.message) || e).slice(0, 60) });
  }
}

module.exports = { readOrderBarcode, ORDER_RE };
