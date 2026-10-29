// ============================================================
// api/calendar.js — Vercel 서버리스 API
//
// GET  actions: (query param) yearlyStats | 월간 달력 데이터
// POST actions:
//   인증:     LOGIN | PING
//   접속로그:  LOG_SITE_ACCESS | LOG_LOGOUT
//   관리자:   CREATE_ADMIN | DELETE_ADMIN | REACTIVATE_ADMIN | HARD_DELETE_ADMIN
//             RESET_ADMIN_PW | CHANGE_MY_PASSWORD
//             GET_ADMIN_LIST | GET_ADMIN_CONN_LOGS | GET_ALL_CONN_LOGS
//   감사로그:  GET_AUDIT_LOGS
//   DB직접:   GET_RAW_DB_ROWS | ADD_RAW_ROW_DIRECT | UPDATE_RAW_ROW_FULL
//             UPDATE_RAW_ROW_DIRECT | DELETE_RAW_ROW_DIRECT
//   출고:     manageWebOutboundData → ADD | EDIT | DELETE | DONE | UNDO_DONE
//             ADD_QTY | UPDATE_ORDER | MULTI_DELETE | MULTI_DONE | MULTI_UNDO_DONE
//   입고:     manageWebInboundData  → ADD | EDIT | DELETE | DONE | UNDO_DONE
//             UPDATE_ORDER | MULTI_DELETE | MULTI_DONE | MULTI_UNDO_DONE
//   설정:     GET_COMP_INFO_DB | SAVE_COMP_INFO_DB
//             GET_GLOBAL_COLORS | SAVE_GLOBAL_COLOR
//             GET_YEARLY_HOLIDAYS
//   OCR:      GET_LAST_OCR_IMAGE | GET_LAST_OCR_DATA | GET_OCR_LAST_TIME
//             SAVE_OCR_INFO | GET_OCR_FILTERS | SAVE_OCR_FILTERS
//   AI:       AI_QUERY
// ============================================================
require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pickLib = require("./_pick.js"); // 출고 피킹지 사진 판독 (api/_pick.js)
const ocrLib = require("./_ocr.js"); // 입고 OCR 읽기 엔진 — 앱에서 사진 업로드용 (api/_ocr.js)

// 🔁 입고 OCR 대조용: 값 비교 도우미 — 날짜는 YYYY-MM-DD 로 맞추고 미정/빈값/비정상은 ""
const _ocrNd = (v) => {
  const m = String(v == null ? "" : v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return "";
  const y = +m[1];
  if (y < 2000 || y > 2100) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};
const _ocrCmpField = {
  eta: _ocrNd,
  inDate: _ocrNd,
  pal: (v) => { const n = parseInt(String(v == null ? "" : v).replace(/\D/g, ""), 10); return n > 0 ? String(n) : ""; },
  fwd: (v) => String(v == null ? "" : v).replace(/\s+/g, "").toUpperCase(),
  sType: (v) => String(v == null ? "" : v).replace(/\s+/g, "").toUpperCase(),
};
const _OCR_PEND_FIELDS = ["pal", "eta", "inDate", "fwd", "sType"]; // 새 OCR 값을 '반영 제안'으로 보여 줄 칸 (B/L·인보이스·비고는 제외)
const _ocrDbVal = (d, f) => (f === "pal" ? d.pallets : f === "inDate" ? d.receive_date : f === "eta" ? d.eta : f === "sType" ? d.s_type : d[f]);

// 📲 달력 변경 텔레그램 알림
// 1:1 DM 전송: ADMIN_TELEGRAM_USER_ID = 봇과 1:1 대화 chat_id (사용자 개인 ID)
// 본인이 직접 한 변경은 알림 제외: TELEGRAM_OWNER_ID 환경변수에 본인 admin_id 설정
//
// ⚠️ Vercel 서버리스는 응답(res.end)이 나가는 순간 함수가 동결/종료될 수 있어서,
//    예전처럼 fetch를 기다리지 않고 버리면 "어쩔땐 오고 어쩔땐 안 오는" 현상이 생김.
//    → 알림 Promise를 _notifyPending에 모아두고, 핸들러가 응답을 끝내기 직전(res.end 훅)에
//      최대 NOTIFY_WAIT_MS 동안 전송 완료를 기다린다. (알림 실패가 요청 자체를 깨지는 않음)
const NOTIFY_WAIT_MS = 4500;      // 응답 전 알림 전송 최대 대기
const TG_TIMEOUT_MS  = 3500;      // 텔레그램 1회 호출 타임아웃
const _notifyPending = new Set();
let _notifyWarned = false;

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _tgSend(botToken, chatId, text) {
  // 최대 2회 시도: 네트워크 오류/5xx/429(retry_after) 시 1회 재시도
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TG_TIMEOUT_MS);
    try {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (r.ok) return true;
      let j = null;
      try { j = await r.json(); } catch (_) {}
      console.error(`[calendar-notify] Telegram ${r.status}:`, j && j.description);
      if (r.status === 429 && attempt === 1) {
        const wait = Math.min(((j && j.parameters && j.parameters.retry_after) || 1) * 1000, 2000);
        await _sleep(wait);
        continue;
      }
      if (r.status >= 500 && attempt === 1) { await _sleep(400); continue; }
      return false; // 400/401/403 등은 재시도 무의미 (토큰·chat_id 문제)
    } catch (e) {
      clearTimeout(timer);
      console.error("[calendar-notify] 전송 실패:", e && e.message);
      if (attempt === 1) { await _sleep(400); continue; }
      return false;
    }
  }
  return false;
}

async function _notifyCore(description, byAdmin) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  // 1:1 DM: ADMIN_TELEGRAM_USER_ID (그룹챗인 TELEGRAM_CHAT_ID 사용 안 함)
  const chatId   = process.env.ADMIN_TELEGRAM_USER_ID;
  if (!botToken || !chatId) {
    if (!_notifyWarned) {
      _notifyWarned = true;
      console.error("[calendar-notify] TELEGRAM_BOT_TOKEN 또는 ADMIN_TELEGRAM_USER_ID 환경변수 없음 → 알림 비활성");
    }
    return;
  }
  // 본인 변경 제외 (TELEGRAM_OWNER_ID 미설정 시 전체 알림)
  const ownerId = (process.env.TELEGRAM_OWNER_ID || "").trim();
  if (ownerId && String(byAdmin || "").trim().toLowerCase() === ownerId.toLowerCase()) return;
  // CALENDAR_NOTIFY 설정 확인 (OFF면 알림 차단)
  try {
    const [nRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'CALENDAR_NOTIFY'`);
    if (nRows.length > 0 && nRows[0].setting_value === "OFF") return;
  } catch (_) {}
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const ts = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  let text = `📅 [달력 변경] ${ts}\n👤 ${byAdmin || "알수없음"}\n${description}`;
  // 텔레그램 한 메시지 최대 4096자 — 초과 시 400 에러로 통째로 누락되던 문제 방지
  if (text.length > 4000) text = text.slice(0, 3980) + "\n…(이하 생략)";
  await _tgSend(botToken, chatId, text);
}

// 호출부는 기존과 동일하게 notifyCalendarChange(desc, admin) 만 부르면 됨 (await 불필요)
const _notifyRecent = new Map(); // 같은 사람·같은 내용 알림 10초 내 중복 차단
function notifyCalendarChange(description, byAdmin) {
  const _k = `${String(byAdmin || "").toLowerCase()}|${description}`;
  const _nowMs = Date.now();
  if (_notifyRecent.size > 200) for (const [k, t] of _notifyRecent) if (_nowMs - t > 10000) _notifyRecent.delete(k);
  if (_nowMs - (_notifyRecent.get(_k) || 0) < 10000) return Promise.resolve();
  _notifyRecent.set(_k, _nowMs);
  const p = _notifyCore(description, byAdmin)
    .catch((e) => console.error("[calendar-notify] 오류:", e && e.message))
    .finally(() => _notifyPending.delete(p));
  _notifyPending.add(p);
  return p;
}

// 응답을 끝내기 직전, 진행 중인 알림 전송이 있으면 완료(또는 타임아웃)까지 기다린다
function _hookResEndForNotify(res) {
  const origEnd = res.end.bind(res);
  res.end = function (...args) {
    if (_notifyPending.size === 0) return origEnd(...args);
    Promise.race([Promise.allSettled([..._notifyPending]), _sleep(NOTIFY_WAIT_MS)])
      .then(() => origEnd(...args), () => origEnd(...args));
    return res;
  };
}

// 같은 날·같은 업체 기존 일정에 수량을 '더하기' ([+수량추가] 와 같은 이력 문구). 한 번의 UPDATE 라 동시에 여러 요청이 와도 합산이 사라지지 않고,
// 완료 처리된 행에는 적용되지 않는다. 반환 {ok, hist}
async function appendQtyAtomic(id, company, pal, box, extraEtc) {
  const _now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const hist = `[${_now.getMonth() + 1}/${_now.getDate()} ${pal ? pal + "P" : ""}${pal && box ? " " : ""}${box ? box + "B" : ""} 추가]`;
  const add = extraEtc ? hist + " " + String(extraEtc).trim() : hist;
  const [upr] = await pool.query(
    `UPDATE outbound SET pal = CAST(COALESCE(NULLIF(pal,''),'0') AS SIGNED) + ?, box = CAST(COALESCE(NULLIF(box,''),'0') AS SIGNED) + ?, etc = CASE WHEN etc IS NULL OR TRIM(etc) = '' THEN ? ELSE CONCAT(TRIM(etc), ' ', ?) END WHERE id = ? AND TRIM(company) = ? AND (isDone = 0 OR isDone IS NULL)`,
    [pal, box, add, add, id, company],
  );
  return { ok: !!(upr && upr.affectedRows), hist };
}

// 업체명이 조금 달라도(㈜ 유무·공백·약어) 같은 업체로 볼지 — 피킹지에서 '기존 일정'을 찾을 때 사용. 층(2층/3층)처럼 구분 글자는 유지됨
// ── Gemini 키 막힘 상태를 서버 인스턴스끼리 공유(DB). 한도로 막힌 키·모델과 풀리는 시각만 저장하고 키 자체는 저장하지 않는다 ──
const pickGeminiKeys = () => [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean);
let _gkLoadedAt = 0, _gkJson = "";
async function geminiStateLoad(force) {
  if (!force && Date.now() - _gkLoadedAt < 5000) return;
  _gkLoadedAt = Date.now();
  try {
    const [r] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GEMINI_KEY_STATE'`);
    if (r.length) {
      const v = typeof r[0].setting_value === "object" ? r[0].setting_value : JSON.parse(r[0].setting_value);
      pickLib.importKeyState(v);
      _gkJson = JSON.stringify(v);
    }
  } catch (_) {}
}
async function geminiStateSave() {
  try {
    const cur = JSON.stringify(pickLib.exportKeyState());
    if (cur === _gkJson) return;
    _gkJson = cur;
    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('GEMINI_KEY_STATE', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, [cur]);
  } catch (_) {}
}
// 모든 AI 키가 한도로 막히면 관리자 텔레그램으로 알림 — 30분에 한 번만(DB 로 서버 인스턴스끼리 공유, 인스턴스 안에서는 10분에 한 번)
let _gkAlertMem = 0;
async function geminiAlertAllBlocked(retryAt) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.ADMIN_TELEGRAM_USER_ID;
    if (!botToken || !chatId) return;
    const nowT = Date.now();
    if (nowT - _gkAlertMem < 10 * 60 * 1000) return;
    _gkAlertMem = nowT;
    await pool.query(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('GEMINI_ALERT_AT', '0')`);
    const [u] = await pool.query(`UPDATE system_settings SET setting_value = ? WHERE setting_key = 'GEMINI_ALERT_AT' AND setting_value < ?`, [String(nowT), String(nowT - 30 * 60 * 1000)]);
    if (!u || u.affectedRows !== 1) return;
    const when = retryAt ? new Date(retryAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "알 수 없음";
    await _tgSend(botToken, chatId, `⚠️ [피킹지 판독] AI 키가 모두 한도에 걸렸습니다.\n가장 빨리 풀리는 시각: ${when}\n그때까지는 문자인식 결과만 채워지고 손글씨(PLT·박스)는 직접 입력해야 합니다.\n(앱 > 📊 판독 정확도 > AI 키 상태에서 확인)`);
  } catch (_) {}
}
async function pickLoadCompDb() {
  try {
    const [cr] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`);
    if (cr.length) return typeof cr[0].setting_value === "object" ? cr[0].setting_value || {} : JSON.parse(cr[0].setting_value) || {};
  } catch (_) {}
  return {};
}
// ───────── 업체명 변경 → 일정·피킹지 연결 이전 ─────────
//  업체정보에서 이름을 바꾸면 달력 일정(outbound.company)과 피킹지 업체 연결(PICK_ALIAS)도 새 이름으로 옮긴다.
//  [TASK] 로 시작하는 작업 일정은 업체명이 아니므로 건드리지 않고, 이름이 정확히 같은 행만 옮긴다.
async function renameCompanyData(oldName, newName) {
  const [r] = await pool.query(`UPDATE outbound SET company = ? WHERE company = ? AND company NOT LIKE '[TASK]%'`, [newName, oldName]);
  const moved = r && r.affectedRows ? r.affectedRows : 0;
  let aliasMoved = 0;
  try {
    const [ar] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PICK_ALIAS'`);
    if (ar.length) {
      let am = typeof ar[0].setting_value === "object" ? ar[0].setting_value || {} : JSON.parse(ar[0].setting_value) || {};
      Object.keys(am).forEach((k) => { if (am[k] === oldName) { am[k] = newName; aliasMoved++; } });
      if (aliasMoved) { const js = JSON.stringify(am); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('PICK_ALIAS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [js, js]); }
    }
  } catch (e) { console.error("[업체명 변경] 피킹 연결 이전 실패(무시):", e.sqlMessage || e.message); }
  return { moved, aliasMoved };
}
// 일정에 남아 있는 업체명 중 업체정보(마스터)에 없는 것 — 이름만 바뀐 옛 일정 찾기용. match: 표기만 다른 같은 업체(정규화 비교)
async function listOrphanCompanies() {
  const compDb = await pickLoadCompDb();
  const names = Object.keys(compDb);
  const [rows] = await pool.query(`SELECT company, COUNT(*) AS n, DATE_FORMAT(MIN(outbound_date), '%Y-%m-%d') AS d1, DATE_FORMAT(MAX(outbound_date), '%Y-%m-%d') AS d2 FROM outbound WHERE company IS NOT NULL AND company <> '' AND company NOT LIKE '[TASK]%' GROUP BY company ORDER BY n DESC LIMIT 300`);
  const out = [];
  for (const r of rows) {
    const nm = String(r.company);
    if (compDb[nm]) continue; // 업체정보에 있는 이름(대소문자 구분)
    let match = null;
    try {
      const nn = pickLib.normName(nm);
      match = names.find((f) => pickLib.normName(f) === nn) || null;
      if (!match) {
        const c = pickLib.canonCompany(nm, compDb);
        if (c && compDb[c] && !(pickLib.shortsOf(compDb[c]).includes(nn))) match = c; // 약어로 적힌 일정은 이름 통일 대상 아님
      }
    } catch (_) {}
    out.push({ name: nm, n: Number(r.n) || 0, from: r.d1 || null, to: r.d2 || null, match });
  }
  return out;
}
// '그냥 두기'로 표시한 미등록 이름 목록(이름 배열)
async function orphanIgnoreLoad() {
  try {
    const [r] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_ORPHAN_IGNORE'`);
    if (r.length) { const v = typeof r[0].setting_value === "object" ? r[0].setting_value : JSON.parse(r[0].setting_value); if (Array.isArray(v)) return v.map(String); }
  } catch (_) {}
  return [];
}
function pickSameCompany(a, b, compDb) {
  const na = pickLib.normName(a), nb = pickLib.normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 정식명·CRM 약어(여러 개 가능)·옛 약어/옛 이름 어느 쪽으로 적혀 있어도 같은 마스터 업체로 환원해 비교
  const ca = pickLib.canonCompany(a, compDb), cb = pickLib.canonCompany(b, compDb);
  const ka = ca ? pickLib.normName(ca) : na, kb = cb ? pickLib.normName(cb) : nb;
  return ka === kb;
}
// 출고 일정 이름 비교용 — [TASK] 표시가 같은 것끼리만 같은 업체로 본다
function pickSameCompanyT(a, b, compDb) {
  const ta = /^\[TASK\]/i.test(String(a || "").trim()), tb = /^\[TASK\]/i.test(String(b || "").trim());
  if (ta !== tb) return false;
  const strip = (x) => String(x || "").replace(/\[TASK\]/gi, "").trim();
  return pickSameCompany(strip(a), strip(b), compDb);
}

// ───────── 피킹지 등록 기록 (같은 피킹지 이중 등록 방지) ─────────
//  pick_registered: 출고지시번호 → 등록된 일정(outbound_id). 그 일정이 지금도 있을 때만 '이미 등록'으로 본다.
async function pickEnsureTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS pick_registered (order_no VARCHAR(40) PRIMARY KEY, outbound_id BIGINT NOT NULL DEFAULT 0, mode VARCHAR(8), hist VARCHAR(80), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
}
// ───────── 피킹지 판독 정확도 기록 ─────────
//  pick_parse_log: 사진 판독 결과(parsed) · 2차 판독(reread) · 사람이 등록 때 최종 입력한 값(final) 을 나란히 남겨 정확도를 잰다.
//  사진은 저장하지 않는다 — 숫자·업체명·번호 같은 값만. 기록 실패는 판독·등록 자체를 막지 않는다.
let _pickLogReady = false;
async function pickLogEnsure() {
  if (_pickLogReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS pick_parse_log (id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_id VARCHAR(60), order_no VARCHAR(40), parsed TEXT, reread TEXT, final TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, registered_at TIMESTAMP NULL, KEY idx_created (created_at), KEY idx_order (order_no))`);
  _pickLogReady = true;
}
function pickParsedSnapshot(parsed, comp, extra) {
  const f = parsed.flags || {};
  const lv = (k) => (f[k] ? f[k].level : null);
  return {
    orderNo: parsed.orderNo || null, customer: parsed.customer || null, company: comp && comp.company ? comp.company : null,
    shipDate: parsed.shipDate || null, plt: parsed.plt === undefined ? null : parsed.plt, wanbox: parsed.wanbox === undefined ? null : parsed.wanbox, honjae: parsed.honjae === undefined ? null : parsed.honjae,
    addExisting: !!parsed.addExisting, mergeHint: !!parsed.mergeHint, ai: parsed.ai || null,
    flags: { plt: lv("plt"), wanbox: lv("wanbox"), honjae: lv("honjae"), customer: lv("customer"), shipDate: lv("shipDate") },
    tilt: parsed.hwRegions ? parsed.hwRegions.tilt : null, hwFound: !!parsed.hwRegions, hwAgree: parsed.hwAgree === true,
    aiRaw: parsed.aiRaw || null, shadow: parsed.shadow || null, pinned: parsed.pinned || null, // 모델별 비교용: AI 가 합치기 전에 직접 읽은 값 / lite 곁가지 결과 / 모델 지정 시험 여부
    timing: parsed.timing || null, kb: extra && extra.kb ? extra.kb : null, meta: extra && extra.meta ? extra.meta : null, // 소요시간·사진 크기(KB)·화면이 돌리거나 보정해 다시 보냈는지
  };
}
async function pickLogInsert(adminId, snap) {
  try {
    await pickLogEnsure();
    const [r] = await pool.query(`INSERT INTO pick_parse_log (admin_id, order_no, parsed) VALUES (?, ?, ?)`, [String(adminId || "").slice(0, 60), snap.orderNo || null, JSON.stringify(snap)]);
    return r && r.insertId ? r.insertId : null;
  } catch (e) {
    console.error("[PICK] 판독 기록 실패(무시):", e.sqlMessage || e.message);
    return null;
  }
}
async function pickLogSet(id, col, obj, adminId) {
  try {
    const n = parseInt(id, 10);
    if (!isFinite(n) || n <= 0 || !["reread", "final"].includes(col)) return;
    await pickLogEnsure();
    if (col === "final") await pool.query(`UPDATE pick_parse_log SET final = ?, registered_at = NOW() WHERE id = ? AND admin_id = ?`, [JSON.stringify(obj), n, String(adminId || "").slice(0, 60)]);
    else await pool.query(`UPDATE pick_parse_log SET reread = ? WHERE id = ? AND admin_id = ?`, [JSON.stringify(obj), n, String(adminId || "").slice(0, 60)]); // 남의 기록은 못 고침
  } catch (e) {
    console.error("[PICK] 판독 기록 갱신 실패(무시):", e.sqlMessage || e.message);
  }
}
// ───────── 배송 구분 (용차 = 기본 / 용마택배 / CJ택배) ─────────
//  outbound.ship_type: NULL = 용차, '용마' = 용마택배, 'CJ' = CJ택배. 컬럼이 없으면 처음 쓸 때 한 번 만든다.
//  만들지 못해도(권한 등) 달력·등록은 기존대로 동작해야 하므로 실패하면 이 기능만 꺼 둔다(1분 뒤 다시 시도).
let _shipColOk = null, _shipColTry = 0;
async function shipColReady() {
  if (_shipColOk === true) return true;
  if (_shipColOk === false && Date.now() - _shipColTry < 60000) return false;
  _shipColTry = Date.now();
  try {
    const [cols] = await pool.query(`SHOW COLUMNS FROM outbound LIKE 'ship_type'`);
    if (!cols.length) await pool.query(`ALTER TABLE outbound ADD COLUMN ship_type VARCHAR(12) NULL`);
    _shipColOk = true;
  } catch (e) {
    if (/Duplicate column/i.test(String(e.message || ""))) _shipColOk = true;
    else { _shipColOk = false; console.error("[SHIP] ship_type 컬럼 준비 실패(택배 구분만 꺼 둠):", e.sqlMessage || e.message); }
  }
  return _shipColOk === true;
}
function shipNorm(v) {
  const t = String(v == null ? "" : v).replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  if (/용마|yongma/.test(t)) return "용마";
  if (/^cj|씨제이|대한통운/.test(t)) return "CJ";
  return null; // 용차·알 수 없는 값은 모두 기본(용차)
}
// ───────── 출고지시번호 (일정 ↔ 번호 1:N) ─────────
//  outbound_orders: 한 일정에 번호가 여러 개. slot 0 = 원래 일정, slot k = k번째 수량추가(수량추가 이력 순서와 같음).
//  중복 방지용 pick_registered 와는 별개(조회·검색용).
let _ordTableReady = false;
async function ordEnsureTable() {
  if (_ordTableReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS outbound_orders (id BIGINT AUTO_INCREMENT PRIMARY KEY, outbound_id BIGINT NOT NULL, order_no VARCHAR(40) NOT NULL, kind VARCHAR(8), slot INT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_ord (outbound_id, order_no), KEY ix_ord_no (order_no))`);
  // 처음 만든 버전에는 slot 이 없었음 → 컬럼 추가
  try {
    const [cols] = await pool.query(`SHOW COLUMNS FROM outbound_orders LIKE 'slot'`);
    if (!cols.length) await pool.query(`ALTER TABLE outbound_orders ADD COLUMN slot INT NOT NULL DEFAULT 0`);
  } catch (e) { if (!/Duplicate column/i.test(String(e.message || ""))) console.error("[ORD] slot 컬럼 추가 실패:", e.sqlMessage || e.message); }
  // 이미 피킹지로 등록된(일정이 남아 있는) 번호를 한 번만 옮겨 채움 — 이후 지운 번호가 되살아나지 않게 완료 표시를 남김
  try {
    const [fl] = await pool.query(`SELECT 1 FROM system_settings WHERE setting_key = 'ORD_BACKFILL_DONE' LIMIT 1`);
    if (!fl.length) {
      await pickEnsureTable();
      await pool.query(`INSERT IGNORE INTO outbound_orders (outbound_id, order_no, kind) SELECT pr.outbound_id, UPPER(pr.order_no), pr.mode FROM pick_registered pr JOIN outbound o ON o.id = pr.outbound_id WHERE pr.outbound_id > 0`);
      await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('ORD_BACKFILL_DONE', '1') ON DUPLICATE KEY UPDATE setting_value = '1'`);
    }
  } catch (e) { console.error("[ORD] 기존 번호 채우기 실패(무시):", e.sqlMessage || e.message); }
  // 예전 방식('수량추가'로 저장됐지만 slot 이 0)인 번호는 만들어진 순서대로 1차·2차… 로 맞춤
  try {
    const [lg] = await pool.query(`SELECT id, outbound_id FROM outbound_orders WHERE kind = 'append' AND slot = 0 ORDER BY outbound_id, id`);
    if (lg.length) {
      const [mx] = await pool.query(`SELECT outbound_id, MAX(slot) AS m FROM outbound_orders WHERE kind = 'append' GROUP BY outbound_id`);
      const next = {};
      for (const r of mx) next[r.outbound_id] = Number(r.m) || 0;
      for (const r of lg) {
        next[r.outbound_id] = (next[r.outbound_id] || 0) + 1;
        await pool.query(`UPDATE outbound_orders SET slot = ? WHERE id = ?`, [next[r.outbound_id], r.id]);
      }
    }
  } catch (e) { console.error("[ORD] 순서 맞추기 실패(무시):", e.sqlMessage || e.message); }
  _ordTableReady = true;
}
// 붙여넣은 글(줄바꿈·쉼표·공백 구분)에서 번호 목록 추출: 영문·숫자만, 대문자, 6자 이상, 중복 제거, 최대 20개
function ordNormList(v) {
  const src = Array.isArray(v) ? v.join("\n") : String(v == null ? "" : v);
  const out = [];
  for (const t of src.split(/[\s,;]+/)) {
    const n = t.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 40);
    if (n.length >= 6 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 20);
}
async function ordAdd(outboundId, list, kind, slot) {
  if (!(outboundId > 0) || !list || !list.length) return 0;
  await ordEnsureTable();
  let n = 0;
  for (const no of list) {
    const [r] = await pool.query(`INSERT IGNORE INTO outbound_orders (outbound_id, order_no, kind, slot) VALUES (?, ?, ?, ?)`, [outboundId, no, kind || "manual", Number(slot) || 0]);
    n += r && r.affectedRows ? 1 : 0;
  }
  return n;
}
// 방금 수량추가한 일정의 '몇 번째 수량추가인지' = 비고에 남은 [M/D …추가] 이력 개수
async function ordAppendSlot(outboundId) {
  try {
    const [r] = await pool.query(`SELECT etc FROM outbound WHERE id = ? LIMIT 1`, [outboundId]);
    const m = String((r[0] && r[0].etc) || "").match(/\[\d{1,2}\/\d{1,2}\s*(?:\d+P)?\s*(?:\d+B)?\s*추가\]/g);
    return Math.max(1, m ? m.length : 1);
  } catch (_) { return 1; }
}
// 수정창에서 보낸 {slot: "번호 텍스트"} 로 그 일정의 번호를 통째로 바꾼다. 반환: 바뀌었는지
async function ordSetSlots(outboundId, slots) {
  if (!(outboundId > 0) || !slots || typeof slots !== "object") return false;
  await ordEnsureTable();
  const want = [];
  const seen = new Set();
  for (const k of Object.keys(slots).slice(0, 60)) {
    const sl = parseInt(k, 10);
    if (!(sl >= 0)) continue;
    for (const no of ordNormList(slots[k])) { if (!seen.has(no)) { seen.add(no); want.push({ no, slot: sl }); } }
  }
  const [cur] = await pool.query(`SELECT order_no, slot, kind FROM outbound_orders WHERE outbound_id = ? ORDER BY id ASC`, [outboundId]);
  const same = cur.length === want.length && want.every((w) => cur.some((c) => c.order_no === w.no && Number(c.slot) === w.slot));
  if (same) return false;
  await pool.query(`DELETE FROM outbound_orders WHERE outbound_id = ?`, [outboundId]);
  try {
    for (const w of want) await pool.query(`INSERT IGNORE INTO outbound_orders (outbound_id, order_no, kind, slot) VALUES (?, ?, ?, ?)`, [outboundId, w.no, w.slot > 0 ? "append" : "manual", w.slot]);
  } catch (e) { // 중간에 실패하면 원래 번호로 되돌림(번호가 반쯤만 남는 것 방지)
    try { await pool.query(`DELETE FROM outbound_orders WHERE outbound_id = ?`, [outboundId]); for (const c of cur) await pool.query(`INSERT IGNORE INTO outbound_orders (outbound_id, order_no, kind, slot) VALUES (?, ?, ?, ?)`, [outboundId, c.order_no, c.kind || "manual", Number(c.slot) || 0]); } catch (_) {}
    throw e;
  }
  return true;
}
// 일정 id 목록 → { id: [{no, slot}] } (달력 데이터에 함께 실어 보냄). 실패해도 달력은 그대로
async function ordMapFor(ids) {
  const out = {};
  const list = (ids || []).filter((x) => x > 0);
  if (!list.length) return out;
  try {
    await ordEnsureTable();
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500);
      const [rs] = await pool.query(`SELECT outbound_id, order_no, slot FROM outbound_orders WHERE outbound_id IN (${part.map(() => "?").join(",")}) ORDER BY slot ASC, id ASC`, part);
      for (const r of rs) (out[r.outbound_id] = out[r.outbound_id] || []).push({ no: r.order_no, slot: Number(r.slot) || 0 });
    }
  } catch (e) { console.error("[ORD] 번호 불러오기 실패(무시):", e.sqlMessage || e.message); }
  return out;
}

// 등록 기록이 가리키는 일정이 아직 살아 있는지. 반환 {alive, info}
async function pickRecAlive(rec) {
  if (!rec || !(rec.outbound_id > 0)) return { alive: false, info: null };
  const [rs] = await pool.query(`SELECT company, pal, box, etc, DATE_FORMAT(outbound_date, '%Y-%m-%d') AS date FROM outbound WHERE id = ? LIMIT 1`, [rec.outbound_id]);
  if (!rs.length) return { alive: false, info: null };
  const r = rs[0];
  if (rec.mode === "append" && rec.hist && !String(r.etc || "").includes(rec.hist)) return { alive: false, info: null }; // 추가 이력을 지웠으면 되돌린 것으로 본다
  return { alive: true, info: { company: r.company, date: r.date || null, mode: rec.mode || "new" } };
}
async function pickDupState(orderNo) {
  await pickEnsureTable();
  const [rs] = await pool.query(`SELECT outbound_id, mode, hist, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM pick_registered WHERE order_no = ?`, [orderNo]);
  if (rs.length) {
    const rec = rs[0];
    if (rec.outbound_id === 0) return { dup: rec.age < 120, info: null, legacy: false }; // 다른 곳에서 등록 처리 중
    const a = await pickRecAlive(rec);
    return { dup: a.alive, info: a.info, legacy: false };
  }
  // 이전 버전(processed_images)이 남긴 표시: 어느 일정인지 알 수 없어 막지 않고 알려만 준다
  let legacy = false;
  try {
    const [lr] = await pool.query(`SELECT 1 FROM processed_images WHERE unique_id = ?`, ["PICK:" + orderNo]);
    legacy = lr.length > 0;
  } catch (_) {}
  return { dup: false, info: null, legacy };
}
// 등록 권리 확보: 새로 만들거나, 지워진 일정의 기록을 한 번에 한 요청만 넘겨받는다
async function pickClaim(orderNo, mode) {
  await pickEnsureTable();
  const [ins] = await pool.query(`INSERT IGNORE INTO pick_registered (order_no, outbound_id, mode) VALUES (?, 0, ?)`, [orderNo, mode]);
  if (ins && ins.affectedRows) return { ok: true };
  const [rs] = await pool.query(`SELECT outbound_id, mode, hist, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM pick_registered WHERE order_no = ?`, [orderNo]);
  if (!rs.length) return { ok: false, msg: "등록 처리 중 충돌이 났습니다. 다시 시도해주세요." };
  const rec = rs[0];
  if (rec.outbound_id === 0 && rec.age < 120) return { ok: false, msg: `이미 처리 중인 피킹지입니다. (${orderNo})` };
  if (rec.outbound_id !== 0) {
    const a = await pickRecAlive(rec);
    if (a.alive) return { ok: false, msg: `이미 등록된 피킹지입니다. (${orderNo})` + (a.info ? ` → ${a.info.company} ${a.info.date || "미정"}` : "") };
  }
  const [up] = await pool.query(`UPDATE pick_registered SET outbound_id = 0, mode = ?, hist = NULL, created_at = NOW() WHERE order_no = ? AND outbound_id = ? AND (outbound_id <> 0 OR TIMESTAMPDIFF(SECOND, created_at, NOW()) >= 120)`, [mode, orderNo, rec.outbound_id]);
  if (up && up.affectedRows) return { ok: true };
  return { ok: false, msg: `이미 처리 중인 피킹지입니다. (${orderNo})` };
}

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 3, // TiDB 무료 티어 연결 한도(25) 초과 방지
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  waitForConnections: true,
  queueLimit: 0,
});

// ── 모듈 레벨 유틸 (요청마다 재생성 방지)
const parseJSON = (val) => {
  try {
    return typeof val === "string" ? JSON.parse(val) : val;
  } catch (e) {
    return val;
  }
};
const safeDate = (v) => (!v || v === "" || v === "null" || v === "미정" ? null : v);

// ── 세션 토큰 (HMAC-SHA256, DB 없이 자가검증, 30일 유효)
const TOKEN_SECRET = process.env.TOKEN_SECRET || process.env.DATABASE_URL?.slice(-32) || "fallback-secret";
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // 30일

function generateToken(admin_id) {
  const expires = Date.now() + TOKEN_TTL;
  const payload = `${admin_id}:${expires}`;
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastColon = decoded.lastIndexOf(":");
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    if (sig !== expected) return null;
    const colonIdx = payload.indexOf(":");
    const admin_id = payload.slice(0, colonIdx);
    const expires = parseInt(payload.slice(colonIdx + 1));
    if (Date.now() > expires) return null;
    return admin_id;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────
// 🔐 권한 체계
//  - 시스템 관리자(isSystem): TELEGRAM_OWNER_ID 와 일치하는 계정 또는 role='SYSTEM'
//  - 위임 권한(PERM_KEYS): 시스템 관리자가 관리자페이지에서 ID별로 ON/OFF (기본 OFF)
//      ocr_compare : 입고 OCR 대조·수정·확정
//      ocr_upload  : 입고 앱 사진 OCR (※ ocr_compare 가 꺼져 있으면 함께 무효)
// ───────────────────────────────────────────────────────────
const PERM_KEYS = ["ocr_compare", "ocr_upload"];
let _permTableReady = false;
async function ensurePermTable() {
  if (_permTableReady) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS admin_perms (
       admin_id VARCHAR(64) NOT NULL,
       perm_key VARCHAR(32) NOT NULL,
       enabled TINYINT NOT NULL DEFAULT 0,
       updated_by VARCHAR(64) NULL,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       PRIMARY KEY (admin_id, perm_key)
     )`,
  );
  _permTableReady = true;
}
function isOwnerId(adminId) {
  const o = (process.env.TELEGRAM_OWNER_ID || "").trim().toLowerCase();
  return !!o && String(adminId || "").trim().toLowerCase() === o;
}
// 계정 1개의 권한 컨텍스트 → { isSystem, perms:{ocr_compare,ocr_upload} }
async function loadAdminCtx(adminId, roleHint) {
  let role = roleHint;
  if (role === undefined) {
    const [r] = await pool.query("SELECT role FROM admins WHERE LOWER(admin_id) = LOWER(?)", [adminId]);
    role = r.length ? r[0].role : null;
  }
  const isSystem = isOwnerId(adminId) || String(role || "").toUpperCase() === "SYSTEM";
  const perms = { ocr_compare: false, ocr_upload: false };
  if (isSystem) {
    perms.ocr_compare = true;
    perms.ocr_upload = true;
    return { isSystem, perms };
  }
  try {
    await ensurePermTable();
    const [rows] = await pool.query(
      "SELECT perm_key, enabled FROM admin_perms WHERE LOWER(admin_id) = LOWER(?)",
      [adminId],
    );
    rows.forEach((x) => {
      if (PERM_KEYS.includes(x.perm_key)) perms[x.perm_key] = Number(x.enabled) === 1;
    });
  } catch (e) {
    console.error("권한 조회 오류(기본 OFF 처리):", e);
  }
  if (!perms.ocr_compare) perms.ocr_upload = false; // 업로드는 대조 권한이 전제
  return { isSystem, perms };
}
// 시스템 관리자 전용 액션 (관리자페이지 전체 + 시스템 설정)
const SYSTEM_ONLY_ACTIONS = new Set([
  "CREATE_ADMIN", "DELETE_ADMIN", "REACTIVATE_ADMIN", "HARD_DELETE_ADMIN", "RESET_ADMIN_PW",
  "GET_ADMIN_LIST", "GET_ADMIN_CONN_LOGS", "GET_AUDIT_LOGS", "GET_ALL_CONN_LOGS",
  "GET_RAW_DB_ROWS", "UPDATE_RAW_ROW_FULL", "UPDATE_RAW_ROW_DIRECT", "ADD_RAW_ROW_DIRECT", "DELETE_RAW_ROW_DIRECT",
  "SAVE_OCR_INFO", "SAVE_OCR_FILTERS", "SET_ADMIN_PERMS", "PICK_STATS", "PICK_KEYTEST",
]);
// 위임 권한이 필요한 액션 (시스템 관리자는 항상 통과)
const PERM_ACTIONS = { OCR_UPLOAD: "ocr_upload", APPLY_OCR_DATA: "ocr_compare" };

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function getSaturdayOfWeek(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - d.getDay() + 6);
  return d.toISOString().slice(0, 10);
}

// ── 콜드스타트 시 인덱스 1회 생성 (이미 있으면 errno 1061로 무시)
(async () => {
  const tryIdx = (sql) => pool.query(sql).catch((e) => { if (e.errno !== 1061) console.warn("idx:", e.message); });
  await tryIdx("ALTER TABLE inbound ADD INDEX idx_receive_date (receive_date)");
  await tryIdx("ALTER TABLE inbound ADD INDEX idx_invoice (invoice(50))");
  await tryIdx("ALTER TABLE inbound ADD INDEX idx_bl_number (bl_number(50))");
  await tryIdx("ALTER TABLE outbound ADD INDEX idx_outbound_date (outbound_date)");
  await tryIdx("ALTER TABLE admin_audit_logs ADD INDEX idx_audit_admin_action (admin_id, action_type)");
  // 접속로그 목록(action_type 필터 + created_at 정렬) 및 로그인 실패 카운트(ip+action+created_at) 가속
  await tryIdx("ALTER TABLE admin_audit_logs ADD INDEX idx_audit_action_created (action_type, created_at)");
  await tryIdx("ALTER TABLE admin_audit_logs ADD INDEX idx_audit_ip_action (ip_address, action_type, created_at)");
})();

module.exports = async function (req, res) {
  // CORS: 자사 도메인(프로덕션 별칭 + 이 프로젝트 배포 URL)만 허용.
  // ※ 동일 출처(same-origin) 요청은 브라우저가 CORS 검사를 안 하므로 앱은 영향 없음.
  const ALLOWED_ORIGIN = /^https:\/\/(calendar-app-two-gules|calendar-[a-z0-9]+-silverscent)\.vercel\.app$/;
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGIN.test(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  _hookResEndForNotify(res); // 📲 알림 전송 완료 후 응답 종료 (서버리스 동결 방지)

  try {
    if (req.method === "GET") {
      const { type, year, month, action } = req.query;

      // 🚨 [초고속 튜닝 1] 연간 통계
      if (action === "yearlyStats") {
        let rows = [];
        const startYear = `${year}-01-01`;
        const endYear = `${parseInt(year) + 1}-01-01`;

        if (type === "out") {
          [rows] = await pool.query(
            `SELECT outbound_date, pal, box, etc, company, isDone FROM outbound WHERE outbound_date >= ? AND outbound_date < ?`,
            [startYear, endYear],
          );
        } else {
          [rows] = await pool.query(
            `SELECT receive_date, pallets, s_type, remarks, bl_number FROM inbound WHERE receive_date >= ? AND receive_date < ?`,
            [startYear, endYear],
          );
        }

        let monthly = Array.from({ length: 12 }, () => ({ pal: 0, box: 0, details: {} }));
        let compStats = {};

        rows.forEach((r) => {
          let dateVal = type === "out" ? r.outbound_date : r.receive_date;
          if (!dateVal) return;
          let d = new Date(dateVal);
          let mIdx = d.getMonth();

          if (type === "out") {
            let name = r.company;
            let cleanName = (name || "").replace(/\[TASK\]/gi, "").trim();
            let isTask =
              (name || "").toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(cleanName);
            if (!isTask) {
              let p = parseInt(r.pal) || 0;
              let b = parseInt(r.box) || 0;
              monthly[mIdx].pal += p;
              monthly[mIdx].box += b;
              if (!monthly[mIdx].details[cleanName]) monthly[mIdx].details[cleanName] = { pal: 0, box: 0 };
              monthly[mIdx].details[cleanName].pal += p;
              monthly[mIdx].details[cleanName].box += b;
              if (!compStats[cleanName]) compStats[cleanName] = { pal: 0, box: 0 };
              compStats[cleanName].pal += p;
              compStats[cleanName].box += b;
            }
          } else {
            let p = parseInt(r.pallets) || 0;
            monthly[mIdx].pal += p;
            let sLabel = r.s_type === "AIR" ? "✈️ 항공 (AIR)" : "🚢 해상 (SEA)";

            if (!monthly[mIdx].details[sLabel]) monthly[mIdx].details[sLabel] = { pal: 0, box: 0 };
            monthly[mIdx].details[sLabel].pal += p;

            if (!compStats[sLabel]) compStats[sLabel] = { pal: 0, box: 0 };
            compStats[sLabel].pal += p;
          }
        });
        return res.status(200).json({ success: true, year: parseInt(year), monthly: monthly, comp: compStats });
      }

      let formattedData = { year: parseInt(year), month: parseInt(month), monthData: {}, pendingItems: [] };

      // 🚨 [초고속 튜닝 2] 월간 달력 데이터
      const m = parseInt(month);
      const y = parseInt(year);
      const startYmd = `${y}-${String(m).padStart(2, "0")}-01`;
      const endYmd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

      if (type === "out") {
        const _stc = (await shipColReady()) ? ", ship_type" : "";
        const [monthRows] = await pool.query(
          `SELECT id, company, pal, box, etc, isDone, sort_idx, outbound_date${_stc} FROM outbound WHERE outbound_date >= ? AND outbound_date < ? ORDER BY sort_idx ASC, id ASC`,
          [startYmd, endYmd],
        );
        const [pendingRows] = await pool.query(
          `SELECT id, company, pal, box, etc, isDone, sort_idx${_stc} FROM outbound WHERE outbound_date IS NULL ORDER BY sort_idx ASC, id ASC`,
        );
        // 출고지시번호도 같이 실어 보냄 (상세를 열 때 따로 불러오지 않아도 바로 보이게)
        // 번호는 로그인한 관리자에게만 (이 주소는 로그인 없이도 열리므로 토큰이 없거나 틀리면 싣지 않음)
        let _ordMap = {};
        try {
          const _gt = String((req.headers && req.headers["x-session-token"]) || "");
          if (_gt && verifyToken(_gt)) _ordMap = await ordMapFor([...monthRows, ...pendingRows].map((r) => r.id));
        } catch (_) {}
        monthRows.forEach((row) => {
          const day = new Date(row.outbound_date).getUTCDate();
          if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
          formattedData.monthData[day].push({
            id: row.id,
            company: row.company,
            pal: row.pal,
            box: row.box,
            etc: row.etc,
            isDone: row.isDone === 1,
            sortIdx: row.sort_idx !== null ? row.sort_idx : 999,
            ...(row.ship_type ? { shipType: row.ship_type } : {}),
            ...(_ordMap[row.id] ? { ords: _ordMap[row.id] } : {}),
          });
        });
        pendingRows.forEach((row) => {
          formattedData.pendingItems.push({
            id: row.id,
            company: row.company,
            pal: row.pal,
            box: row.box,
            etc: row.etc,
            isDone: row.isDone === 1,
            sortIdx: row.sort_idx !== null ? row.sort_idx : 999,
            ...(row.ship_type ? { shipType: row.ship_type } : {}),
            ...(_ordMap[row.id] ? { ords: _ordMap[row.id] } : {}),
          });
        });
      } else {
        const [monthRows] = await pool.query(
          `SELECT id, bl_number, pallets, remarks, s_type, fwd, invoice, status, is_ai_modified, sort_idx, receive_date, DATE_FORMAT(eta,'%Y-%m-%d') AS eta FROM inbound WHERE receive_date >= ? AND receive_date < ? ORDER BY sort_idx ASC, id ASC`,
          [startYmd, endYmd],
        );
        const [pendingRows] = await pool.query(
          `SELECT id, bl_number, pallets, remarks, s_type, fwd, invoice, status, is_ai_modified, sort_idx, DATE_FORMAT(eta,'%Y-%m-%d') AS eta FROM inbound WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`,
        );
        monthRows.forEach((row) => {
          const day = new Date(row.receive_date).getUTCDate();
          if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
          formattedData.monthData[day].push({
            id: row.id,
            bl: row.bl_number,
            company: row.bl_number,
            pal: row.pallets,
            etc: row.remarks,
            sType: row.s_type,
            fwd: row.fwd,
            invoice: row.invoice,
            eta: row.eta || "",
            isDone: row.status === "완료",
            isAi: row.is_ai_modified === 1,
            sortIdx: row.sort_idx !== null ? row.sort_idx : 999,
          });
        });
        pendingRows.forEach((row) => {
          formattedData.pendingItems.push({
            id: row.id,
            bl: row.bl_number,
            company: row.bl_number,
            pal: row.pallets,
            etc: row.remarks,
            sType: row.s_type,
            fwd: row.fwd,
            invoice: row.invoice,
            eta: row.eta || "",
            isDone: row.status === "완료",
            isAi: row.is_ai_modified === 1,
            sortIdx: row.sort_idx !== null ? row.sort_idx : 999,
          });
        });
      }
      return res.status(200).json(formattedData);
    }

    // ====================================================================
    // 🛡️ [시스템 관리] 마스터 전용 백엔드 파이프라인 및 순정 캘린더 기능
    // ====================================================================
    if (req.method === "POST") {
      const body = req.body;
      const payload = typeof body === "string" ? JSON.parse(body) : body;

      // 🚨 변수 구조 분해
      const { domain, action, data, keyword, type, rowId, year, month, id, admin_id } = payload;
      let currentAdmin = admin_id || "system"; // secureActions 토큰 검증 후 실제 admin_id로 갱신
      let _ctx = null; // secureActions 통과 시 { isSystem, perms }

      // 관리자 인증 필요 액션 (Set → O(1) 조회)
      const secureActions = new Set([
        "ADD",
        "EDIT",
        "DELETE",
        "DONE",
        "UNDO_DONE",
        "ADD_QTY",
        "UPDATE_ORDER",
        "MULTI_DELETE",
        "MULTI_DONE",
        "MULTI_UNDO_DONE",
        "ADD_BLOCK",
        "EDIT_BLOCK",
        "DELETE_BLOCK",
        "CREATE_ADMIN",
        "DELETE_ADMIN",
        "REACTIVATE_ADMIN",
        "HARD_DELETE_ADMIN",
        "RESET_ADMIN_PW",
        "CHANGE_MY_PASSWORD",
        "UPDATE_RAW_ROW_FULL",
        "UPDATE_RAW_ROW_DIRECT",
        "ADD_RAW_ROW_DIRECT",
        "DELETE_RAW_ROW_DIRECT",
        "GET_RAW_DB_ROWS",
        "GET_AUDIT_LOGS",
        "GET_ALL_CONN_LOGS",
        "GET_ADMIN_LIST",
        "GET_ADMIN_CONN_LOGS",
        "SEARCH_SCHEDULES",
        "SAVE_COMP_INFO_DB",
        "LIST_ORPHAN_COMPANIES",
        "MOVE_COMPANY_ROWS",
        "SET_ORPHAN_IGNORE",
        "GET_CAL_NOTIFY",
        "SET_CAL_NOTIFY",
        "SAVE_GLOBAL_COLOR",
        "SAVE_OCR_INFO",
        "SAVE_OCR_FILTERS",
        "APPLY_OCR_DATA",
        "OCR_UPLOAD",
        "PICK_PARSE",
        "PICK_REREAD",
        "PICK_STATS",
        "PICK_KEYTEST",
        "PICK_REGISTER",
        "PICK_FIND_ROWS",
        "FIND_INBOUND_DUPES",
        "DELETE_INBOUND_DUPES",
        "AI_QUERY",
        "GET_MY_PERMS",
        "SET_ADMIN_PERMS",
      ]);

      if (secureActions.has(action)) {
        const sessionToken = payload.session_token;
        let effectiveAdminId = admin_id;

        if (sessionToken) {
          const tokenAdmin = verifyToken(sessionToken);
          if (!tokenAdmin) {
            return res
              .status(200)
              .json({ success: false, forceLogout: true, msg: "세션이 만료되었습니다. 다시 로그인하세요." });
          }
          // admin_id가 있으면 토큰과 일치 여부 확인, 없으면 토큰에서 사용
          if (admin_id && tokenAdmin !== admin_id) {
            return res
              .status(200)
              .json({ success: false, forceLogout: true, msg: "세션이 만료되었습니다. 다시 로그인하세요." });
          }
          effectiveAdminId = tokenAdmin;
          currentAdmin = tokenAdmin; // 세션 토큰에서 검증된 실제 admin_id로 덮어씀
        } else {
          return res
            .status(200)
            .json({ success: false, forceLogout: true, msg: "로그인 세션이 만료되었거나 유효하지 않습니다." });
        }

        const [sessionCheck] = await pool.query("SELECT status FROM admins WHERE admin_id = ?", [effectiveAdminId]);
        if (sessionCheck.length === 0 || sessionCheck[0].status === "LOCKED") {
          return res
            .status(200)
            .json({ success: false, forceLogout: true, msg: "관리자에 의해 계정이 비활성화되었습니다." });
        }

        // 🔐 권한 게이트 (서버 최종 방어선 — 화면 숨김과 무관하게 항상 검사)
        _ctx = await loadAdminCtx(effectiveAdminId);
        if (SYSTEM_ONLY_ACTIONS.has(action) && !_ctx.isSystem) {
          return res.status(200).json({ success: false, forbidden: true, msg: "시스템 관리자만 사용할 수 있는 기능입니다." });
        }
        if (PERM_ACTIONS[action] && !_ctx.perms[PERM_ACTIONS[action]]) {
          return res.status(200).json({ success: false, forbidden: true, msg: "이 기능은 권한이 부여된 관리자만 사용할 수 있습니다." });
        }
      }

      // ── 생체인증 재로그인용 세션 토큰 검증
      /*if (action === "VERIFY_SESSION") {
        const token = payload.session_token;
        if (!token) return res.status(200).json({ success: false, msg: "토큰이 없습니다." });
        const tokenAdmin = verifyToken(token);
        if (!tokenAdmin)
          return res.status(200).json({ success: false, msg: "세션이 만료되었습니다. 다시 로그인하세요." });
        const [rows] = await pool.query("SELECT admin_id, admin_name, role, status FROM admins WHERE admin_id = ?", [
          tokenAdmin,
        ]);
        if (rows.length === 0 || rows[0].status === "LOCKED")
          return res.status(200).json({ success: false, msg: "계정이 비활성화되었습니다." });
        const isOwner = !!(process.env.TELEGRAM_OWNER_ID &&
          rows[0].admin_id.toLowerCase() === process.env.TELEGRAM_OWNER_ID.toLowerCase());
        return res
          .status(200)
          .json({ success: true, admin_id: rows[0].admin_id, name: rows[0].admin_name, role: rows[0].role, isOwner });
      }
          */

      // 수정 후
if (action === "VERIFY_SESSION") {
    const token = payload.session_token;
    if (!token) return res.status(200).json({ success: false, msg: "토큰이 없습니다." });
    
    // 서명 검증 (만료 여부와 무관하게 위조 여부 먼저 확인)
    let tokenAdmin = verifyToken(token);
    let isExpired = false;
    
    if (!tokenAdmin) {
        // 만료된 건지, 위조된 건지 구분
        try {
            const decoded = Buffer.from(token, "base64url").toString("utf8");
            const lastColon = decoded.lastIndexOf(":");
            const pl = decoded.slice(0, lastColon);
            const sig = decoded.slice(lastColon + 1);
            const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(pl).digest("hex");
            if (sig === expected) {
                // 서명은 맞음 → 만료된 토큰
                const colonIdx = pl.indexOf(":");
                tokenAdmin = pl.slice(0, colonIdx);
                isExpired = true;
            }
        } catch {}
    }
    
    if (!tokenAdmin)
        return res.status(200).json({ success: false, msg: "세션이 만료되었습니다. 다시 로그인하세요." });

    // 🔒 생체인증 계정 혼선 방지: 클라이언트가 기대하는 계정(bio_id)과 토큰의 계정이 다르면 거부
    if (payload.expect_admin_id &&
        String(payload.expect_admin_id).trim().toLowerCase() !== String(tokenAdmin).trim().toLowerCase())
        return res.status(200).json({ success: false, mismatch: true, msg: "생체인증에 등록된 계정과 저장된 세션이 일치하지 않습니다. 비밀번호로 로그인해 주세요." });
    
    const [rows] = await pool.query("SELECT admin_id, admin_name, role, status FROM admins WHERE admin_id = ?", [
        tokenAdmin,
    ]);
    if (rows.length === 0 || rows[0].status === "LOCKED")
        return res.status(200).json({ success: false, msg: "계정이 비활성화되었습니다." });
    
    const isOwner = !!(process.env.TELEGRAM_OWNER_ID &&
        rows[0].admin_id.toLowerCase() === process.env.TELEGRAM_OWNER_ID.toLowerCase());
    
    // 만료된 토큰이면 새 토큰 발급해서 반환
    const newToken = isExpired ? generateToken(rows[0].admin_id) : token;
    const _vctx = await loadAdminCtx(rows[0].admin_id, rows[0].role);
    return res.status(200).json({ 
        isSystem: _vctx.isSystem,
        perms: _vctx.perms,
        success: true, 
        admin_id: rows[0].admin_id, 
        name: rows[0].admin_name, 
        role: rows[0].role, 
        isOwner,
        session_token: newToken,  // 만료 시 새 토큰, 유효 시 기존 토큰
        renewed: isExpired        // 클라이언트에서 저장 여부 판단용
    });
}

      if (action === "LOG_SITE_ACCESS") {
        try {
          // 접속자 IP 추출 (프록시 환경 고려)
          let ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "IP 알수없음";
          if (ip.includes(",")) ip = ip.split(",")[0];

          const { admin_id, access_type, description } = payload;

          // 👉 description에 수동 로그인처럼 IP를 강제로 붙여버리자!
          let finalDesc = `IP: ${ip} | ${description}`;

          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, ?, ?, ?)",
            [admin_id || "GUEST", access_type || "GUEST", finalDesc, ip],
          );
          // AUTO_LOGIN이면 admins.last_login_at도 함께 갱신 → 관리자 목록 "최근 접속"에 반영
          if (access_type === "AUTO_LOGIN" && admin_id && admin_id !== "GUEST") {
            await pool.query("UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?", [admin_id]);
          }
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("접속 로그 기록 에러:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 👇 🚨 [신규 3] 로그아웃 기록 저장 👇
      else if (action === "LOG_LOGOUT") {
        try {
          let ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "IP 알수없음";
          if (ip.includes(",")) ip = ip.split(",")[0];

          const { admin_id } = payload;

          if (admin_id) {
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, 'LOGOUT', '시스템에서 정상적으로 로그아웃했습니다.', ?)",
              [admin_id, ip],
            );
          }
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("로그아웃 기록 에러:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 👇 🚨 [신규 2] 전체 접속 로그만 쏙 뽑아오는 조회 엔진 👇
      else if (action === "GET_ALL_CONN_LOGS") {
        try {
          const limit = parseInt(payload.limit) || 100;
          const page = parseInt(payload.page) || 1;
          const offset = (page - 1) * limit;
          const keyword = payload.keyword || "";

          // 💡 핵심: 기존 테이블에서 로그인/접속 관련 로그만 필터링해서 가져옴
          let queryStr =
            "SELECT admin_id, action_type, description, ip_address, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE action_type IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
          let countQueryStr =
            "SELECT COUNT(*) as cnt FROM admin_audit_logs WHERE action_type IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
          let params = [];

          // 접속 타입 필터 (전체면 생략)
          const connType = payload.connType;
          if (connType && ["LOGIN", "AUTO_LOGIN", "GUEST", "LOGOUT"].includes(connType)) {
            queryStr += " AND action_type = ?";
            countQueryStr += " AND action_type = ?";
            params.push(connType);
          }
          // 기간 필터 (KST 기준 입력 → UTC 보정)
          if (payload.startDate) {
            queryStr += " AND created_at >= DATE_SUB(?, INTERVAL 9 HOUR)";
            countQueryStr += " AND created_at >= DATE_SUB(?, INTERVAL 9 HOUR)";
            params.push(payload.startDate + " 00:00:00");
          }
          if (payload.endDate) {
            queryStr += " AND created_at <= DATE_SUB(?, INTERVAL 9 HOUR)";
            countQueryStr += " AND created_at <= DATE_SUB(?, INTERVAL 9 HOUR)";
            params.push(payload.endDate + " 23:59:59");
          }

          if (keyword) {
            const subClause =
              " AND (LOWER(admin_id) LIKE LOWER(?) OR LOWER(action_type) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))";
            queryStr += subClause;
            countQueryStr += subClause;
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
          }

          queryStr += " ORDER BY id DESC LIMIT ? OFFSET ?";
          let queryParams = [...params, limit, offset];

          const [rows] = await pool.query(queryStr, queryParams);
          const [countRows] = await pool.query(countQueryStr, params);
          const totalCount = countRows[0].cnt;

          return res.status(200).json({
            success: true,
            logs: rows,
            totalCount: totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit),
          });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }
      // 👆 ---------------------------------------------------- 👆

      // 🆕 A. 신규 관리자 계정 추가 — bcrypt 해시화 적용
      else if (action === "CREATE_ADMIN") {
        try {
          const { id, name, pw } = data;
          const [exist] = await pool.query("SELECT admin_id FROM admins WHERE admin_id = ?", [id]);
          if (exist.length > 0) return res.status(200).json({ success: false, msg: "이미 등록된 아이디입니다." });
          const hashedPw = await bcrypt.hash(pw, 10); // ✅ bcrypt 해시화
          await pool.query(
            "INSERT INTO admins (admin_id, password_hash, admin_name, role, status) VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')",
            [id, hashedPw, name],
          );
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CREATE_ADMIN', ?)",
            [currentAdmin, `새로운 관리자 계정 발급: ${name}(${id})`],
          );
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🔐 내 권한 조회 (로그인한 모든 관리자)
      else if (action === "GET_MY_PERMS") {
        return res.status(200).json({ success: true, isSystem: _ctx.isSystem, perms: _ctx.perms });
      }

      // 🔐 ID별 위임 권한 ON/OFF (시스템 관리자 전용 — SYSTEM_ONLY_ACTIONS 에서 선차단)
      else if (action === "SET_ADMIN_PERMS") {
        try {
          const targetId = String((data && data.targetId) || "").trim();
          const permKey = String((data && data.perm) || "");
          const enabled = !!(data && data.enabled);
          if (!targetId || !PERM_KEYS.includes(permKey))
            return res.status(200).json({ success: false, msg: "잘못된 요청입니다." });
          const [t] = await pool.query("SELECT admin_id, role FROM admins WHERE LOWER(admin_id) = LOWER(?)", [targetId]);
          if (t.length === 0) return res.status(200).json({ success: false, msg: "존재하지 않는 계정입니다." });
          if (isOwnerId(t[0].admin_id) || String(t[0].role || "").toUpperCase() === "SYSTEM")
            return res.status(200).json({ success: false, msg: "시스템 관리자는 항상 모든 권한을 가집니다." });
          await ensurePermTable();
          const tid = String(t[0].admin_id).toLowerCase();
          const upsert = "INSERT INTO admin_perms (admin_id, perm_key, enabled, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_by = VALUES(updated_by)";
          await pool.query(upsert, [tid, permKey, enabled ? 1 : 0, currentAdmin]);
          // 대조 권한을 끄면 업로드 권한도 함께 회수
          if (permKey === "ocr_compare" && !enabled) await pool.query(upsert, [tid, "ocr_upload", 0, currentAdmin]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'PERM_CHANGE', ?)",
            [currentAdmin, `[권한 ${enabled ? "부여" : "회수"}] ${t[0].admin_id} · ${permKey}`],
          );
          const c = await loadAdminCtx(t[0].admin_id, t[0].role);
          return res.status(200).json({ success: true, perms: c.perms });
        } catch (e) {
          console.error("권한 설정 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 👤 관리자 리스트 조회 (🚨 기존 GET_ADMIN_LIST를 이걸로 교체! status 컬럼을 가져와야 함)
      else if (action === "GET_ADMIN_LIST") {
        try {
          // admins.last_login_at과 audit_logs 최근 접속 중 더 최근 값을 last_login_at으로 반환
          const [rows] = await pool.query(
            `SELECT a.admin_id, a.admin_name, a.role, a.status,
               DATE_ADD(a.created_at, INTERVAL 9 HOUR) AS created_at,
               DATE_ADD(
                 GREATEST(
                   COALESCE(a.last_login_at, '2000-01-01 00:00:00'),
                   COALESCE((
                     SELECT MAX(l.created_at) FROM admin_audit_logs l
                     WHERE l.admin_id = a.admin_id
                     AND l.action_type IN ('LOGIN_SUCCESS','AUTO_LOGIN')
                   ), '2000-01-01 00:00:00')
                 ), INTERVAL 9 HOUR
               ) AS last_login_at
             FROM admins a ORDER BY a.created_at ASC`,
          );
          // 위임 권한(ID별 ON/OFF) 합치기 — 기본 OFF
          await ensurePermTable();
          const [permRows] = await pool.query("SELECT admin_id, perm_key, enabled FROM admin_perms");
          const permMap = {};
          permRows.forEach((x) => {
            const k = String(x.admin_id).toLowerCase();
            (permMap[k] = permMap[k] || {})[x.perm_key] = Number(x.enabled) === 1;
          });
          rows.forEach((r) => {
            const sys = isOwnerId(r.admin_id) || String(r.role || "").toUpperCase() === "SYSTEM";
            const m = permMap[String(r.admin_id).toLowerCase()] || {};
            r.isSystem = sys;
            r.perms = {
              ocr_compare: sys || !!m.ocr_compare,
              ocr_upload: sys || (!!m.ocr_compare && !!m.ocr_upload),
            };
          });
          return res.status(200).json({ success: true, list: rows });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // ♻️ 관리자 계정 복구 (LOCKED -> ACTIVE)
      else if (action === "REACTIVATE_ADMIN") {
        try {
          const { id } = data;
          const currentAdmin = payload.admin_id || "SYSTEM";
          await pool.query("UPDATE admins SET status = 'ACTIVE' WHERE admin_id = ?", [id]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'REACTIVATE_ADMIN', ?)",
            [currentAdmin, `관리자 계정 활성화 복구: ${id}`],
          );
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 💥 관리자 계정 완전 삭제 (DB에서 영구 파기)
      else if (action === "HARD_DELETE_ADMIN") {
        try {
          const { id } = data;
          const currentAdmin = payload.admin_id || "SYSTEM";

          if (id === "admin" || id === "silverscent") {
            return res.status(200).json({ success: false, msg: "마스터 계정은 파기할 수 없습니다." });
          }
          if (id === currentAdmin) {
            return res.status(200).json({ success: false, msg: "현재 접속 중인 본인 계정은 삭제할 수 없습니다." });
          }

          await pool.query("DELETE FROM admins WHERE admin_id = ?", [id]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'HARD_DELETE_ADMIN', ?)",
            [currentAdmin, `관리자 계정 DB 완전 파기: ${id}`],
          );
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🗑️ C. 관리자 계정 비활성화 (요구사항 3번 완벽 해결)
      else if (action === "DELETE_ADMIN") {
        try {
          const { id } = data;
          const currentAdmin = payload.admin_id || "SYSTEM"; // 현재 로그인한 사람의 세션 ID

          // 방어막 1: 마스터 계정은 그 누구도 비활성화 불가
          if (id === "admin" || id === "silverscent") {
            return res.status(200).json({ success: false, msg: "마스터 계정은 보안상 비활성화할 수 없습니다." });
          }

          // 방어막 2: 현재 로그인 중인 '자기 자신'을 바보같이 셀프 차단하는 것만 방어!
          if (String(id).trim().toLowerCase() === String(currentAdmin).trim().toLowerCase()) {
            return res.status(200).json({ success: false, msg: "현재 접속 중인 본인 계정은 비활성화할 수 없습니다." });
          }

          // DB ENUM 규칙에 맞춰 상태를 'LOCKED'로 변경 (소프트 삭제)
          await pool.query("UPDATE admins SET status = 'LOCKED' WHERE admin_id = ?", [id]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DELETE_ADMIN', ?)",
            [currentAdmin, `관리자 계정 비활성화 처리: ${id}`],
          );

          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🔒 본인 비밀번호 변경 — bcrypt 적용
      else if (action === "CHANGE_MY_PASSWORD") {
        try {
          const currentAdmin = payload.admin_id;
          const { currentPw, newPw } = data;
          if (!currentAdmin) return res.status(200).json({ success: false, msg: "로그인 세션이 만료되었습니다." });
          const [rows] = await pool.query("SELECT password_hash FROM admins WHERE admin_id = ? AND status = 'ACTIVE'", [
            currentAdmin,
          ]);
          if (rows.length === 0)
            return res.status(200).json({ success: false, msg: "존재하지 않거나 비활성화된 계정입니다." });
          // ✅ bcrypt + SHA-256 호환 검증
          const storedHash = rows[0].password_hash;
          let isMatch;
          if (storedHash.startsWith("$2b$") || storedHash.startsWith("$2a$")) {
            isMatch = await bcrypt.compare(currentPw, storedHash);
          } else {
            isMatch = crypto.createHash("sha256").update(currentPw).digest("hex") === storedHash;
          }
          if (!isMatch) {
            return res.status(200).json({ success: false, msg: "현재 비밀번호가 일치하지 않습니다." });
          }
          // ✅ bcrypt.hash로 저장
          const hashedNewPw = await bcrypt.hash(newPw, 10);
          await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [hashedNewPw, currentAdmin]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CHANGE_PW', '본인 비밀번호 변경 성공')",
            [currentAdmin],
          );
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🔑 비밀번호 강제 초기화 — bcrypt 적용
      else if (action === "RESET_ADMIN_PW") {
        try {
          const { targetId, newPw } = data;
          const hashedNew = await bcrypt.hash(newPw, 10); // ✅ bcrypt 해시화
          await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [hashedNew, targetId]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'RESET_PW', ?)",
            [currentAdmin, `[${targetId}] 관리자 비밀번호 초기화 완료`],
          );
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 📜 D. 보안 감사 로그 타임라인 로드 (페이지네이션 + 날짜 범위 + 키워드 검색 엔진 탑재)
      else if (action === "GET_AUDIT_LOGS") {
        try {
          const { startDate, endDate, keyword } = payload;
          const limit = parseInt(payload.limit) || 50;
          const page = parseInt(payload.page) || 1;
          const offset = (page - 1) * limit;

          // 👇 🚨 이렇게 바꿔주시면 접속/로그인 기록은 보안 로그에 절대 나타나지 않습니다! 🚨 👇
          let queryStr =
            "SELECT admin_id, action_type, description, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE action_type NOT IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
          let countQueryStr =
            "SELECT COUNT(*) as cnt FROM admin_audit_logs WHERE action_type NOT IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
          let params = [];

          if (startDate) {
            const subClause = " AND created_at >= DATE_SUB(?, INTERVAL 9 HOUR)";
            queryStr += subClause;
            countQueryStr += subClause;
            params.push(startDate + " 00:00:00");
          }
          if (endDate) {
            const subClause = " AND created_at <= DATE_SUB(?, INTERVAL 9 HOUR)";
            queryStr += subClause;
            countQueryStr += subClause;
            params.push(endDate + " 23:59:59");
          }
          // 액션 종류 필터 (카테고리 → 해당 action_type 목록으로 변환)
          const ACT_GROUPS = {
            ACCOUNT: ["CREATE_ADMIN", "DELETE_ADMIN", "REACTIVATE_ADMIN", "HARD_DELETE_ADMIN"],
            PASSWORD: ["CHANGE_PW", "RESET_PW"],
            CALENDAR: [
              "CAL_ADD",
              "CAL_EDIT",
              "CAL_DELETE",
              "CAL_STATUS",
              "CAL_SORT",
              "CAL_MULTI_DEL",
              "CAL_MULTI_STAT",
            ],
            DB: ["DB_RAW_ADD", "DB_RAW_UPDATE", "DB_RAW_DELETE"],
            LOGIN: ["LOGIN_SUCCESS", "LOGIN_FAILED"],
            OCR: ["SYS_OCR_SAVE", "OCR_APPLY"],
            SETTINGS: ["SYS_COMP"],
          };
          if (payload.actGroup && ACT_GROUPS[payload.actGroup]) {
            const list = ACT_GROUPS[payload.actGroup];
            const ph = list.map(() => "?").join(", ");
            queryStr += ` AND action_type IN (${ph})`;
            countQueryStr += ` AND action_type IN (${ph})`;
            params.push(...list);
          }
          // 출고/입고 타입 필터 — description 접두어로 서버에서 필터링 (페이지네이션 정확도 보장)
          if (payload.typeFilter === "out") {
            // 출고: 출고 관련 로그 + 업체정보(SYS_COMP) 포함
            const _outCond = "(description LIKE '[출고%' OR action_type = 'SYS_COMP')";
            queryStr += ` AND ${_outCond}`;
            countQueryStr += ` AND ${_outCond}`;
          } else if (payload.typeFilter === "in") {
            // 입고: 입고 관련 로그 + OCR 대조 확정(OCR_APPLY) 포함
            const _inCond = "(description LIKE '[입고%' OR action_type = 'OCR_APPLY')";
            queryStr += ` AND ${_inCond}`;
            countQueryStr += ` AND ${_inCond}`;
          }
          if (keyword) {
            // 🚨 [패치] admin_id, description 뿐만 아니라 action_type(액션)까지 검색 대상에 포함!
            const subClause =
              " AND (LOWER(admin_id) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?) OR LOWER(action_type) LIKE LOWER(?))";
            queryStr += subClause;
            countQueryStr += subClause;
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
          }

          queryStr += " ORDER BY id DESC LIMIT ? OFFSET ?";
          let queryParams = [...params, limit, offset];

          const [rows] = await pool.query(queryStr, queryParams);
          const [countRows] = await pool.query(countQueryStr, params);
          const totalCount = countRows[0].cnt;

          return res.status(200).json({
            success: true,
            logs: rows,
            totalCount: totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit),
          });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🗄️ E. DB 다이렉트 조회 (페이지네이션 + 검색 + 오름/내림차순 정렬 엔진)
      else if (action === "GET_RAW_DB_ROWS") {
        try {
          const limit = parseInt(payload.limit) || 20;
          const page = parseInt(payload.page) || 1;
          const offset = (page - 1) * limit;
          const filterCol = payload.filterCol || "all";

          // 🚨 정렬 변수 안전하게 수신
          const sortCol = /^[a-zA-Z0-9_]+$/.test(payload.sortCol) ? payload.sortCol : "id";
          const sortDir = payload.sortDir === "ASC" ? "ASC" : "DESC";

          // 🚨 [숫자 정렬 핵심 패치] 텍스트로 저장된 숫자 컬럼들을 진짜 숫자로 변환(CAST)하여 정렬!
          const numericCols = ["id", "pal", "box", "sort_idx", "isDone", "pallets", "is_ai_modified"];
          const orderClause = numericCols.includes(sortCol) ? `CAST(${sortCol} AS SIGNED)` : sortCol;

          let rows = [];
          let countRows = [];
          let queryStr = "";
          let countQueryStr = "";
          let params = [];
          let countParams = [];

          if (type === "out") {
            queryStr =
              "SELECT id, company, pal, box, outbound_date, etc, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at, sort_idx, isDone FROM outbound";
            countQueryStr = "SELECT COUNT(*) as cnt FROM outbound";
            let whereClauses = [];
            if (keyword) {
              const kw = `%${keyword}%`;
              if (filterCol === "name") {
                whereClauses.push("company LIKE ?");
                params.push(kw);
              } else if (filterCol === "etc") {
                whereClauses.push("etc LIKE ?");
                params.push(kw);
              } else if (filterCol === "date") {
                whereClauses.push("outbound_date LIKE ?");
                params.push(kw);
              } else {
                // 전체 검색: 부분(포함) 매칭으로 여러 컬럼 동시 검색
                whereClauses.push(
                  "(company LIKE ? OR etc LIKE ? OR outbound_date LIKE ? OR CAST(pal AS CHAR) LIKE ? OR CAST(box AS CHAR) LIKE ?)",
                );
                params.push(kw, kw, kw, kw, kw);
              }
            }
            if (whereClauses.length > 0) {
              const whereStr = " WHERE " + whereClauses.join(" AND ");
              queryStr += whereStr;
              countQueryStr += whereStr;
              countParams = [...params];
            }
            // 🚨 수정된 orderClause 적용
            queryStr += ` ORDER BY ${orderClause} ${sortDir} LIMIT ? OFFSET ?`;
            params.push(limit, offset);
          } else {
            queryStr =
              "SELECT id, bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, DATE_ADD(last_updated, INTERVAL 9 HOUR) AS last_updated, sort_idx, status, is_ai_modified FROM inbound";
            countQueryStr = "SELECT COUNT(*) as cnt FROM inbound";
            let whereClauses = [];
            if (keyword) {
              const kw = `%${keyword}%`;
              if (filterCol === "name") {
                whereClauses.push("bl_number LIKE ?");
                params.push(kw);
              } else if (filterCol === "invoice") {
                whereClauses.push("invoice LIKE ?");
                params.push(kw);
              } else if (filterCol === "fwd") {
                whereClauses.push("fwd LIKE ?");
                params.push(kw);
              } else if (filterCol === "remarks") {
                whereClauses.push("remarks LIKE ?");
                params.push(kw);
              } else if (filterCol === "date") {
                whereClauses.push("(receive_date LIKE ? OR eta LIKE ?)");
                params.push(kw, kw);
              } else {
                // 전체 검색: 부분(포함) 매칭으로 여러 컬럼 동시 검색
                whereClauses.push(
                  "(bl_number LIKE ? OR invoice LIKE ? OR fwd LIKE ? OR s_type LIKE ? OR remarks LIKE ? OR receive_date LIKE ? OR eta LIKE ? OR CAST(pallets AS CHAR) LIKE ?)",
                );
                params.push(kw, kw, kw, kw, kw, kw, kw, kw);
              }
            }
            if (whereClauses.length > 0) {
              const whereStr = " WHERE " + whereClauses.join(" AND ");
              queryStr += whereStr;
              countQueryStr += whereStr;
              countParams = [...params];
            }
            // 🚨 수정된 orderClause 적용
            queryStr += ` ORDER BY ${orderClause} ${sortDir} LIMIT ? OFFSET ?`;
            params.push(limit, offset);
          }

          [rows] = await pool.query(queryStr, params);
          [countRows] = await pool.query(countQueryStr, countParams);
          const totalCount = countRows[0].cnt;

          return res.status(200).json({
            success: true,
            rows: rows,
            totalCount: totalCount,
            page: page,
            totalPages: Math.ceil(totalCount / limit),
          });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🔍 일정 검색 (PC 사이드바): 전체 기간 부분(포함) 검색 → 날짜 점프용
      else if (action === "SEARCH_SCHEDULES") {
        try {
          const kwRaw = (payload.keyword || "").trim();
          const kw = `%${kwRaw}%`;
          const startDate = (payload.startDate || "").trim();
          const endDate = (payload.endDate || "").trim();
          let rows = [];
          if (type === "out") {
            // 출고: 업체명 검색 + 작업기간(선택)
            let where = [];
            let params = [];
            let ordSel = "";
            const selParams = [];
            // 약어(CRM 단축명)로 확장된 정식 업체명 목록(클라이언트 전달)
            const compList = Array.isArray(payload.companies) ? payload.companies.filter(Boolean).slice(0, 50) : [];
            if (kwRaw || compList.length) {
              let ors = [];
              if (kwRaw) {
                // 대소문자 무시 (oc → OC D-KIT 등)
                ors.push("LOWER(company) LIKE LOWER(?)", "LOWER(etc) LIKE LOWER(?)");
                params.push(kw, kw);
                // 출고지시번호로도 검색 (영문·숫자 4자 이상일 때만)
                const kwNo = kwRaw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
                if (kwNo.length >= 4) {
                  try {
                    await ordEnsureTable();
                    ors.push("id IN (SELECT outbound_id FROM outbound_orders WHERE order_no LIKE ?)");
                    params.push(`%${kwNo}%`);
                    ordSel = ", (SELECT GROUP_CONCAT(oo.order_no) FROM outbound_orders oo WHERE oo.outbound_id = outbound.id AND oo.order_no LIKE ?) AS ord_hit"; // 어떤 번호로 걸렸는지 결과에 표시
                    selParams.push(`%${kwNo}%`);
                  } catch (_oe) {}
                }
              }
              if (compList.length) {
                ors.push("LOWER(company) IN (" + compList.map(() => "LOWER(?)").join(",") + ")");
                params.push(...compList);
              }
              where.push("(" + ors.join(" OR ") + ")");
            }
            if (startDate) {
              where.push("outbound_date >= ?");
              params.push(startDate);
            }
            if (endDate) {
              where.push("outbound_date <= ?");
              params.push(endDate);
            }
            if (where.length === 0) return res.status(200).json({ success: true, rows: [] });
            // 미정/대기(outbound_date NULL)도 포함. 단, 작업기간(startDate/endDate)을 지정하면 그 조건상 자연 제외됨.
            const sql =
              "SELECT id, company, pal, box, DATE_FORMAT(outbound_date, '%Y-%m-%d') AS date, etc, isDone" + ordSel + " FROM outbound WHERE " +
              where.join(" AND ") +
              " ORDER BY outbound_date IS NULL, outbound_date DESC LIMIT 200";
            [rows] = await pool.query(sql, [...selParams, ...params]);
          } else {
            // 입고: B/L · 인보이스 부분 검색 (+ 운송타입/포워더/비고도 함께)
            if (!kwRaw) return res.status(200).json({ success: true, rows: [] });
            // 미정/대기(receive_date NULL)도 포함 — 인보이스만 있는 발행전 대기건도 검색되게
            const sql =
              "SELECT id, bl_number AS bl, invoice, pallets AS pal, DATE_FORMAT(receive_date, '%Y-%m-%d') AS date, " +
              "DATE_FORMAT(eta, '%Y-%m-%d') AS eta, fwd, s_type, status, remarks " +
              "FROM inbound WHERE (LOWER(bl_number) LIKE LOWER(?) OR LOWER(invoice) LIKE LOWER(?) OR LOWER(fwd) LIKE LOWER(?) OR LOWER(s_type) LIKE LOWER(?) OR LOWER(remarks) LIKE LOWER(?)) " +
              "ORDER BY receive_date IS NULL, receive_date DESC LIMIT 200";
            [rows] = await pool.query(sql, [kw, kw, kw, kw, kw]);
          }
          return res.status(200).json({ success: true, rows: rows });
        } catch (e) {
          console.error("SEARCH_SCHEDULES 오류:", e);
          return res.status(200).json({ success: false, msg: "검색 중 오류가 발생했습니다." });
        }
      }

      // 💣 F. DB 원본 데이터 다이렉트 긴급 삭제 명령
      else if (action === "DELETE_RAW_ROW_DIRECT") {
        try {
          if (type === "out") await pool.query("DELETE FROM outbound WHERE id = ?", [rowId]);
          else await pool.query("DELETE FROM inbound WHERE id = ?", [rowId]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_DELETE', ?)",
            [currentAdmin, `${type === "out" ? "출고" : "입고"} 테이블 일련번호 [ID: ${rowId}] 로우 강제 소거`],
          );
          notifyCalendarChange(`[DB직접 삭제] ${type === "out" ? "출고" : "입고"} ID:${rowId} 로우 삭제`, currentAdmin);
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // ✏️ G. DB 로우 풀데이터 (전체 컬럼) 업데이트 (안전장치 safeDate 적용)
      else if (action === "UPDATE_RAW_ROW_FULL") {
        try {
          const { rowId } = payload.updateData;
          if (type === "out") {
            const { company, pal, box, outbound_date, etc, created_at, sort_idx, isDone } = payload.updateData;
            await pool.query(
              "UPDATE outbound SET company=?, pal=?, box=?, outbound_date=?, etc=?, created_at=?, sort_idx=?, isDone=? WHERE id=?",
              [company, pal, box, safeDate(outbound_date), etc, safeDate(created_at), sort_idx, isDone, rowId],
            );
          } else {
            const {
              bl_number,
              pallets,
              eta,
              receive_date,
              fwd,
              s_type,
              invoice,
              remarks,
              last_updated,
              sort_idx,
              status,
              is_ai_modified,
            } = payload.updateData;
            await pool.query(
              "UPDATE inbound SET bl_number=?, pallets=?, eta=?, receive_date=?, fwd=?, s_type=?, invoice=?, remarks=?, last_updated=?, sort_idx=?, status=?, is_ai_modified=? WHERE id=?",
              [
                bl_number,
                pallets,
                safeDate(eta),
                safeDate(receive_date),
                fwd,
                s_type,
                invoice,
                remarks,
                safeDate(last_updated),
                sort_idx,
                status,
                is_ai_modified,
                rowId,
              ],
            );
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_UPDATE', ?)",
            [currentAdmin, `DB 제어실 전체 컬럼 인라인 수정 [ID:${rowId}]`],
          );
          notifyCalendarChange(`[DB직접 수정] ${type === "out" ? "출고" : "입고"} ID:${rowId} 전체 컬럼 수정`, currentAdmin);
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // 🆕 [신규 추가 기능] DB 제어실에서 원본 데이터 다이렉트 주입
      else if (action === "ADD_RAW_ROW_DIRECT") {
        try {
          if (type === "out") {
            const { company, pal, box, outbound_date, etc, sort_idx, isDone } = payload.insertData;
            await pool.query(
              "INSERT INTO outbound (company, pal, box, outbound_date, etc, sort_idx, isDone) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [company || "", pal || 0, box || 0, safeDate(outbound_date), etc || "", sort_idx || 999, isDone || 0],
            );
          } else {
            const {
              bl_number,
              pallets,
              eta,
              receive_date,
              fwd,
              s_type,
              invoice,
              remarks,
              sort_idx,
              status,
              is_ai_modified,
            } = payload.insertData;
            await pool.query(
              "INSERT INTO inbound (bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, sort_idx, status, is_ai_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                bl_number || "",
                pallets || 0,
                safeDate(eta),
                safeDate(receive_date),
                fwd || "",
                s_type || "",
                invoice || "",
                remarks || "",
                sort_idx || 999,
                status || "입고대기",
                is_ai_modified || 0,
              ],
            );
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_ADD', ?)",
            [currentAdmin, `[DB 제어실] ${type === "out" ? "출고" : "입고"} 신규 데이터 직접 주입`],
          );
          notifyCalendarChange(`[DB직접 등록] ${type === "out" ? "출고" : "입고"} 신규 데이터 직접 주입`, currentAdmin);
          return res.status(200).json({ success: true });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // ✅ 로그인 로직 (SYSTEM 권한 전용 마스터 패스 + 최근 로그인 일시 업데이트 완전 통합본)
      // ✅ 로그인 — bcrypt 적용
      else if (action === "LOGIN") {
        try {
          const { id, pw } = data;
          let ip =
            req.headers["x-forwarded-for"] ||
            req.socket?.remoteAddress ||
            req.connection?.remoteAddress ||
            "IP 알수없음";
          if (ip.includes(",")) ip = ip.split(",")[0].trim();
          const ua = req.headers["user-agent"] || "";
          let os = "PC";
          if (/android/i.test(ua)) os = "Android";
          else if (/ipad|iphone|ipod/i.test(ua)) os = "iOS";
          else if (/mac os/i.test(ua)) os = "Mac";
          else if (/windows/i.test(ua)) os = "Windows";
          let browser = "알수없음";
          if (/edg/i.test(ua)) browser = "Edge";
          else if (/chrome/i.test(ua)) browser = "Chrome";
          else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";
          else if (/firefox/i.test(ua)) browser = "Firefox";
          else if (/kakao/i.test(ua)) browser = "KakaoTalk";
          else if (/naver/i.test(ua)) browser = "NaverApp";
          const connInfoBase = `기기: ${os} | 브라우저: ${browser}`;

          const [failCountRows] = await pool.query(
            `SELECT COUNT(*) as cnt FROM admin_audit_logs WHERE ip_address = ? AND LOWER(admin_id) = LOWER(?) AND action_type = 'LOGIN_FAILED' AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
            [ip, id],
          );
          const failCount = failCountRows[0].cnt;
          // [보안 2단계] 5회 이상 연속 실패로 해당 ID-IP 조합이 잠긴 상태인 경우
          if (failCount >= 5) {
            const [masterCheck] = await pool.query(
              "SELECT admin_id, password_hash, admin_name, role, status FROM admins WHERE LOWER(admin_id) = LOWER(?)",
              [id],
            );
            // ✅ 마스터 검증 (bcrypt + SHA-256 호환)
            let masterMatch = false;
            if (masterCheck.length > 0) {
              const mHash = masterCheck[0].password_hash;
              if (mHash.startsWith("$2b$") || mHash.startsWith("$2a$")) {
                masterMatch = await bcrypt.compare(pw, mHash);
              } else {
                masterMatch = crypto.createHash("sha256").update(pw).digest("hex") === mHash;
              }
            }
            if (masterMatch && masterCheck[0].status === "ACTIVE" && masterCheck[0].role === "SYSTEM") {
              await pool.query("UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?", [masterCheck[0].admin_id]);
              const connInfo = `[👑 최고관리자 잠금 우회 성공] IP: ${ip} | ${connInfoBase}`;
              await pool.query(
                "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_SUCCESS', ?)",
                [ip, masterCheck[0].admin_id, connInfo],
              );
              const session_token = generateToken(masterCheck[0].admin_id);
              return res.status(200).json({
                success: true,
                admin_id: masterCheck[0].admin_id,
                name: masterCheck[0].admin_name,
                role: masterCheck[0].role,
                session_token,
                isSystem: true,
                perms: { ocr_compare: true, ocr_upload: true },
                msg: "비상 우회 통로로 안전하게 로그인되었습니다.",
              });
            }
            return res.status(200).json({
              success: false,
              msg: "⚠️ 비밀번호 5회 실패로 로그인이 임시 제한되었습니다. 10분 후 다시 시도하세요.",
            });
          }

          const [rows] = await pool.query(
            "SELECT admin_id, password_hash, admin_name, role, status FROM admins WHERE LOWER(admin_id) = LOWER(?)",
            [id],
          );
          if (rows.length === 0) {
            await pool.query(
              "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_FAILED', ?)",
              [ip, id, `[존재하지 않는 ID 로그인 시도] IP: ${ip} | ${connInfoBase}`],
            );
            return res.status(200).json({ success: false, msg: "아이디 또는 비밀번호가 틀립니다." });
          }
          const user = rows[0];
          if (user.status === "LOCKED") {
            return res.status(200).json({ success: false, msg: "비활성화된 계정입니다. 관리자에게 문의하세요." });
          }
          // ✅ bcrypt 검증 + SHA-256 구형 계정 자동 마이그레이션
          const isBcrypt = user.password_hash.startsWith("$2b$") || user.password_hash.startsWith("$2a$");
          let isMatch;
          if (isBcrypt) {
            isMatch = await bcrypt.compare(pw, user.password_hash);
          } else {
            // 구형 SHA-256 해시 비교 후 bcrypt로 자동 업그레이드
            const sha256 = crypto.createHash("sha256").update(pw).digest("hex");
            isMatch = sha256 === user.password_hash;
            if (isMatch) {
              const newHash = await bcrypt.hash(pw, 10);
              await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [newHash, user.admin_id]);
            }
          }
          if (isMatch) {
            await pool.query("UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?", [user.admin_id]);
            const connInfo = `[접속성공] IP: ${ip} | ${connInfoBase}`;
            await pool.query(
              "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_SUCCESS', ?)",
              [ip, user.admin_id, connInfo],
            );
            const session_token = generateToken(user.admin_id);
            const isOwner = !!(process.env.TELEGRAM_OWNER_ID &&
              user.admin_id.toLowerCase() === process.env.TELEGRAM_OWNER_ID.toLowerCase());
            const _lctx = await loadAdminCtx(user.admin_id, user.role);
            return res
              .status(200)
              .json({ success: true, admin_id: user.admin_id, name: user.admin_name, role: user.role, session_token, isOwner, isSystem: _lctx.isSystem, perms: _lctx.perms });
          } else {
            const connInfo = `[비밀번호 틀림] IP: ${ip} | ${connInfoBase}`;
            await pool.query(
              "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_FAILED', ?)",
              [ip, user.admin_id, connInfo],
            );
            return res.status(200).json({
              success: false,
              msg: `❌ 비밀번호가 일치하지 않습니다. (현재 10분 내 연속 실패: ${failCount + 1}회 / 5회 실패 시 10분간 자동 잠금)`,
            });
          }
        } catch (error) {
          console.error("🔥 로그인 내부 처리 오류:", error);
          return res.status(200).json({ success: false, msg: "로그인 처리 중 오류가 발생했습니다." });
        }
      }

      // 👤 H. [신규] 특정 관리자 접속(로그인) 이력 전용 조회 엔진
      else if (action === "GET_IP_INFO") {
        try {
          const { ip } = data || {};
          if (!ip || !/^[\d.a-f:]+$/i.test(ip)) return res.status(200).json({ success: false, reason: "잘못된 IP" });
          const r = await fetch(`https://ipinfo.io/${ip}/json`);
          if (!r.ok) return res.status(200).json({ success: false, reason: `HTTP ${r.status}` });
          const d = await r.json();
          if (d.bogon || d.error) return res.status(200).json({ success: false, reason: "사설/예약 IP" });
          return res.status(200).json({ success: true, info: d });
        } catch (e) {
          return res.status(200).json({ success: false, reason: "외부 API 오류" });
        }
      }

      else if (action === "GET_ADMIN_CONN_LOGS") {
        try {
          const { targetId } = data;
          // 최근 로그인 기록 15개를 시간 역순으로 로드
          const [rows] = await pool.query(
            "SELECT description, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE admin_id = ? AND action_type IN ('LOGIN', 'AUTO_LOGIN', 'LOGOUT') ORDER BY id DESC LIMIT 15",
            [targetId],
          );
          return res.status(200).json({ success: true, logs: rows });
        } catch (e) {
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      }

      // ✅ 2. 시스템 및 OCR 로직들 (원본 100% 유지)
      else if (action === "GET_LAST_OCR_IMAGE") {
        try {
          await pool.query(
            `CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`,
          );
          const [rows] = await pool.query(
            `SELECT store_value FROM ocr_store WHERE store_key = 'last_ocr_image'`,
          );
          let finalUrl = "";
          let fileId = null;

          if (rows.length > 0) {
            let val = rows[0].store_value;
            if (typeof val === "string") {
              try {
                val = JSON.parse(val);
              } catch (e) {}
            }

            if (typeof val === "object" && val !== null) {
              finalUrl = val.url || "";
              fileId = val.fileId || null;
            } else if (typeof val === "string") {
              finalUrl = val;
            }

            if (fileId) {
              try {
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                const gfCtrl = new AbortController();
                const gfTimer = setTimeout(() => gfCtrl.abort(), 8000);
                let fileData;
                try {
                  const fileRes = await fetch(
                    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`,
                    { signal: gfCtrl.signal },
                  );
                  fileData = await fileRes.json();
                } finally {
                  clearTimeout(gfTimer);
                }

                if (fileData.ok) {
                  finalUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                  if (typeof val === "object") {
                    val.url = finalUrl;
                    await pool.query(
                      `INSERT INTO ocr_store (store_key, store_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE store_value = ?`,
                      [JSON.stringify(val), JSON.stringify(val)],
                    );
                  }
                }
              } catch (apiErr) {
                console.error("🔥 텔레그램 새 이미지 주소 발급 실패:", apiErr);
              }
            }
          }
          return res.status(200).json({ url: finalUrl, success: true });
        } catch (e) {
          console.error("🔥 OCR 이미지 로딩 에러:", e);
          return res.status(200).json({ url: "", success: false });
        }
      } else if (action === "GET_OCR_LAST_TIME") {
        try {
          await pool.query(
            `CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`,
          );
          const [rows] = await pool.query(
            `SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_time'`,
          );
          let finalTime = "최근 처리내역 없음";
          if (rows.length > 0) {
            let val = rows[0].setting_value;
            if (typeof val === "string") {
              try {
                val = JSON.parse(val);
              } catch (e) {}
            }

            if (typeof val === "object" && val !== null) {
              finalTime = val.time || "최근 처리내역 없음";
            } else if (typeof val === "string") {
              finalTime = val;
            }
          }
          return res.status(200).json({ time: finalTime, success: true });
        } catch (e) {
          return res.status(200).json({ time: "최근 처리내역 없음", success: false });
        }
      } else if (action === "SAVE_OCR_INFO") {
        const urlVal = data?.url || "";
        const timeVal = data?.time || "";
        await pool.query(
          `CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`,
        );
        // telegram.js와 동일한 {url, fileId} JSON 포맷으로 저장 (plain URL 저장 시 /status 이미지 표시 안 됨)
        const imgJson = JSON.stringify({ url: urlVal, fileId: null });
        await pool.query(
          `INSERT INTO ocr_store (store_key, store_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE store_value = ?`,
          [imgJson, imgJson],
        );
        await pool.query(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [timeVal, timeVal],
        );

        await pool.query(
          "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'SYS_OCR_SAVE', ?)",
          [currentAdmin, `텔레그램 OCR 데이터 동기화`],
        );
        return res.status(200).json({ success: true });
      } else if (action === "GET_COMP_INFO_DB") {
        const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`);
        let db = rows.length > 0 ? parseJSON(rows[0].setting_value) : {};
        // 🔒 비로그인(토큰 무효)에겐 연락처(전화/주소/배송시간/특이사항) 제거.
        //    달력 렌더링에 필요한 약어·IC/OC/WC만 공개.
        const authed = payload.session_token && verifyToken(payload.session_token);
        if (!authed && db && typeof db === "object") {
          const safe = {};
          for (const k in db) {
            const v = db[k] || {};
            safe[k] = { shortName: v.shortName || "", ic: !!v.ic, oc: !!v.oc, wc: !!v.wc };
          }
          db = safe;
        }
        return res.status(200).json(db);
      } else if (action === "SAVE_COMP_INFO_DB") {
        // 변경 전 데이터 로드 → 추가/삭제/수정 감지
        const [oldRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`);
        let oldData = {};
        try { oldData = oldRows.length > 0 ? (typeof oldRows[0].setting_value === "object" ? oldRows[0].setting_value : JSON.parse(oldRows[0].setting_value)) : {}; } catch (_) {}
        const newData = data || {};
        const added   = Object.keys(newData).filter((k) => !oldData[k]);
        const removed = Object.keys(oldData).filter((k) => !newData[k]);
        const changed = Object.keys(newData).filter((k) => oldData[k] && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]));
        const parts = [];
        if (added.length)   parts.push(`추가: ${added.join(", ")}`);
        if (removed.length) parts.push(`삭제: ${removed.join(", ")}`);
        if (changed.length) parts.push(`수정: ${changed.join(", ")}`);
        // 업체 색상을 함께 바꿨으면 같은 알림 1건에 포함 (SAVE_GLOBAL_COLOR는 별도 알림 없음)
        if (payload.colorNote) parts.push(`색상 변경: ${String(payload.colorNote).replace(/\[TASK\]/gi, "").trim().slice(0, 50)}`);
        // 🔁 이름 변경이면 달력 일정·피킹지 연결도 새 이름으로 옮긴다 (화면이 '옛 이름 → 새 이름'을 명시해서 보낸 경우만, 업체정보가 실제로 그렇게 바뀐 때만)
        let renameRes = null;
        const rn = payload.rename && typeof payload.rename === "object" ? payload.rename : null;
        if (rn) {
          const rf = String(rn.from || "").trim(), rt = String(rn.to || "").trim();
          if (rf && rt && rf !== rt && oldData[rf] && newData[rt] && !newData[rf] && !/^\[TASK\]/i.test(rf)) {
            try { renameRes = await renameCompanyData(rf, rt); }
            catch (e) {
              console.error("[업체명 변경] 일정 이전 실패:", e.sqlMessage || e.message);
              return res.status(200).json({ success: false, msg: "일정의 업체명을 바꾸지 못해 업체정보도 저장하지 않았습니다. 잠시 뒤 다시 시도해주세요." });
            }
            if (renameRes.moved) parts.push(`일정 ${renameRes.moved}건 업체명 변경 (${rf} ➡️ ${rt})`);
          }
        }
        const compDesc = parts.length > 0 ? parts.join(" / ") : "변경사항 없음";
        const jsonStr = JSON.stringify(newData);
        await pool.query(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [jsonStr, jsonStr],
        );
        await pool.query(
          "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'SYS_COMP', ?)",
          [currentAdmin, `[업체정보 변경] ${compDesc}`],
        );
        if (parts.length > 0) notifyCalendarChange(`[업체정보 변경] ${compDesc}`, currentAdmin);
        return res.status(200).json(Object.assign({ success: true }, renameRes ? { moved: renameRes.moved, aliasMoved: renameRes.aliasMoved } : {}));
      } else if (action === "LIST_ORPHAN_COMPANIES") {
        // 업체정보에 없는 이름으로 남은 일정 목록(이름만 바뀐 옛 일정 정리용, 읽기 전용)
        try { return res.status(200).json({ success: true, orphans: await listOrphanCompanies(), ignored: await orphanIgnoreLoad() }); }
        catch (e) { console.error("[업체명] 목록 실패:", e.sqlMessage || e.message); return res.status(200).json({ success: false, msg: "목록을 불러오지 못했습니다." }); }
      } else if (action === "SET_ORPHAN_IGNORE") {
        // 업체정보에 등록하지 않고 그냥 두기로 한 이름 표시/해제 (일시적 일정 등) — 일정은 건드리지 않고 이름만 기억
        const ig = String(data?.name || "").trim();
        if (!ig || /^\[TASK\]/i.test(ig)) return res.status(200).json({ success: false, msg: "이름이 올바르지 않습니다." });
        try {
          const cur = await orphanIgnoreLoad();
          const next = data?.ignore === false ? cur.filter((x) => x !== ig) : (cur.includes(ig) ? cur : cur.concat(ig));
          if (next.length > 500) return res.status(200).json({ success: false, msg: "그냥 두기 목록이 너무 많습니다." });
          const js = JSON.stringify(next);
          await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_ORPHAN_IGNORE', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [js, js]);
          return res.status(200).json({ success: true, ignored: next });
        } catch (e) { console.error("[업체명] 그냥 두기 저장 실패:", e.sqlMessage || e.message); return res.status(200).json({ success: false, msg: "저장하지 못했습니다. 잠시 뒤 다시 시도해주세요." }); }
      } else if (action === "MOVE_COMPANY_ROWS") {
        // 이미 이름이 바뀌어 옛 이름으로 남은 일정을 지금 업체명으로 옮김 — 옮길 곳은 업체정보에 있는 이름, 옮길 옛 이름은 업체정보에 없는 이름만
        const mf = String(data?.from || "").trim(), mt = String(data?.to || "").trim();
        if (!mf || !mt || mf === mt || /^\[TASK\]/i.test(mf)) return res.status(200).json({ success: false, msg: "옮길 이름이 올바르지 않습니다." });
        const cdb = await pickLoadCompDb();
        if (!cdb[mt]) return res.status(200).json({ success: false, msg: "옮길 업체가 업체정보에 없습니다." });
        if (cdb[mf]) return res.status(200).json({ success: false, msg: "옛 이름이 아니라 현재 등록된 업체입니다." });
        try {
          const rr = await renameCompanyData(mf, mt);
          await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'SYS_COMP', ?)", [currentAdmin, `[업체명 정리] 일정 ${rr.moved}건 ${mf} ➡️ ${mt}`]);
          if (rr.moved) notifyCalendarChange(`[업체명 정리] 일정 ${rr.moved}건: ${mf} ➡️ ${mt}`, currentAdmin);
          return res.status(200).json({ success: true, moved: rr.moved, aliasMoved: rr.aliasMoved });
        } catch (e) {
          console.error("[업체명] 일정 옮기기 실패:", e.sqlMessage || e.message);
          return res.status(200).json({ success: false, msg: "일정을 옮기지 못했습니다. 잠시 뒤 다시 시도해주세요." });
        }
      } else if (action === "GET_CAL_NOTIFY") {
        const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'CALENDAR_NOTIFY'`);
        const enabled = rows.length === 0 || rows[0].setting_value !== "OFF";
        const isOwner = !!(process.env.TELEGRAM_OWNER_ID &&
          currentAdmin.toLowerCase() === process.env.TELEGRAM_OWNER_ID.toLowerCase());
        return res.status(200).json({ success: true, enabled, isOwner });
      } else if (action === "SET_CAL_NOTIFY") {
        // 오너만 변경 가능 — currentAdmin vs TELEGRAM_OWNER_ID 서버 검증
        const _ownerId = process.env.TELEGRAM_OWNER_ID || "";
        if (!_ownerId || currentAdmin.toLowerCase() !== _ownerId.toLowerCase())
          return res.status(200).json({ success: false, msg: "권한이 없습니다." });
        const val = data?.enabled === false ? "OFF" : "ON";
        await pool.query(`INSERT INTO system_settings (setting_key,setting_value) VALUES ('CALENDAR_NOTIFY',?) ON DUPLICATE KEY UPDATE setting_value=?`, [val, val]);
        return res.status(200).json({ success: true });
      } else if (action === "GET_OCR_FILTERS") {
        const [rows] = await pool.query(
          `SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_ETC_FILTERS'`,
        );
        return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : []);
      } else if (action === "SAVE_OCR_FILTERS") {
        const jsonStr = JSON.stringify(data);
        await pool.query(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_ETC_FILTERS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [jsonStr, jsonStr],
        );
        return res.status(200).json({ success: true });
      } else if (action === "GET_GLOBAL_COLORS") {
        const [rows] = await pool.query(
          `SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`,
        );
        return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {});
      } else if (action === "SAVE_GLOBAL_COLOR") {
        const compName = data?.compName || payload.compName;
        const colorIdx = data?.colorIdx ?? payload.colorIdx;
        const deleteNames = data?.deleteNames || payload.deleteNames; // 삭제할 키 배열
        const [rows] = await pool.query(
          `SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`,
        );
        let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {};
        if (compName) colors[compName] = colorIdx;
        if (Array.isArray(deleteNames)) deleteNames.forEach((n) => { delete colors[n]; });
        if (data?.saveAll && typeof data.saveAll === "object") Object.assign(colors, data.saveAll);
        const jsonStr = JSON.stringify(colors);
        await pool.query(
          `INSERT INTO system_settings (setting_key, setting_value) VALUES ('GLOBAL_COMPANY_COLORS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [jsonStr, jsonStr],
        );
        // 색상 저장은 알림 없음 (일정/업체정보 저장과 함께 호출돼 알림이 중복되므로)
        return res.status(200).json({ success: true });
      } else if (action === "GET_YEARLY_HOLIDAYS") {
        const y = year || new Date().getFullYear();
        const apiKey = process.env.HOLIDAY_API_KEY;
        if (apiKey) {
          try {
            const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${y}&ServiceKey=${apiKey}&_type=json&numOfRows=100`;
            const response = await fetch(url);
            const json = await response.json();
            if (json?.response?.body?.items?.item) {
              const items = Array.isArray(json.response.body.items.item)
                ? json.response.body.items.item
                : [json.response.body.items.item];
              return res.status(200).json(
                items.map((h) => {
                  const d = String(h.locdate);
                  let holidayName = h.dateName || "";
                  if (holidayName.includes("대체공휴일")) holidayName = holidayName.replace("대체공휴일", "대체");
                  return { date: `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`, name: holidayName };
                }),
              );
            }
          } catch (e) {
            console.error("🔥 공휴일 API 에러:", e);
          }
        }
        const baseHolidays = [
          { date: `${y}-01-01`, name: "신정" },
          { date: `${y}-03-01`, name: "삼일절" },
          { date: `${y}-05-05`, name: "어린이날" },
          { date: `${y}-06-06`, name: "현충일" },
          { date: `${y}-08-15`, name: "광복절" },
          { date: `${y}-10-03`, name: "개천절" },
          { date: `${y}-10-09`, name: "한글날" },
          { date: `${y}-12-25`, name: "성탄절" },
        ];
        return res.status(200).json(baseHolidays);
      }

      // ✅ 3. 입/출고 데이터 처리 (원본 로직 완벽 보존 + 구체적 수치 로그)

      // 🗂️ 날짜 범위 배열 생성 헬퍼
      function _dateRange(start, end) {
        const dates = [];
        if (!start || start === "미정") return dates;
        let cur = new Date(start);
        const last = new Date(end || start);
        let guard = 0;
        while (cur <= last && guard++ < 400) {
          dates.push(cur.toISOString().slice(0, 10));
          cur.setDate(cur.getDate() + 1);
        }
        return dates;
      }
      // 날짜 범위 라벨 (같은 날이면 단일 날짜, 아니면 M/D~M/D)
      function _blockLabel(start, end) {
        const s = (start || "미정").slice(5).replace("-", "/");
        if (!end || end === start || end === "null") return s;
        return `${s}~${end.slice(5).replace("-", "/")}`;
      }

      // 🗑️ 다중 날 TASK 일괄 삭제 — 수량 달라도 회사명 기준으로 전체 삭제
      if (action === "DELETE_BLOCK" && domain === "out") {
        const delComp  = data?.oldComp || "";
        const delStart = data?.blockStart;
        const delEnd   = data?.blockEnd;
        if (!delComp || !delStart)
          return res.status(200).json({ success: false, msg: "잘못된 블록 범위" });
        // 날짜 범위 내 해당 회사명 모든 행 삭제 (pal/box 무관)
        await pool.query(
          `DELETE FROM outbound WHERE company = ? AND outbound_date BETWEEN ? AND ?`,
          [delComp, delStart, delEnd || delStart],
        );
        const cleanComp = delComp.replace(/\[TASK\]/gi, "").trim();
        const label = _blockLabel(delStart, delEnd);
        const desc  = `[출고 삭제] ${cleanComp} (${label}) 전체 파기`;
        await pool.query("INSERT INTO admin_audit_logs (admin_id,action_type,description) VALUES (?,'CAL_DELETE',?)", [currentAdmin, desc]);
        notifyCalendarChange(desc, currentAdmin);
        return res.status(200).json({ success: true });
      }

      // 📦 다중 날 TASK 일괄 등록
      if (action === "ADD_BLOCK" && domain === "out") {
        const reqComp   = data?.newComp || "";
        const reqPalOut = data?.newPal  || "";
        const reqBoxOut = data?.newBox  || "";
        const reqEtcOut = data?.newEtc  || "";
        const bStart    = data?.blockStart;
        const bEnd      = data?.blockEnd;
        const dates     = _dateRange(bStart, bEnd);
        if (!reqComp || dates.length === 0)
          return res.status(200).json({ success: false, msg: "잘못된 블록 범위" });
        // 기간 안에 같은 업체의 '완료되지 않은' 일정이 이미 있는 날이 있으면 덮어쓰지 않고 중단 (onDup:"new" 면 기존은 그대로 두고 별도 일정으로 추가)
        const _dupDates = [];
        const _cdbBlk = await pickLoadCompDb();
        for (const d of dates) {
          const [exAll] = await pool.query(`SELECT id, company, isDone FROM outbound WHERE outbound_date=?`, [d]);
          const ex = exAll.filter((r) => String(r.company || "").trim() === String(reqComp).trim() || pickSameCompanyT(r.company, reqComp, _cdbBlk));
          if (ex.some((r) => !(r.isDone === 1 || r.isDone === true))) _dupDates.push(d);
        }
        if (_dupDates.length > 0 && data?.onDup !== "new") {
          return res.status(200).json({ success: false, dup: true, dates: _dupDates.slice(0, 31), msg: `선택한 기간 중 같은 업체 일정이 이미 있는 날(${_dupDates.slice(0, 3).map((x) => x.slice(5).replace("-", "/")).join(", ")}${_dupDates.length > 3 ? " 외" : ""})이 있어 추가하지 않았습니다.` });
        }
        for (const d of dates) {
          await pool.query(
            `INSERT INTO outbound (company,pal,box,outbound_date,isDone,etc) VALUES (?,?,?,?,0,?)`,
            [reqComp, reqPalOut, reqBoxOut, d, reqEtcOut],
          );
        }
        const label = _blockLabel(bStart, bEnd);
        const cleanComp = reqComp.replace(/\[TASK\]/gi, "").trim();
        const desc = `[출고 등록] ${cleanComp} (${label}) ${dates.length}일 신규 추가 (PL:${reqPalOut||0}, BOX:${reqBoxOut||0})`;
        await pool.query("INSERT INTO admin_audit_logs (admin_id,action_type,description) VALUES (?,'CAL_ADD',?)", [currentAdmin, desc]);
        notifyCalendarChange(desc, currentAdmin);
        return res.status(200).json({ success: true });
      }

      // 📝 다중 날 TASK 일괄 수정 (날짜이동 포함)
      if (action === "EDIT_BLOCK" && domain === "out") {
        const reqComp   = data?.newComp || data?.oldComp || "";
        // newPal/newBox가 ""(빈값)이어도 oldPal/oldBox로 fallback 되지 않도록 명시적 체크
        const reqPalOut = (data?.newPal !== undefined && data?.newPal !== null) ? data.newPal : (data?.oldPal || "");
        const reqBoxOut = (data?.newBox !== undefined && data?.newBox !== null) ? data.newBox : (data?.oldBox || "");
        const reqEtcOut = data?.newEtc  || "";
        const oldStart  = data?.oldBlockStart;
        const oldEnd    = data?.oldBlockEnd   || oldStart;
        const newStart  = data?.newBlockStart || oldStart;
        const newEnd    = data?.newBlockEnd   || newStart;
        const oldDates  = _dateRange(oldStart, oldEnd);
        const newDates  = _dateRange(newStart, newEnd);
        const newSet    = new Set(newDates);
        const oldSet    = new Set(oldDates);
        // 삭제: 이전엔 있었지만 새로운 범위에 없는 날짜
        // data.id는 클릭한 단일 행 id라 블록 전체에 쓰면 안 됨 → company+date 기준으로만
        for (const d of oldDates) {
          if (!newSet.has(d))
            await pool.query(
              `DELETE FROM outbound WHERE company=? AND outbound_date=?`,
              [data?.oldComp || reqComp, d],
            );
        }
        // 변경 여부 감지: 변경되지 않은 필드는 각 날짜의 기존 값 유지
        const _palChanged = (reqPalOut||"0") !== (data?.oldPal||"0");
        const _boxChanged = (reqBoxOut||"0") !== (data?.oldBox||"0");
        // 블록 확장 시 새로 추가되는 날짜에 비고를 이어붙일지 판단하는 용도(기존 로직 유지)
        const _newEtcClean = (reqEtcOut||"").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
        const _oldEtcClean = (data?.oldEtc||"").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
        const _etcChangedForNewDates = _newEtcClean !== _oldEtcClean;

        // 수정: 양쪽에 있는 날짜 — pal/box는 변경된 경우만, etc는 항상 반영
        // 🚨 [버그 수정] oldEtc는 클라이언트에서 이미 수량추가 이력(hist)이 제거된 값으로 전달되므로,
        // clean 비교로 "변경 없음"을 판단하면 hist 항목만 삭제/변경된 경우를 놓쳐 etc 업데이트가 누락됨
        // (삭제된 수량추가 줄이 DB에 남아 새로고침 시 되살아나는 원인이었음)
        for (const d of newDates) {
          if (oldSet.has(d)) {
            const setClauses = ["company=?","outbound_date=?","etc=?"];
            const setVals    = [reqComp, d, reqEtcOut];
            if (_palChanged) { setClauses.push("pal=?");   setVals.push(reqPalOut); }
            if (_boxChanged) { setClauses.push("box=?");   setVals.push(reqBoxOut); }
            await pool.query(
              `UPDATE outbound SET ${setClauses.join(",")} WHERE company=? AND outbound_date=?`,
              [...setVals, data?.oldComp||reqComp, d],
            );
          }
        }
        // 추가: 새로운 범위에만 있는 날짜
        // 수량·비고 변경 시에만 해당 값 적용, 미변경 시 기본값(0/빈값)
        for (const d of newDates) {
          if (!oldSet.has(d))
            await pool.query(
              `INSERT INTO outbound (company,pal,box,outbound_date,isDone,etc) VALUES (?,?,?,?,0,?)`,
              //[reqComp, _palChanged ? reqPalOut : "0", _boxChanged ? reqBoxOut : "0", d, _etcChangedForNewDates ? reqEtcOut : ""],
              // 수정 후
              [reqComp, reqPalOut, reqBoxOut, d, reqEtcOut],
            );
        }
        const cleanComp = reqComp.replace(/\[TASK\]/gi, "").trim();
        const oldLabel  = _blockLabel(oldStart, oldEnd);
        const newLabel  = _blockLabel(newStart, newEnd);
        const rangeStr  = oldLabel === newLabel ? oldLabel : `${oldLabel}→${newLabel}`;
        // 변경 내용 상세: 유형·업체명·수량·비고 변경 시 표시
        const changeDetails = [];
        // 유형(출고↔작업) 변경
        const _wasTask = (data?.oldComp||"").toUpperCase().startsWith("[TASK]");
        const _isTask  = (reqComp||"").toUpperCase().startsWith("[TASK]");
        if (_wasTask !== _isTask) changeDetails.push(`유형: ${_wasTask?"작업":"출고"} ➡️ ${_isTask?"작업":"출고"}`);
        // 업체명 변경 ([TASK] 제외 순수 이름)
        const _oldName = (data?.oldComp||"").replace(/\[TASK\]/gi,"").trim();
        const _newName = cleanComp;
        if (_oldName !== _newName) changeDetails.push(`업체: ${_oldName} ➡️ ${_newName}`);
        if ((data?.oldPal||"0") !== (reqPalOut||"0")) changeDetails.push(`PL:${data?.oldPal||0}→${reqPalOut||0}`);
        if ((data?.oldBox||"0") !== (reqBoxOut||"0")) changeDetails.push(`BOX:${data?.oldBox||0}→${reqBoxOut||0}`);
        const oldEtcClean = (data?.oldEtc||"").replace(/\[.*?\]/g,"").trim();
        const newEtcClean = (reqEtcOut||"").replace(/\[.*?\]/g,"").trim();
        if (oldEtcClean !== newEtcClean) changeDetails.push(`비고: "${oldEtcClean||"없음"}"→"${newEtcClean||"없음"}"`);
        if (data?.colorNote) changeDetails.push(`색상 변경`);
        const changeStr = changeDetails.length > 0 ? ` (${changeDetails.join(", ")})` : "";
        const desc = `[출고 수정] ${cleanComp} (${rangeStr})${changeStr}`;
        await pool.query("INSERT INTO admin_audit_logs (admin_id,action_type,description) VALUES (?,'CAL_EDIT',?)", [currentAdmin, desc]);
        if (changeDetails.length > 0 || oldLabel !== newLabel) notifyCalendarChange(desc, currentAdmin); // 날짜범위 이동은 포함. 색상만 바꾼 저장 등 실제 변경 없으면 알림 생략
        return res.status(200).json({ success: true });
      }

      else if (domain === "out") {
        const targetName = data?.oldComp;
        const newName = data?.newComp || targetName;
        const targetDate = data?.oldDate === "미정" ? null : data?.oldDate;
        const newDate = data?.newDate === "미정" ? null : data?.newDate;
        const targetPal = data?.oldPal || "";
        const targetBox = data?.oldBox || "";

        if (action === "DONE" || action === "UNDO_DONE") {
          const statName = action === "DONE" ? "✅ 완료" : "⏳ 대기(취소)";
          if (data?.id) {
            await pool.query(`UPDATE outbound SET isDone = ? WHERE id = ?`, [action === "DONE" ? 1 : 0, data.id]);
          } else {
            await pool.query(
              `UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND COALESCE(NULLIF(pal,''),'0')=COALESCE(NULLIF(?,''),'0') AND COALESCE(NULLIF(box,''),'0')=COALESCE(NULLIF(?,''),'0')`,
              [action === "DONE" ? 1 : 0, targetName, targetDate, targetPal, targetBox],
            );
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)",
            [currentAdmin, `[출고 상태] ${targetName} (${targetDate || "미정"}) ➡️ ${statName} (PL:${targetPal || 0}, BOX:${targetBox || 0})`],
          );
          notifyCalendarChange(`[출고 상태] ${targetName} (${targetDate || "미정"}) ➡️ ${statName}`, currentAdmin);
        } else if (action === "DELETE") {
          if (data?.id) {
            await pool.query(`DELETE FROM outbound WHERE id = ?`, [data.id]);
            try { await pool.query(`DELETE FROM outbound_orders WHERE outbound_id = ?`, [data.id]); } catch (_) {} // 지운 일정의 출고지시번호 기록 정리(없어도 무방)
          } else {
            await pool.query(
              `DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND COALESCE(NULLIF(pal,''),'0')=COALESCE(NULLIF(?,''),'0') AND COALESCE(NULLIF(box,''),'0')=COALESCE(NULLIF(?,''),'0')`,
              [targetName, targetDate, targetPal, targetBox],
            );
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)",
            [currentAdmin, `[출고 삭제] ${targetName} (${targetDate || "미정"}, PL:${targetPal || 0}, BOX:${targetBox || 0}) 파기`],
          );
          notifyCalendarChange(`[출고 삭제] ${targetName} (${targetDate || "미정"}) 파기`, currentAdmin);
        } else if (action === "EDIT") {
          if (data?.id) {
            // 🛡️ 동시 수정 보호: 사용자가 바꾸지 않은 수량(PLT/박스)은 화면이 열려 있는 동안 다른 곳(피킹지 추가·다른 기기)에서
            //    바뀐 DB 값을 그대로 둔다. (이전엔 오래된 화면 값으로 통째로 덮어써 합산분이 사라질 수 있었음)
            //    "바꾸지 않음" = 새 값이 화면이 알고 있던 옛 값(oldPal/oldBox)과 같음. 옛 값을 모르면 예전처럼 그대로 저장.
            const _nq = (v) => (String(v ?? "").trim() === "" ? "0" : String(v).trim());
            const keepPal = data?.oldPal !== undefined && _nq(data?.newPal) === _nq(data?.oldPal);
            const keepBox = data?.oldBox !== undefined && _nq(data?.newBox) === _nq(data?.oldBox);
            await pool.query(
              `UPDATE outbound SET outbound_date = ?, company = ?, pal = CASE WHEN ? THEN pal ELSE ? END, box = CASE WHEN ? THEN box ELSE ? END, etc = ? WHERE id = ?`,
              [newDate, newName, keepPal ? 1 : 0, data?.newPal ?? "", keepBox ? 1 : 0, data?.newBox ?? "", data?.newEtc ?? "", data.id],
            );
            // 배송 구분(용차/용마택배/CJ택배) — 수정창에서 보낸 경우에만 바꿈(보내지 않은 이동·정렬 등은 그대로 둠)
            if (data?.newShip !== undefined && (await shipColReady())) {
              try { await pool.query(`UPDATE outbound SET ship_type = ? WHERE id = ?`, [shipNorm(data.newShip), data.id]); }
              catch (_se) { console.error("EDIT 배송구분 저장 실패(무시):", _se.sqlMessage || _se.message); }
            }
            // 출고지시번호(원래 일정 / N차 수량추가별) — 수정창에서 바꾼 경우에만 전달됨
            if (data?.orderSlots && typeof data.orderSlots === "object") {
              try {
                if (await ordSetSlots(parseInt(data.id, 10), data.orderSlots))
                  await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `[출고지시번호 수정] ${targetName} (${targetDate || "미정"}) 일정 ID:${data.id}`]);
              } catch (_oe) { console.error("EDIT 지시번호 저장 실패(무시):", _oe.sqlMessage || _oe.message); }
            }
          } else {
            await pool.query(
              `UPDATE outbound SET outbound_date = ?, company = ?, pal = ?, box = ?, etc = ? WHERE company = ? AND outbound_date <=> ? AND COALESCE(NULLIF(pal,''),'0')=COALESCE(NULLIF(?,''),'0') AND COALESCE(NULLIF(box,''),'0')=COALESCE(NULLIF(?,''),'0')`,
              [newDate, newName, data?.newPal ?? "", data?.newBox ?? "", data?.newEtc ?? "",
               targetName, targetDate, targetPal, targetBox],
            );
          }

          // 🚨 [스마트 로그 패치] 실제로 변경된 항목만 추출해서 로그 기록
          let changes = [];
          const oldD = targetDate || "미정";
          const newD = newDate || "미정";
          if (oldD !== newD) changes.push(`날짜: ${oldD} ➡️ ${newD}`);
          // 유형(출고↔작업) 변경 추적 — [TASK] 접두어 기준
          const _wasTask = (targetName || "").toUpperCase().startsWith("[TASK]");
          const _isTask  = (newName || "").toUpperCase().startsWith("[TASK]");
          if (_wasTask !== _isTask) changes.push(`유형: ${_wasTask ? "작업" : "출고"} ➡️ ${_isTask ? "작업" : "출고"}`);
          // 업체명 변경 (유형 관계없이 실제 이름이 다를 때만)
          const _oldCleanName = (targetName || "").replace(/\[TASK\]/gi, "").trim();
          const _newCleanName = (newName || "").replace(/\[TASK\]/gi, "").trim();
          if (_oldCleanName !== _newCleanName) changes.push(`업체: ${_oldCleanName} ➡️ ${_newCleanName}`);

          const oldP = targetPal || 0;
          const newP = data?.newPal || 0;
          if (String(oldP) !== String(newP)) changes.push(`PL: ${oldP} ➡️ ${newP}`);

          const oldB = targetBox || 0;
          const newB = data?.newBox || 0;
          if (String(oldB) !== String(newB)) changes.push(`BOX: ${oldB} ➡️ ${newB}`);

          // 비고(etc) 변경 추적 — old 값 전송된 경우에만 비교 (executeMove 오탐 방지)
          if (data?.oldEtc !== undefined) {
            const _oldEtc = String(data.oldEtc || "").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
            const _newEtc = String(data?.newEtc || "").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
            if (_oldEtc !== _newEtc) changes.push(`비고: "${_oldEtc||"없음"}"→"${_newEtc||"없음"}"`);
          }

          if (data?.colorNote) changes.push(`색상 변경`);
          const detailStr = changes.length > 0 ? changes.join(", ") : "변경사항 없음";
          const logDesc = `[출고 수정] ${targetName} (${targetDate || "미정"}) ${detailStr}`;
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)",
            [currentAdmin, logDesc],
          );
          if (changes.length > 0) notifyCalendarChange(logDesc, currentAdmin); // 실제 변경 없는 저장은 알림 생략(감사로그엔 기록)
        } else if (action === "ADD_QTY") {
          // 👈 🚨 여기에 이 블록을 통째로 추가하세요!
          // [출고 수량추가] 버튼 클릭 시 DB 원본에 합산 및 비고(etc) 업데이트
          const addPal = parseInt(data?.addPal) || 0;
          const addBox = parseInt(data?.addBox) || 0;

          // 프론트엔드와 100% 동일한 히스토리 글씨 생성 (예: [5/17 1P 10B 추가])
          const _now = new Date();
          const histDate = `${_now.getMonth() + 1}/${_now.getDate()}`;
          const addPalStr = data?.addPal ? data.addPal + "P" : "";
          const addBoxStr = data?.addBox ? data.addBox + "B" : "";
          const spaceStr = data?.addPal && data?.addBox ? " " : "";
          const histStr = `[${histDate} ${addPalStr}${spaceStr}${addBoxStr} 추가]`;

          // 🚨 [안전장치] ID가 있으면 고유 ID로, 없으면 이름/날짜/수량으로 해당 일정을 정확히 찾아옵니다.
          let queryStr = "";
          let params = [];
          if (data?.id) {
            queryStr = `SELECT id, company, pal, box, etc FROM outbound WHERE id = ? LIMIT 1`;
            params = [data.id];
          } else {
            queryStr = `SELECT id, company, pal, box, etc FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ? LIMIT 1`;
            params = [targetName, targetDate, targetPal, targetBox];
          }

          const [rows] = await pool.query(queryStr, params);

          if (rows.length > 0) {
            let row = rows[0];
            // 읽어 온 값에 더해 덮어쓰면 동시에 들어온 다른 추가분이 사라지므로, DB 에서 한 번에 합산한다 (완료 처리된 일정에는 적용 안 됨)
            const _ap = await appendQtyAtomic(row.id, String(row.company || "").trim(), addPal, addBox, "");
            if (!_ap.ok) return res.status(200).json({ success: false, msg: "그 사이 일정이 완료·삭제되어 추가하지 못했습니다. 새로고침 후 다시 시도해주세요." });
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)",
              [currentAdmin, `[출고 수량추가] ${targetName} (${targetDate || "미정"}) +PL:${addPal}, +BOX:${addBox}`],
            );
            notifyCalendarChange(`[출고 수량추가] ${targetName} (${targetDate || "미정"}) +PL:${addPal}, +BOX:${addBox}`, currentAdmin);
            try { const _ol = ordNormList(data?.orderNos); if (_ol.length) await ordAdd(row.id, _ol, "append", await ordAppendSlot(row.id)); } catch (_oe) { console.error("ADD_QTY 지시번호 저장 실패(무시):", _oe.sqlMessage || _oe.message); }
          }
        } else if (action === "ADD") {
          let reqComp = (data?.newComp || data?.company || data?.comp || "").trim();
          let reqDateOut =
            data?.newDate !== undefined ? data?.newDate : data?.date !== undefined ? data?.date : data?.outbound_date;
          if (reqDateOut === "미정" || reqDateOut === "" || !reqDateOut) reqDateOut = null;
          else if (typeof reqDateOut === "string" && reqDateOut.length > 10) reqDateOut = reqDateOut.substring(0, 10);

          let reqPalOut = data?.newPal || data?.pal || "0";
          let reqBoxOut = data?.newBox || data?.box || "0";
          let reqEtcOut = data?.newEtc || data?.etc || "";

          // 같은 날 같은 업체의 '완료되지 않은' 일정이 이미 있으면 절대 덮어쓰지 않는다.
          //   onDup 없음  → 아무것도 쓰지 않고 dup 응답 (화면이 "더하기/따로 추가/취소" 를 묻는다)
          //   "append"    → dupTargetId 일정에 수량 더하기 ([+수량추가] 와 동일)
          //   "new"       → 기존 일정은 그대로 두고 별도 일정으로 추가
          // 업체명은 정식명/CRM 약어/옛 약어 어느 표기든 같은 업체로 본다 (같은 날 그 날짜 일정만 조회 후 비교)
          const [_dayRows] = await pool.query(`SELECT id, company, pal, box, etc, isDone FROM outbound WHERE outbound_date <=> ?`, [reqDateOut]);
          const _cdbAdd = await pickLoadCompDb();
          const exist = _dayRows.filter((r) => String(r.company || "").trim() === reqComp || pickSameCompanyT(r.company, reqComp, _cdbAdd));
          const live = exist.filter((r) => !(r.isDone === 1 || r.isDone === true));
          const onDup = data?.onDup === "append" || data?.onDup === "new" ? data.onDup : null;
          if (live.length > 0 && !onDup) {
            return res.status(200).json({
              success: false,
              dup: true,
              existing: live.map((r) => ({ id: r.id, pal: r.pal, box: r.box, etc: String(r.etc || "").slice(0, 120) })),
              msg: `같은 날 같은 업체(${reqComp.replace(/\[TASK\]/gi, "").trim()}) 일정이 이미 있어 추가하지 않았습니다.`,
            });
          }
          if (live.length > 0 && onDup === "append") {
            const tid = parseInt(data?.dupTargetId, 10);
            const tgt = live.find((r) => r.id === tid);
            const addP = parseInt(reqPalOut, 10) || 0;
            const addB = parseInt(reqBoxOut, 10) || 0;
            if (!tgt) return res.status(200).json({ success: false, msg: "수량을 더할 기존 일정을 찾지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요." });
            if (addP === 0 && addB === 0) return res.status(200).json({ success: false, msg: "더할 파레트/박스 수량이 0 입니다." });
            const ap = await appendQtyAtomic(tgt.id, String(tgt.company || "").trim() || reqComp, addP, addB, String(reqEtcOut || "").trim()); // 기존 행에 적힌 이름(약어일 수 있음)으로 비교해야 함
            if (!ap.ok) return res.status(200).json({ success: false, msg: "그 사이 일정이 완료·삭제되어 추가하지 못했습니다. 새로고침 후 다시 시도해주세요." });
            const dd = `[출고 수량추가] ${reqComp} (${reqDateOut || "미정"}) +PL:${addP}, +BOX:${addB}`;
            await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, dd]);
            notifyCalendarChange(dd, currentAdmin);
            try { const _ol = ordNormList(data?.orderNos); if (_ol.length) await ordAdd(tgt.id, _ol, "append", await ordAppendSlot(tgt.id)); } catch (_oe) { console.error("ADD 지시번호 저장 실패(무시):", _oe.sqlMessage || _oe.message); }
          } else {
            const _shipAdd = shipNorm(data?.shipType);
            const [_insR] = _shipAdd && (await shipColReady())
              ? await pool.query(
                  `INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc, ship_type) VALUES (?, ?, ?, ?, 0, ?, ?)`,
                  [reqComp, reqPalOut, reqBoxOut, reqDateOut, reqEtcOut, _shipAdd],
                )
              : await pool.query(
                  `INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`,
                  [reqComp, reqPalOut, reqBoxOut, reqDateOut, reqEtcOut],
                );
            try { const _ol = ordNormList(data?.orderNos); if (_ol.length && _insR && _insR.insertId) await ordAdd(_insR.insertId, _ol, "manual", 0); } catch (_oe) { console.error("ADD 지시번호 저장 실패(무시):", _oe.sqlMessage || _oe.message); }
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)",
              [currentAdmin, `[출고 등록] ${reqComp} (${reqDateOut || "미정"}) ${live.length > 0 ? "별도 일정으로 추가" : "신규 추가"} (PL:${reqPalOut || 0}, BOX:${reqBoxOut || 0})`],
            );
            notifyCalendarChange(`[출고 등록] ${reqComp} (${reqDateOut || "미정"}) PL:${reqPalOut || 0}`, currentAdmin);
          }
        } else if (action === "UPDATE_ORDER" && data?.dailyOrders) {
          let moveCount = 0;
          for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
            let tDate = dateStr === "미정" ? null : dateStr;
            for (const item of orderList) {
              moveCount++;
              if (item.id) {
                await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
              } else {
                await pool.query(
                  `UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                  [item.sortIdx, item.company, tDate, item.pal, item.box],
                );
              }
            }
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)",
            [currentAdmin, `[출고 정렬] 화면 드래그 순서 변경 (${moveCount}건 이동)`],
          );
          notifyCalendarChange(`[출고 정렬] ${Object.keys(data.dailyOrders).map((d) => d === "미정" ? "미정" : String(d).slice(5).replace("-", "/")).join(", ")} 일정 순서 변경 (${moveCount}건)`, currentAdmin);
        } else if (action === "MULTI_DELETE" && data?.items) {
          for (const it of data.items) {
            const tDate = it.dateStr === "미정" ? null : it.dateStr;
            if (it.id) {
              await pool.query(`DELETE FROM outbound WHERE id = ?`, [it.id]);
              try { await pool.query(`DELETE FROM outbound_orders WHERE outbound_id = ?`, [it.id]); } catch (_) {}
            } else {
              await pool.query(
                `DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND COALESCE(NULLIF(pal,''),'0')=COALESCE(NULLIF(?,''),'0') AND COALESCE(NULLIF(box,''),'0')=COALESCE(NULLIF(?,''),'0')`,
                [it.comp, tDate, it.pal, it.box],
              );
            }
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)",
            [currentAdmin, `[출고 다중삭제] ${(data.items||[]).map(it=>`${(it.comp||"").replace(/\[TASK\]/gi,"").trim()}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 파기`],
          );
          notifyCalendarChange(`[출고 다중삭제] ${(data.items||[]).map(it=>`${(it.comp||"").replace(/\[TASK\]/gi,"").trim()}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 파기`, currentAdmin);
        } else if ((action === "MULTI_DONE" || action === "MULTI_UNDO_DONE") && data?.items) {
          const isDoneVal = action === "MULTI_DONE" ? 1 : 0;
          const statName = action === "MULTI_DONE" ? "✅ 완료" : "⏳ 대기(취소)";
          for (const it of data.items) {
            const tDate = it.dateStr === "미정" ? null : it.dateStr;
            if (it.id) {
              await pool.query(`UPDATE outbound SET isDone = ? WHERE id = ?`, [isDoneVal, it.id]);
            } else {
              await pool.query(
                `UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND COALESCE(NULLIF(pal,''),'0')=COALESCE(NULLIF(?,''),'0') AND COALESCE(NULLIF(box,''),'0')=COALESCE(NULLIF(?,''),'0')`,
                [isDoneVal, it.comp, tDate, it.pal, it.box],
              );
            }
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)",
            [currentAdmin, `[출고 다중상태] ${(data.items||[]).map(it=>`${(it.comp||"").replace(/\[TASK\]/gi,"").trim()}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 ➡️ ${statName}`],
          );
          notifyCalendarChange(`[출고 다중상태] ${(data.items||[]).map(it=>`${(it.comp||"").replace(/\[TASK\]/gi,"").trim()}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 ➡️ ${statName}`, currentAdmin);
        }
        return res.status(200).json({ success: true, msg: "작업 완료" });
      }
      // 🎯 [여기서부터 복사해서 새로 붙여넣으세요!] -----------------------------------------
      else if (action === "GET_LAST_OCR_DATA") {
        try {
          // 🔐 대조 권한자만 원본 OCR 데이터 열람 (그 외에는 빈 값 — 로그아웃 유도 없이 조용히 차단)
          {
            const _tk = payload.session_token ? verifyToken(payload.session_token) : null;
            const _gc = _tk ? await loadAdminCtx(_tk) : null;
            if (!_gc || !_gc.perms.ocr_compare)
              return res.status(200).json({ parsedData: [], rawData: "", geo: null, forbidden: true });
          }
          const [rows] = await pool.query(
            "SELECT store_value FROM ocr_store WHERE store_key = 'LAST_OCR_DATA'",
          );
          const [rawRows] = await pool.query(
            "SELECT store_value FROM ocr_store WHERE store_key = 'LAST_OCR_RAW'",
          );

          const parsedDataStr = rows[0] ? rows[0].store_value : "[]";
          let rawDataStr = rawRows[0] ? rawRows[0].store_value : "";

          // 🎯 [핵심 버그 수정 포인트]
          // 텔레그램에서 JSON.stringify()로 감싸서 넣었기 때문에 앞뒤에 붙은 큰따옴표(")와
          // 줄바꿈 이스케이프(\n)를 안전하게 정형화해주어야 합니다.
          if (rawDataStr) {
            try {
              // 저장된 값이 JSON 형태의 문자열("...텍스트...")이므로 풀어서 순수 글자로 복원합니다.
              rawDataStr = JSON.parse(rawDataStr);
            } catch (e) {
              // 만약 일반 텍스트 상태로 들어가 있더라도 에러 없이 털어내도록 방어막을 칩니다.
              rawDataStr = rawRows[0].store_value;
            }
          }

          if (!rawDataStr) {
            rawDataStr = "가져온 Raw 데이터가 존재하지 않습니다.";
          }

          // 좌표(iy/ih/cx)는 캐시 그대로 두되, 값(pal/날짜/인보이스/비고 등)은 현재 inbound DB로 갱신
          //  → 달력에서 따로 고친 내용이 대조창에도 반영됨. 완료된 건은 대조창에서 제외(없어지는 형태).
          let parsedData = parseJSON(parsedDataStr);
          if (Array.isArray(parsedData) && parsedData.length > 0) {
            try {
              const cleanBL = (v) => String(v || "").replace(/[\s•·\-\*]/g, "");
              // 🔑 대조표 행 ↔ 현재 DB 행 매칭 키: 확정으로 인보이스/B/L 을 고친 행은 캐시에 _cur(현재 DB 값)를 기록해 두므로 그것을 우선 사용
              //    (안 그러면 고친 행이 'DB에 없는 옛 스냅샷 + DB 추가분' 두 줄로 보여 복제된 것처럼 보임)
              const keyInv = (r) => String((r._cur && r._cur.invoice !== undefined ? r._cur.invoice : r.invoice) || "").trim();
              const keyBl = (r) => cleanBL(r._cur && r._cur.bl !== undefined ? r._cur.bl : r.bl);
              const invList = parsedData.map((r) => keyInv(r)).filter(Boolean);
              const blList = parsedData.map((r) => keyBl(r)).filter((b) => b && b !== "발행전");
              const sel =
                "SELECT bl_number, pallets, DATE_FORMAT(eta,'%Y-%m-%d') AS eta, DATE_FORMAT(receive_date,'%Y-%m-%d') AS receive_date, fwd, s_type, invoice, remarks, status FROM inbound WHERE ";
              const byInv = {};
              const byBl = {};
              const _wParts = [];
              const _wParams = [];
              if (invList.length) { _wParts.push("invoice IN (?)"); _wParams.push(invList); }
              if (blList.length) { _wParts.push("bl_number IN (?)"); _wParams.push(blList); }
              if (_wParts.length) {
                const [rows] = await pool.query(sel + _wParts.join(" OR "), _wParams);
                rows.forEach((d) => {
                  if (d.invoice) byInv[String(d.invoice).trim()] = d;
                  if (d.bl_number) byBl[cleanBL(d.bl_number)] = d;
                });
              }
              // OCR 파싱행: 현재 inbound 값으로 갱신하되, 완료된 건은 제외
              const merged = [];
              for (const r of parsedData) {
                const inv = keyInv(r);
                const blc = keyBl(r);
                const d = (inv && byInv[inv]) || (blc && blc !== "발행전" && byBl[blc]) || null;
                if (!d) {
                  merged.push(r); // 달력에 없으면(삭제 등) OCR 스냅샷 유지
                  continue;
                }
                if (d.status === "완료") continue; // 입고 완료 → 대조창에서 제외
                // 🔁 이번 사진에서 새로 읽힌 값(OCR) ≠ 현재 DB 이고, DB 가 OCR 시점(_base) 이후 안 고쳐졌다면 → '반영 제안'(_pend)
                //    사람이 OCR 이후 고친 값(DB ≠ _base)은 그대로 DB 값 유지. OCR 이 날짜를 못 읽은 경우(미정/비정상)는 제안하지 않음.
                let pend = null;
                if (r._base && typeof r._base === "object") {
                  for (const f of _OCR_PEND_FIELDS) {
                    const cmp = _ocrCmpField[f];
                    const ov = cmp(r[f]);
                    if (!ov) continue;
                    const cur = cmp(_ocrDbVal(d, f));
                    if (ov === cur) continue;
                    if (cmp(r._base[f]) !== cur) continue;
                    (pend = pend || {})[f] = f === "pal" ? String(parseInt(r[f], 10)) : (f === "eta" || f === "inDate") ? ov : String(r[f]).trim();
                  }
                }
                merged.push({
                  ...r, // iy/ih/cx 등 좌표 유지
                  _ocr: { bl: r.bl || "", eta: r.eta || "", inDate: r.inDate || "", invoice: r.invoice || "", pal: r.pal != null ? String(r.pal) : "", fwd: r.fwd || "", sType: r.sType || "", etc: r.etc || "" }, // OCR 당시 파싱값 (대조창에서 '이후 사람이 고친 값' 구분용)
                  bl: d.bl_number || r.bl,
                  pal: d.pallets != null ? String(d.pallets) : r.pal,
                  eta: d.eta || "",
                  inDate: d.receive_date || "미정",
                  fwd: d.fwd || "",
                  sType: d.s_type || "",
                  invoice: d.invoice || "",
                  etc: d.remarks || "",
                  _pend: pend, // {필드: OCR 새 값} — 클라가 표에 미리 채우고 보라색으로 표시(확정해야 DB 반영)
                });
              }
              parsedData = merged;

              // 🗓️ OCR 이미지에 찍힌 입고일의 최소~최대 범위 안에 있는 입고 일정도 함께 표시
              //   → 직접 추가/수정한 건도 같은 기간이면 대조창에 뜨고, 완료되면 빠짐.
              //   → OCR 시점이 아니라 '이미지의 입고일 범위' 기준이라 새 이미지로 OCR해도 임의로 사라지지 않음.
              try {
                const dates = parsedData
                  .map((r) => (r.inDate && /^\d{4}-\d{2}-\d{2}$/.test(r.inDate) ? r.inDate : null))
                  .filter(Boolean)
                  .sort();
                if (dates.length) {
                  const minDate = dates[0];
                  const maxDate = dates[dates.length - 1];
                  const have = new Set();
                  parsedData.forEach((r) => {
                    const inv = (r.invoice || "").toString().trim();
                    const blc = cleanBL(r.bl);
                    if (inv) have.add("INV:" + inv.toUpperCase());
                    if (blc && blc !== "발행전") have.add("BL:" + blc.toUpperCase());
                  });
                  const [extra] = await pool.query(
                    "SELECT bl_number, pallets, DATE_FORMAT(eta,'%Y-%m-%d') AS eta, DATE_FORMAT(receive_date,'%Y-%m-%d') AS receive_date, fwd, s_type, invoice, remarks FROM inbound WHERE receive_date BETWEEN ? AND ? AND status <> '완료' ORDER BY receive_date ASC, id ASC LIMIT 300",
                    [minDate, maxDate],
                  );
                  extra.forEach((d) => {
                    const inv = (d.invoice || "").toString().trim();
                    const blc = cleanBL(d.bl_number);
                    const k1 = inv ? "INV:" + inv.toUpperCase() : "";
                    const k2 = blc && blc !== "발행전" ? "BL:" + blc.toUpperCase() : "";
                    if ((k1 && have.has(k1)) || (k2 && have.has(k2))) return; // 이미 표에 있음
                    if (k1) have.add(k1);
                    if (k2) have.add(k2);
                    parsedData.push({
                      bl: d.bl_number || "",
                      pal: d.pallets != null ? String(d.pallets) : "0",
                      eta: d.eta || "",
                      inDate: d.receive_date || "미정",
                      fwd: d.fwd || "",
                      sType: d.s_type || "",
                      invoice: d.invoice || "",
                      etc: d.remarks || "",
                      iy: null,
                      ih: null,
                      cx: null,
                      _fromDb: true, // OCR 파싱 외 추가 표시분(좌표 없음) — 클라: 검증 제외 + 파란 음영
                    });
                  });
                }
              } catch (rangeErr) {
                console.error("OCR 대조 날짜범위 병합 실패:", rangeErr);
              }
            } catch (mergeErr) {
              console.error("OCR 대조 inbound 병합 실패:", mergeErr);
            }
          }

          // 🧭 좌표 독립 판독(검증용) — 없거나 깨졌으면 null (클라는 기존 검증만 수행)
          let geo = null;
          try {
            const [geoRows] = await pool.query("SELECT store_value FROM ocr_store WHERE store_key = 'LAST_OCR_GEO'");
            if (geoRows[0] && geoRows[0].store_value) geo = JSON.parse(geoRows[0].store_value);
          } catch (geoErr) {
            geo = null;
          }

          // 프론트엔드로 최종 배달
          return res.status(200).json({
            parsedData, // 좌표 캐시 + 현재 inbound 값 병합
            rawData: rawDataStr, // 완벽히 복원된 순수 원본 텍스트
            geo, // 좌표 독립 판독 결과 (rows[{y,bl,pal,eta,inDate,fwd,sType,invoice,etc}], pitch…)
          });
        } catch (err) {
          console.error("OCR 데이터 조회 에러:", err);
          return res.status(500).json({ success: false, error: err.message });
        }
      } else if (action === "OCR_UPLOAD") {
        // 📥 앱(입고 화면)에서 사진첩 이미지를 올려 OCR — DB 에는 반영하지 않고 '최근 OCR' 로 저장 → 대조창에서 확인·수정 후 [확정] 시 APPLY_OCR_DATA 로 반영
        //   읽기 순서·저장 형식은 텔레그램 /ocr 과 동일 (ocr_store: LAST_OCR_DATA · LAST_OCR_RAW · LAST_OCR_GEO · last_ocr_image)
        const b64 = typeof data?.image === "string" ? data.image.replace(/^data:[^,]+,/, "") : "";
        const mime = /^image\/(jpeg|png|webp)$/.test(String(data?.mime || "")) ? data.mime : "image/jpeg";
        if (!b64 || b64.length < 1000) return res.status(200).json({ success: false, msg: "이미지가 비어 있습니다." });
        if (b64.length > 4200000) return res.status(200).json({ success: false, msg: "이미지가 너무 큽니다. 더 작은 이미지로 다시 시도해주세요." });
        if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) return res.status(200).json({ success: false, msg: "이미지 형식이 올바르지 않습니다." });
        if (!process.env.GOOGLE_VISION_API_KEY) return res.status(200).json({ success: false, msg: "OCR API 키가 설정되어 있지 않습니다." });

        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ocr_store (store_key VARCHAR(100) PRIMARY KEY, store_value MEDIUMTEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`);

        // 텔레그램 /ocr 와 같은 잠금(40초) — 동시에 두 OCR 이 돌며 서로의 결과를 덮어쓰지 않게
        const nowT = Date.now();
        await pool.query(`INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('OCR_IS_RUNNING', '0')`);
        // 잠금 확인+획득을 한 번에 (동시에 두 곳에서 올려도 한 쪽만 통과). 40초 넘은 잠금은 낡은 것으로 보고 넘겨받음
        const [lk] = await pool.query(
          `UPDATE system_settings SET setting_value = ? WHERE setting_key = 'OCR_IS_RUNNING' AND (setting_value = '0' OR setting_value = '' OR CAST(setting_value AS UNSIGNED) < ?)`,
          [String(nowT), nowT - 40000],
        );
        if (!lk || !lk.affectedRows) return res.status(200).json({ success: false, msg: "다른 OCR 이 처리 중입니다. 잠시(약 40초) 후 다시 시도해주세요." });
        try {
          // 이번 달 사용량 (텔레그램과 같은 카운터·한도)
          const OCR_FREE_LIMIT_MONTHLY = 1000;
          const monthStr = String(new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getMonth() + 1);
          const [mRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_MONTH'`);
          const [cRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_COUNT'`);
          const [tRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_TOTAL_COUNT'`);
          const dbMonth = mRows.length > 0 ? String(mRows[0].setting_value).replace(/"/g, "") : "";
          let ocrCount = cRows.length > 0 ? parseInt(cRows[0].setting_value) || 0 : 0;
          let ocrTotal = tRows.length > 0 ? parseInt(tRows[0].setting_value) || 0 : 0;
          if (dbMonth !== monthStr) {
            ocrCount = 0;
            const valMonth = JSON.stringify(monthStr);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_MONTH', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [valMonth, valMonth]);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_COUNT', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, ["0", "0"]);
          }
          if (ocrCount >= OCR_FREE_LIMIT_MONTHLY) return res.status(200).json({ success: false, msg: "이번 달 무료 OCR 한도를 모두 사용했습니다." });

          const out = await ocrLib.runOcrPipeline(b64, { fetch, visionKey: process.env.GOOGLE_VISION_API_KEY, geminiKey: process.env.GEMINI_API_KEY });
          if (out.visionCalled) {
            ocrCount++; ocrTotal++;
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_COUNT', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [String(ocrCount), String(ocrCount)]);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_TOTAL_COUNT', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [String(ocrTotal), String(ocrTotal)]);
          }
          if (!out.ok) {
            return res.status(200).json({ success: false, msg: out.err || "OCR 에 실패했습니다." });
          }

          // 비고 정리 (텔레그램이 DB 반영 직전에 하는 것과 동일) — 대조창이 보여줄 값이 텔레그램 결과와 같도록 저장 전에 적용
          let customFilters = [];
          try {
            const [fRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_ETC_FILTERS'`);
            if (fRows.length > 0) {
              let rawVal = fRows[0].setting_value;
              if (typeof rawVal === "string") {
                if (rawVal.startsWith('"') && rawVal.endsWith('"')) rawVal = JSON.parse(rawVal);
                customFilters = JSON.parse(rawVal);
              } else customFilters = rawVal;
            }
            if (!Array.isArray(customFilters)) customFilters = [];
          } catch (fe) { customFilters = []; }
          out.rows.forEach((r) => { r.etc = ocrLib.cleanEtcText(r.etc, customFilters); });

          // 🔁 OCR 시점의 DB 값을 행마다 기록(_base) — 대조창이 '그 뒤 달력에서 사람이 고친 값'과 '이번 사진에서 새로 바뀐 값'을 구분하기 위함
          //    (이게 없으면 기존 일정의 날짜가 사진에서 바뀌어도 대조창엔 옛 DB 값만 보여 변경을 못 읽은 것처럼 보였음)
          try {
            const _cb = (v) => String(v || "").replace(/[\s•·\-\*]/g, "");
            const _inv = out.rows.map((r) => String(r.invoice || "").trim()).filter(Boolean);
            const _bls = out.rows.map((r) => _cb(r.bl)).filter((b) => b && b !== "발행전");
            const _wp = [], _wa = [];
            if (_inv.length) { _wp.push("invoice IN (?)"); _wa.push(_inv); }
            if (_bls.length) { _wp.push("bl_number IN (?)"); _wa.push(_bls); }
            if (_wp.length) {
              const [dbr] = await pool.query("SELECT bl_number, pallets, DATE_FORMAT(eta,'%Y-%m-%d') AS eta, DATE_FORMAT(receive_date,'%Y-%m-%d') AS receive_date, fwd, s_type, invoice, status FROM inbound WHERE " + _wp.join(" OR "), _wa);
              const bi = {}, bb = {};
              dbr.forEach((d) => { if (d.invoice) bi[String(d.invoice).trim()] = d; if (d.bl_number) bb[_cb(d.bl_number)] = d; });
              out.rows.forEach((r) => {
                const inv = String(r.invoice || "").trim(), blc = _cb(r.bl);
                const d = (inv && bi[inv]) || (blc && blc !== "발행전" && bb[blc]) || null;
                if (!d || d.status === "완료") return;
                r._base = {};
                _OCR_PEND_FIELDS.forEach((f) => { r._base[f] = _ocrDbVal(d, f) == null ? "" : String(_ocrDbVal(d, f)); });
              });
            }
          } catch (baseErr) { console.error("OCR 기준값(_base) 기록 실패(무시):", baseErr.message); }

          // 최근 OCR 로 저장 (이미지는 앱에서 올린 사진 자체를 data URL 로 보관 — 대조창이 그대로 표시)
          const KST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
          const timeStr = `${KST.getMonth() + 1}월${KST.getDate()}일 ${String(KST.getHours()).padStart(2, "0")}:${String(KST.getMinutes()).padStart(2, "0")}`;
          const put = (k, v) => pool.query(`INSERT INTO ocr_store (store_key, store_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE store_value = VALUES(store_value)`, [k, v]);
          // 가장 크고 실패 가능성이 높은 이미지를 먼저 저장 — 실패하면 기존 최근 OCR 이 그대로 남는다
          await put("last_ocr_image", JSON.stringify({ url: `data:${mime};base64,${b64}`, fileId: null, uploaded: true }));
          await put("LAST_OCR_DATA", JSON.stringify(out.rows));
          const rawCapped = out.text.length > 20000 ? out.text.slice(0, 20000) + "\n[TRUNCATED]" : out.text;
          await put("LAST_OCR_RAW", JSON.stringify(rawCapped));
          if (out.geo) await put("LAST_OCR_GEO", JSON.stringify(out.geo));
          else await pool.query(`DELETE FROM ocr_store WHERE store_key = 'LAST_OCR_GEO'`);
          const jsonTime = JSON.stringify({ time: timeStr });
          await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonTime, jsonTime]);
          await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'SYS_OCR_SAVE', ?)", [currentAdmin, `앱에서 OCR 업로드 (${out.rows.length}행${out.aiSuccess ? ", AI 교정" : ", 기본 파싱"})`]);
          return res.status(200).json({ success: true, rowCount: out.rows.length, aiSuccess: !!out.aiSuccess, usage: ocrCount, limit: OCR_FREE_LIMIT_MONTHLY });
        } finally {
          // 내가 잡은 잠금일 때만 풀기 (너무 오래 걸려 다른 요청이 넘겨받았다면 건드리지 않음)
          try { await pool.query(`UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'OCR_IS_RUNNING' AND setting_value = ?`, [String(nowT)]); } catch (_) {}
        }
      } else if (action === "PICK_PARSE") {
        // 📷 출고 피킹지 사진 → 업체·PLT·박스 판독 (등록은 하지 않음. 확인창에서 PICK_REGISTER 로 등록)
        const b64 = typeof data?.image === "string" ? data.image.replace(/^data:[^,]+,/, "") : "";
        const mime = /^image\/(jpeg|png|webp)$/.test(String(data?.mime || "")) ? data.mime : "image/jpeg";
        if (!b64 || b64.length < 1000) return res.status(200).json({ success: false, msg: "이미지가 비어 있습니다." });
        if (b64.length > 4200000) return res.status(200).json({ success: false, msg: "이미지가 너무 큽니다. 다시 촬영해주세요." });
        if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) return res.status(200).json({ success: false, msg: "이미지 형식이 올바르지 않습니다." });
        if (!process.env.GOOGLE_VISION_API_KEY && !pickGeminiKeys().length)
          return res.status(200).json({ success: false, msg: "OCR API 키가 설정되어 있지 않습니다." });

        await geminiStateLoad();
        const parsed = await pickLib.parsePicking(b64, mime, {
          fetch,
          visionKey: process.env.GOOGLE_VISION_API_KEY,
          geminiKey: pickGeminiKeys(), // 키가 여러 개(다른 프로젝트)면 번갈아 쓰고, 한도·과부하로 막힌 키는 풀릴 때까지 건너뜀
          model: _ctx && _ctx.isSystem ? pickLib.resolvePin(data?.model) : null, // 🧪 모델 지정 시험 — 시스템 관리자만(그 외 사용자가 보내도 무시)
          shadow: process.env.PICK_SHADOW !== "0", // lite 비교 기록(끄려면 환경변수 PICK_SHADOW=0)
        });
        await geminiStateSave();
        if (parsed.ok && parsed.aiQuota && parsed.pressure && parsed.pressure.level === "none") await geminiAlertAllBlocked(parsed.aiRetryAt || parsed.pressure.retryAt);
        if (!parsed.ok) return res.status(200).json({ success: false, msg: "판독 실패: " + (parsed.err || "알 수 없는 오류") });

        // 업체 매칭: 업체정보 DB + 이전에 직접 고른 연결
        let compDb = {};
        let aliasMap = {};
        try {
          const [cr] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`);
          if (cr.length) compDb = typeof cr[0].setting_value === "object" ? cr[0].setting_value : JSON.parse(cr[0].setting_value);
          const [ar] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PICK_ALIAS'`);
          if (ar.length) aliasMap = typeof ar[0].setting_value === "object" ? ar[0].setting_value : JSON.parse(ar[0].setting_value);
        } catch (_) {}
        const comp = pickLib.matchCompany(parsed.customer, compDb || {}, aliasMap || {}, { floor: parsed.floor }); // floor: 주소 호수(301호→3층)로 같은 회사의 층 구분

        // 이미 등록된 피킹지인지 — 등록 기록(pick_registered)이 가리키는 일정이 '지금도 있을 때만' 중복.
        //   일정을 지웠다면(또는 수량추가 이력을 지웠다면) 다시 등록할 수 있다.
        let duplicate = false;
        let dupInfo = null;
        let legacy = false;
        try {
          if (parsed.orderNo) {
            const st = await pickDupState(parsed.orderNo);
            duplicate = st.dup;
            dupInfo = st.info;
            legacy = st.legacy;
          }
        } catch (_) {}

        const parseId = await pickLogInsert(currentAdmin, pickParsedSnapshot(parsed, comp, { kb: Math.round((b64.length * 3) / 4 / 1024), meta: { rot: data?.meta?.rot === true, enh: data?.meta?.enh === true, pin: parsed.pinned || null } }));
        return res.status(200).json({ success: true, result: parsed, company: comp, duplicate, dupInfo, legacy, parseId });
      } else if (action === "PICK_REREAD") {
        // 🔍 손글씨 2차 판독: 앱이 1차 판독이 알려준 손글씨 영역만 잘라 보낸 그림(1~2장)을 한 번 더 읽는다 (등록은 하지 않음)
        const imgs = Array.isArray(data?.images) ? data.images.slice(0, 2) : [];
        const clean = imgs.map((x) => (typeof x === "string" ? x.replace(/^data:[^,]+,/, "") : ""));
        if (!clean.length || clean.some((b) => b.length < 200 || b.length > 1800000 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(b)))
          return res.status(200).json({ success: false, msg: "그림 형식이 올바르지 않습니다." });
        if (!pickGeminiKeys().length) return res.status(200).json({ success: false, msg: "AI 키가 설정되어 있지 않습니다." });
        const mimeR = /^image\/(jpeg|png|webp)$/.test(String(data?.mime || "")) ? data.mime : "image/jpeg";
        await geminiStateLoad();
        const pinR = _ctx && _ctx.isSystem ? pickLib.resolvePin(data?.model) : null; // 🧪 모델 지정 시험(시스템 관리자만)
        const rr = await pickLib.rereadHandwriting(clean, mimeR, fetch, pickGeminiKeys(), pinR);
        await geminiStateSave();
        if (!rr.ok) {
          await pickLogSet(data?.parseId, "reread", { error: String(rr.err || "").slice(0, 80) }, currentAdmin);
          return res.status(200).json({ success: false, msg: "2차 판독 실패: " + (rr.err || "알 수 없는 오류"), quota: !!rr.quota, retryAt: rr.retryAt || 0, timing: { ms: rr.ms || null, attempts: rr.attempts || [] } });
        }
        await pickLogSet(data?.parseId, "reread", Object.assign({}, rr.data, { _m: rr.model || null }), currentAdmin);
        return res.status(200).json({ success: true, hw: rr.data, timing: { ms: rr.ms || null, model: rr.model || null, keyNo: rr.keyNo || null, attempts: rr.attempts || [] } });
      } else if (action === "PICK_KEYTEST") {
        // 🔑 AI 키·모델 점검 (시스템 관리자 전용 — SYSTEM_ONLY_ACTIONS 에서 선차단): 키마다 모델 목록 조회 + 모델별 작은 요청 1회
        const kk = pickGeminiKeys();
        if (!kk.length) return res.status(200).json({ success: false, msg: "AI 키가 설정되어 있지 않습니다." });
        const extraM = ["gemini-3.8-flash"]; // 참고용(지금 쓰는 목록엔 없음): 이 키로 쓸 수 있는지만 확인
        const tk = await pickLib.testKeys(fetch, kk, pickLib.GEMINI_MODELS(), extraM);
        return res.status(200).json({ success: true, keys: tk, models: pickLib.GEMINI_MODELS(), extra: extraM });
      } else if (action === "PICK_STATS") {
        // 📊 판독 정확도 (시스템 관리자 전용): 최근 N일, 등록까지 끝난 건 기준
        await pickLogEnsure();
        const days = Math.min(365, Math.max(1, parseInt(data?.days, 10) || 90));
        const [lr] = await pool.query(`SELECT order_no, parsed, reread, final, created_at FROM pick_parse_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY id DESC LIMIT 2000`, [days]);
        const jp = (t) => { try { return t ? JSON.parse(t) : null; } catch (_) { return null; } };
        const stats = pickLib.computePickStats(lr.map((r) => ({ order_no: r.order_no, parsed: jp(r.parsed), reread: jp(r.reread), final: jp(r.final) })));
        await geminiStateLoad(true);
        const keys = pickLib.keyStatus(pickGeminiKeys(), pickLib.GEMINI_MODELS());
        return res.status(200).json({ success: true, days, stats, keys });
      } else if (action === "PICK_FIND_ROWS") {
        // 같은 업체의 '완료되지 않은' 출고 일정 찾기 (수량 추가 대상 후보). 날짜가 있으면 그 날짜만, 없으면 미정 + 오늘 이후
        const fCompany = String(data?.company || "").trim().slice(0, 100);
        let fDate = data?.date ? String(data.date).slice(0, 10) : null;
        if (fDate && !/^\d{4}-\d{2}-\d{2}$/.test(fDate)) fDate = null;
        if (!fCompany) return res.status(200).json({ success: true, rows: [] });
        const compDbF = await pickLoadCompDb();
        let rowsF;
        if (fDate) {
          [rowsF] = await pool.query(
            `SELECT id, company, pal, box, DATE_FORMAT(outbound_date, '%Y-%m-%d') AS date, etc FROM outbound WHERE outbound_date = ? AND (isDone = 0 OR isDone IS NULL) ORDER BY id ASC LIMIT 300`,
            [fDate],
          );
        } else {
          [rowsF] = await pool.query(
            `SELECT id, company, pal, box, DATE_FORMAT(outbound_date, '%Y-%m-%d') AS date, etc FROM outbound WHERE (outbound_date IS NULL OR outbound_date >= CURDATE()) AND (isDone = 0 OR isDone IS NULL) ORDER BY outbound_date IS NULL DESC, outbound_date ASC, id ASC LIMIT 500`,
          );
        }
        const matched = rowsF.filter((r) => !/^\[TASK\]/i.test(String(r.company || "")) && pickSameCompany(r.company, fCompany, compDbF)).slice(0, 10);
        return res.status(200).json({ success: true, rows: matched.map((r) => ({ id: r.id, company: r.company, pal: r.pal, box: r.box, date: r.date || null, etc: String(r.etc || "").slice(0, 120) })) });
      } else if (action === "PICK_REGISTER") {
        // ✅ 확인창에서 [등록]
        //   mode "new"(기본)    : 출고 '새 행' 추가 (기존 행을 덮어쓰지 않음)
        //   mode "append"       : 같은 업체·날짜의 기존 일정에 [+수량추가] 와 똑같이 합산 + 비고에 [10/22 1P 143B 추가] 이력
        const company = String(data?.company || "").trim().slice(0, 100);
        const toI = (v) => { const n = parseInt(v, 10); return isFinite(n) && n >= 0 && n <= 9999 ? n : null; };
        const pal = toI(data?.pal);
        const box = toI(data?.box);
        const mode = data?.mode === "append" ? "append" : "new";
        const targetId = parseInt(data?.targetId, 10);
        let outDate = data?.date ? String(data.date).slice(0, 10) : null;
        if (outDate === "미정") outDate = null;
        if (outDate) {
          const dm = outDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          const dd = dm ? new Date(+dm[1], +dm[2] - 1, +dm[3]) : null;
          if (!dd || dd.getFullYear() !== +dm[1] || dd.getMonth() !== +dm[2] - 1 || dd.getDate() !== +dm[3])
            return res.status(200).json({ success: false, msg: "출고일 형식이 올바르지 않습니다." });
        }
        const etc = String(data?.etc || "").trim().slice(0, 500);
        const orderNo = String(data?.orderNo || "").trim().replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
        if (!company) return res.status(200).json({ success: false, msg: "업체를 선택해주세요." });
        if (pal === null || box === null) return res.status(200).json({ success: false, msg: "PLT와 박스는 0 이상의 숫자로 입력해주세요." });
        if (mode === "append") {
          if (!isFinite(targetId) || targetId <= 0) return res.status(200).json({ success: false, msg: "수량을 추가할 기존 일정을 선택해주세요." });
          if (pal === 0 && box === 0) return res.status(200).json({ success: false, msg: "추가할 PLT 또는 박스가 0 입니다." });
        }

        // 같은 피킹지 이중 등록 방지 (동시에 두 번 눌러도 한 번만 통과). 지운 일정의 기록은 다시 쓸 수 있음.
        let claimed = false;
        if (orderNo) {
          const cl = await pickClaim(orderNo, mode);
          if (!cl.ok) return res.status(200).json({ success: false, msg: cl.msg });
          claimed = true;
        }
        const release = async () => { if (claimed) { try { await pool.query(`DELETE FROM pick_registered WHERE order_no = ? AND outbound_id = 0`, [orderNo]); } catch (_) {} } }; // 내가 잡은 것(처리 중 표시)만 풀기
        let logDesc = "";
        let outId = null;
        let histStr = "";
        try {
          if (mode === "append") {
            const [trs] = await pool.query(`SELECT id, company, pal, box, etc, isDone, DATE_FORMAT(outbound_date, '%Y-%m-%d') AS date FROM outbound WHERE id = ? LIMIT 1`, [targetId]);
            if (!trs.length) { await release(); return res.status(200).json({ success: false, msg: "선택한 일정을 찾을 수 없습니다. (삭제되었을 수 있음) 다시 선택해주세요." }); }
            const tr = trs[0];
            if (tr.isDone === 1 || tr.isDone === true) { await release(); return res.status(200).json({ success: false, msg: "이미 완료 처리된 일정에는 추가할 수 없습니다." }); }
            if (!pickSameCompany(tr.company, company, await pickLoadCompDb())) { await release(); return res.status(200).json({ success: false, msg: "선택한 일정의 업체가 다릅니다." }); }
            const ap = await appendQtyAtomic(tr.id, String(tr.company || "").trim(), pal, box, "");
            if (!ap.ok) { await release(); return res.status(200).json({ success: false, msg: "그 사이 일정이 완료·삭제·변경되어 추가하지 못했습니다. 일정을 다시 선택해주세요." }); }
            histStr = ap.hist;
            outId = tr.id;
            logDesc = `[출고 수량추가·피킹지] ${company} (${tr.date || "미정"}) +PL:${pal}, +BOX:${box}${orderNo ? " / " + orderNo : ""}`;
          } else {
            const _shipPick = shipNorm(data?.shipType);
            const [ins] = _shipPick && (await shipColReady())
              ? await pool.query(
                  `INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc, ship_type) VALUES (?, ?, ?, ?, 0, ?, ?)`,
                  [company, String(pal), String(box), outDate, etc, _shipPick],
                )
              : await pool.query(
                  `INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`,
                  [company, String(pal), String(box), outDate, etc],
                );
            outId = ins && ins.insertId ? ins.insertId : null;
            logDesc = `[출고 등록·피킹지] ${company} (${outDate || "미정"}) PL:${pal}, BOX:${box}${orderNo ? " / " + orderNo : ""}`;
          }
        } catch (insErr) {
          await release();
          throw insErr;
        }
        if (orderNo) {
          try {
            const markIt = () => pool.query(`UPDATE pick_registered SET outbound_id = ?, mode = ?, hist = ? WHERE order_no = ?`, [outId || -1, mode, histStr, orderNo]);
            try { await markIt(); } catch (e1) { await markIt(); } // 한 번 더 시도 (실패하면 120초 뒤 중복 방지가 풀리므로)
            await pool.query(`DELETE FROM processed_images WHERE unique_id = ?`, ["PICK:" + orderNo]); // 이전 버전이 남긴 표시 정리
          } catch (markErr) {
            console.error("[PICK] 등록 기록 저장 실패(중복 방지 약화):", markErr.sqlMessage || markErr.message);
          }
        }

        if (orderNo && outId > 0) {
          try { await ordAdd(outId, ordNormList(orderNo), mode === "append" ? "append" : "new", mode === "append" ? await ordAppendSlot(outId) : 0); } // 일정 화면 조회·검색용 (실패해도 등록 자체는 유지)
          catch (ordErr) { console.error("[PICK] 출고지시번호 저장 실패(무시):", ordErr.sqlMessage || ordErr.message); }
        }

        // 직접 고른 업체 연결 기억 (다음부터 자동 매칭)
        try {
          const printed = pickLib.normName(data?.printedName || "");
          // 같은 이름이 여러 업체(메디맥 2층/3층 등)에 걸리면 연결을 학습하지 않는다 — 한 번의 선택이 다음 서류(다른 층)를 잘못 연결하지 않게
          let _ambig = false;
          if (printed) {
            const _cdbL = await pickLoadCompDb();
            _ambig = Object.keys(_cdbL).filter((n) => { const k = pickLib.normName(n); return k.length >= 3 && (k.includes(printed) || printed.includes(k)); }).length > 1;
          }
          if (printed && !_ambig && printed !== pickLib.normName(company)) {
            const [ar] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PICK_ALIAS'`);
            let am = {};
            try { am = ar.length ? (typeof ar[0].setting_value === "object" ? ar[0].setting_value : JSON.parse(ar[0].setting_value)) || {} : {}; } catch (_) {}
            if (am[printed] !== company && Object.keys(am).length < 500) {
              am[printed] = company;
              const js = JSON.stringify(am);
              await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('PICK_ALIAS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [js, js]);
            }
          }
        } catch (aliasErr) {
          console.error("[PICK] 업체 연결 저장 실패(무시):", aliasErr.sqlMessage || aliasErr.message);
        }

        if (data?.parseId) { // 판독 정확도 기록: 사람이 최종으로 입력한 값
          const toN = (v) => { const n = parseInt(v, 10); return isFinite(n) && n >= 0 && n <= 9999 ? n : null; };
          await pickLogSet(data.parseId, "final", { company, plt: mode === "append" && pal === 0 ? null : pal, wan: toN(data?.wan), hon: toN(data?.hon), date: outDate, mode }, currentAdmin);
        }
        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, ?, ?)", [currentAdmin, mode === "append" ? "CAL_EDIT" : "CAL_ADD", logDesc]);
        notifyCalendarChange(logDesc, currentAdmin);
        return res.status(200).json({ success: true, mode });
      } else if (action === "APPLY_OCR_DATA") {
        // 웹 OCR 대조창에서 셀 수정 후 '확정' → inbound 테이블에 upsert (텔레그램 /ocr 과 동일 로직)
        try {
          const rows = data && Array.isArray(data.rows) ? data.rows : [];
          const delRows = data && Array.isArray(data.deletes) ? data.deletes : [];
          if (rows.length === 0 && delRows.length === 0) {
            return res.status(200).json({ success: false, msg: "적용할 데이터가 없습니다." });
          }
          if (rows.length > 200 || delRows.length > 200) {
            return res.status(200).json({ success: false, msg: "한 번에 적용 가능한 행 수(200)를 초과했습니다." });
          }

          // 날짜 정규화: YYYY-MM-DD 만 허용, 그 외/미정/빈값은 null
          // 실제 유효하고 2000~2100 범위인 날짜만 통과 (1900-01-00 등은 null=미정)
          const normDate = (v) => {
            const s = safeDate(v);
            if (!s) return null;
            const m = String(s).match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
            if (!m) return null;
            const y = +m[1], mo = +m[2], d = +m[3];
            if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
            const dt = new Date(y, mo - 1, d);
            if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
            return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          };

          let insertCount = 0;
          let updateCount = 0;
          let skipCount = 0;
          let deleteCount = 0;
          const skipNames = [];

          // 🗑️ 대조표에서 행 데이터를 전부 지운 건 → 해당 입고 일정 삭제
          //   · '완료' 처리된 일정은 절대 지우지 않음 (같은 인보이스를 가진 완료 행까지 같이 지워지던 문제 방지)
          //   · 같은 조건에 여러 행이 걸려도 가장 일치하는 1행만 삭제
          //   · 대상을 못 찾으면 조용히 넘기지 않고 deleteSkipped 로 알림
          let deleteSkipped = 0;
          const deleteSkippedNames = [];
          for (const r of delRows) {
            const bl = String(r.bl || "").replace(/[\s•·\-\*]/g, "");
            const inv = String(r.invoice || "").replace(/\s/g, "");
            const dt = normDate(r.inDate);
            let found = null;
            try {
              if (inv) {
                const [f] = await pool.query(
                  `SELECT id FROM inbound WHERE TRIM(invoice) = ? AND COALESCE(status,'') <> '완료' ORDER BY (TRIM(bl_number) = ?) DESC, (receive_date <=> ?) DESC, id ASC LIMIT 1`,
                  [inv, bl, dt],
                );
                found = f[0] || null;
              } else if (bl && bl !== "발행전") {
                const [f] = await pool.query(
                  `SELECT id FROM inbound WHERE TRIM(bl_number) = ? AND receive_date <=> ? AND COALESCE(status,'') <> '완료' ORDER BY id ASC LIMIT 1`,
                  [bl, dt],
                );
                found = f[0] || null;
              } else {
                // 인보이스·B/L 이 없던 '발행전' 행 → 입고일 + 비어있는 인보이스로 특정
                const [f] = await pool.query(
                  `SELECT id FROM inbound WHERE (TRIM(bl_number) = ? OR bl_number IS NULL OR TRIM(bl_number) = '') AND receive_date <=> ? AND (invoice IS NULL OR TRIM(invoice) = '') AND COALESCE(status,'') <> '완료' ORDER BY id ASC LIMIT 1`,
                  [bl || "발행전", dt],
                );
                found = f[0] || null;
              }
            } catch (delFindErr) {
              console.error("[APPLY_OCR] 삭제 대상 조회 실패:", delFindErr.sqlMessage || delFindErr.message);
            }
            if (found) {
              const [result] = await pool.query(`DELETE FROM inbound WHERE id = ?`, [found.id]);
              deleteCount += result && result.affectedRows ? result.affectedRows : 0;
            } else {
              deleteSkipped++;
              deleteSkippedNames.push(bl || inv || "발행전");
            }
          }

          // OCR 텍스트 전 필드 공통 정형화 (telegram.js /ocr 과 동일 로직)
          const safeStr = (v, max) =>
            String(v == null ? "" : v)
              .replace(/\x00/g, "")
              .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
              .trim()
              .slice(0, max);

          // 🔑 1단계: 모든 행의 '대상 DB 행(id)'을 수정 전 상태로 먼저 확정 (인보이스를 서로 맞바꿔도 꼬이지 않게)
          //   - 우선순위: 대조표에 원래 있던 값(_o: 원래 인보이스 → 원래 BL+입고일) → 새 인보이스 → 새 BL
          //   - 한 DB 행은 한 행만 차지(claimed) → 같은 행을 두 번 덮어쓰는 일 방지
          const claimed = new Set();
          const findFree = async (sql, params) => {
            const [found] = await pool.query(sql, params);
            return found.find((x) => !claimed.has(x.id)) || null;
          };
          const plan = [];
          for (const r of rows) {
            const bl = safeStr(r.bl, 100).replace(/[\s•·\-\*]/g, "").toUpperCase(); // B/L 은 항상 대문자
            const pal = Math.min(Math.max(parseInt(r.pal) || 0, 0), 99999);
            const inDate = normDate(r.inDate);
            const eta = normDate(r.eta);
            const fwd = safeStr(r.fwd, 100).replace(/[\t\n\r]+/g, " ").replace(/\s{2,}/g, " ");
            const sType = safeStr(r.sType, 20).replace(/\s/g, "").toUpperCase();
            const invoice = safeStr(r.invoice, 100).replace(/\s/g, ""); // 내부 공백 제거(매칭 일관성)
            const etc = safeStr(r.etc, 500);
            const o = r._o && typeof r._o === "object" ? r._o : null;
            let target = null;
            try {
              if (o) {
                const oInv = safeStr(o.invoice, 100).replace(/\s/g, "");
                const oBl = safeStr(o.bl, 100).replace(/[\s•·\-\*]/g, "");
                const oDt = normDate(o.inDate);
                if (oInv) {
                  target = await findFree(`SELECT id, status FROM inbound WHERE TRIM(invoice) = ?`, [oInv]);
                }
                if (!target && oBl && oBl !== "발행전") {
                  target = await findFree(`SELECT id, status FROM inbound WHERE TRIM(bl_number) = ? ORDER BY (receive_date <=> ?) DESC, id ASC`, [oBl, oDt]);
                }
                if (!target && !oInv && (oBl === "발행전" || oBl === "")) {
                  // 인보이스·BL 이 없던 행(발행전) → 입고일 + 비어있는 인보이스로 특정
                  target = await findFree(
                    `SELECT id, status FROM inbound WHERE (TRIM(bl_number) = ? OR bl_number IS NULL) AND receive_date <=> ? AND (invoice IS NULL OR TRIM(invoice) = '') ORDER BY id ASC`,
                    [oBl, oDt],
                  );
                }
              }
              if (!target && invoice) {
                target = await findFree(`SELECT id, status FROM inbound WHERE TRIM(invoice) = ?`, [invoice]);
              }
              if (!target && bl !== "발행전" && bl !== "") {
                target = await findFree(`SELECT id, status FROM inbound WHERE TRIM(bl_number) = ?`, [bl]);
              }
            } catch (findErr) {
              console.error(`[APPLY_OCR] 대상 조회 실패 (${bl || invoice}):`, findErr.sqlMessage || findErr.message);
            }
            if (target) claimed.add(target.id);
            plan.push({ r, bl, pal, inDate, eta, fwd, sType, invoice, etc, target });
          }

          // 🛡️ 인보이스 중복 방지 — 반영 '후' 상태 기준으로 같은 인보이스를 가진 행이 둘 이상 생기면 해당 행은 건너뜀
          //   · 서로 번호를 맞바꾸는 경우는 반영 후 중복이 없으므로 통과 / 인보이스를 바꾸지 않은 행은 검사 안 함(속도)
          //   · 같은 번호를 쓰는 행이 대조표 안에 둘이면 먼저 나온 행만 반영
          try {
            const splitInv = (v) => String(v || "").split(/[\s,;/]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
            const active = plan.filter((p) => !(p.target && p.target.status === "완료"));
            const activeIds = new Set(active.filter((p) => p.target).map((p) => p.target.id));
            const firstUse = new Map(); // 토큰 → 먼저 사용한 plan 행
            for (const p of active) {
              const toks = splitInv(p.invoice);
              const oInv = p.r && p.r._o && typeof p.r._o === "object" ? safeStr(p.r._o.invoice, 100).replace(/\s/g, "") : "";
              const needCheck = toks.length > 0 && (!p.target || p.invoice !== oInv);
              let clash = null;
              for (const t of toks) {
                if (firstUse.has(t) && firstUse.get(t) !== p) { clash = `${t} (표 안 다른 행과 같음)`; break; }
              }
              if (!clash && needCheck) {
                for (const t of toks) {
                  const [hit] = await pool.query(`SELECT id, invoice FROM inbound WHERE invoice LIKE ?`, [`%${t.replace(/[\\%_]/g, "\\$&")}%`]);
                  const other = hit.find((h) => !activeIds.has(h.id) && splitInv(h.invoice).includes(t));
                  if (other) { clash = `${t} (달력에 이미 있음)`; break; }
                }
              }
              if (clash) {
                p.skipReason = `인보이스 중복 ${clash}`;
              } else {
                toks.forEach((t) => { if (!firstUse.has(t)) firstUse.set(t, p); });
              }
            }
          } catch (dupErr) {
            console.error("[APPLY_OCR] 인보이스 중복 검사 실패(무시):", dupErr.sqlMessage || dupErr.message);
          }

          // 2단계: 확정된 id 로 반영 (한 행이 실패해도 전체 확정이 죽지 않도록 행별 방어)
          for (const p of plan) {
            if (p.skipReason) {
              skipCount++;
              skipNames.push(`${p.bl || p.invoice}: ${p.skipReason}`);
              continue;
            }
            try {
              if (p.target) {
                if (p.target.status === "완료") {
                  skipCount++;
                  skipNames.push(p.bl || p.invoice);
                  continue;
                }
                await pool.query(
                  `UPDATE inbound SET bl_number=?, pallets=?, receive_date=?, remarks=?, s_type=?, fwd=?, invoice=?, eta=?, is_ai_modified=1 WHERE id=?`,
                  [p.bl, p.pal, p.inDate, p.etc, p.sType, p.fwd, p.invoice, p.eta, p.target.id],
                );
                updateCount++;
              } else {
                await pool.query(
                  `INSERT INTO inbound (bl_number, pallets, receive_date, status, s_type, fwd, invoice, eta, remarks, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, ?, 1)`,
                  [p.bl, p.pal, p.inDate, p.sType, p.fwd, p.invoice, p.eta, p.etc],
                );
                insertCount++;
              }
            } catch (rowErr) {
              skipCount++;
              skipNames.push(p.bl || p.invoice);
              console.error(`[APPLY_OCR] 행 반영 실패 (${p.bl || p.invoice}):`, rowErr.sqlMessage || rowErr.message);
            }
          }
          // 🔁 인보이스/B/L 을 고쳐 반영한 행은 캐시 행에 '현재 DB 키(_cur)'만 기록 (OCR 당시 값·좌표는 그대로 보존)
          //    → 다음 GET 때 새 값으로 DB 행을 찾아 한 줄로 표시. 행 식별은 이미지 세로 위치(iy)로 하고, 같은 iy 가 둘 이상이면 건드리지 않음.
          try {
            const touched = plan.filter((p) => p.target && p.target.status !== "완료" && p.r && typeof p.r.iy === "number");
            if (touched.length) {
              const [cacheRows] = await pool.query("SELECT store_value FROM ocr_store WHERE store_key = 'LAST_OCR_DATA'");
              const cache = cacheRows[0] ? parseJSON(cacheRows[0].store_value) : null;
              if (Array.isArray(cache)) {
                let changedCache = false;
                for (const p of touched) {
                  const same = cache.filter((c) => c && typeof c.iy === "number" && c.iy === p.r.iy);
                  if (same.length !== 1) continue;
                  same[0]._cur = { bl: p.bl, invoice: p.invoice };
                  changedCache = true;
                }
                if (changedCache) {
                  const cacheStr = JSON.stringify(cache);
                  await pool.query("UPDATE ocr_store SET store_value = ? WHERE store_key = 'LAST_OCR_DATA'", [cacheStr]);
                }
              }
            }
          } catch (curErr) {
            console.error("OCR 캐시 _cur 기록 실패(무시):", curErr.message);
          }
          // ⚠️ LAST_OCR_DATA(좌표 캐시)의 OCR 당시 값·좌표는 덮어쓰지 않음 — 대조창은 GET 때 현재 inbound 값을 합쳐서 보여줌

          // 감사 로그 + 텔레그램 알림
          try {
            let ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "IP 알수없음";
            if (ip.includes(",")) ip = ip.split(",")[0];
            // 처리된 BL 목록 (최대 5개 + 나머지 N건)
            const blList = rows.slice(0, 5).map((r) => String(r.bl || r.invoice || "").slice(-8)).filter(Boolean);
            const blSuffix = rows.length > 5 ? ` 외 ${rows.length - 5}건` : "";
            const blStr = blList.length > 0 ? ` [${blList.join(", ")}${blSuffix}]` : "";
            const ocrDesc = `[OCR 확정] 신규 ${insertCount}건 / 수정 ${updateCount}건 / 삭제 ${deleteCount}건${blStr}`;
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, 'OCR_APPLY', ?, ?)",
              [currentAdmin, ocrDesc, ip],
            );
            notifyCalendarChange(ocrDesc, currentAdmin);
          } catch (e) {}

          return res.status(200).json({ success: true, insertCount, updateCount, skipCount, skipNames: skipNames.slice(0, 10), deleteCount, deleteSkipped, deleteSkippedNames: deleteSkippedNames.slice(0, 10), total: rows.length });
        } catch (err) {
          console.error("OCR 적용 에러:", err);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      } else if (action === "FIND_INBOUND_DUPES") {
        // 🔎 오너 전용 — 입고 DB 에서 같은 인보이스 / 같은 B/L 을 가진 행 묶음을 찾아 보여줌 (조회만, 삭제 X)
        try {
          const _ownerId = process.env.TELEGRAM_OWNER_ID || "";
          if (!_ownerId || currentAdmin.toLowerCase() !== _ownerId.toLowerCase())
            return res.status(200).json({ success: false, msg: "권한이 없습니다." });
          const [all] = await pool.query(
            `SELECT id, bl_number, invoice, pallets, DATE_FORMAT(receive_date,'%Y-%m-%d') AS rd, DATE_FORMAT(eta,'%Y-%m-%d') AS eta, status, fwd, s_type, remarks, is_ai_modified FROM inbound ORDER BY receive_date ASC, id ASC LIMIT 20000`,
          );
          const slim = (r) => ({
            id: r.id,
            bl: r.bl_number || "",
            invoice: r.invoice || "",
            pal: r.pallets,
            rd: r.rd || "",
            eta: r.eta || "",
            status: r.status || "",
            fwd: r.fwd || "",
            sType: r.s_type || "",
            etc: r.remarks || "",
            ai: !!r.is_ai_modified,
          });
          const byInv = new Map();
          const byBl = new Map();
          for (const r of all) {
            // 인보이스: '25088471, 25089491' 처럼 여러 개가 들어간 칸은 개별 번호로 쪼개서 비교
            const toks = new Set(
              String(r.invoice || "")
                .split(/[\s,;/]+/)
                .map((t) => t.trim().toUpperCase())
                .filter((t) => t.length >= 5),
            );
            toks.forEach((t) => {
              if (!byInv.has(t)) byInv.set(t, []);
              byInv.get(t).push(r);
            });
            const bl = String(r.bl_number || "").replace(/[\s•·\-\*]/g, "").toUpperCase();
            if (bl && bl !== "발행전") {
              if (!byBl.has(bl)) byBl.set(bl, []);
              byBl.get(bl).push(r);
            }
          }
          const groups = [];
          byInv.forEach((rs, k) => {
            if (rs.length > 1) groups.push({ type: "invoice", key: k, rows: rs.map(slim) });
          });
          byBl.forEach((rs, k) => {
            if (rs.length > 1) groups.push({ type: "bl", key: k, rows: rs.map(slim) });
          });
          return res.status(200).json({ success: true, total: all.length, groupCount: groups.length, groups: groups.slice(0, 200) });
        } catch (e) {
          console.error("중복검사 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      } else if (action === "DELETE_INBOUND_DUPES") {
        // 🗑️ 오너 전용 — 중복검사 창에서 사용자가 직접 고른 행(id)만 삭제
        try {
          const _ownerId = process.env.TELEGRAM_OWNER_ID || "";
          if (!_ownerId || currentAdmin.toLowerCase() !== _ownerId.toLowerCase())
            return res.status(200).json({ success: false, msg: "권한이 없습니다." });
          const ids = (data && Array.isArray(data.ids) ? data.ids : [])
            .map((v) => parseInt(v, 10))
            .filter((v) => Number.isInteger(v) && v > 0);
          const uniq = Array.from(new Set(ids));
          if (uniq.length === 0) return res.status(200).json({ success: false, msg: "삭제할 항목이 없습니다." });
          if (uniq.length > 100) return res.status(200).json({ success: false, msg: "한 번에 최대 100건까지 삭제할 수 있습니다." });
          const [before] = await pool.query(
            `SELECT id, bl_number, invoice, DATE_FORMAT(receive_date,'%Y-%m-%d') AS rd FROM inbound WHERE id IN (${uniq.map(() => "?").join(",")})`,
            uniq,
          );
          const [delRes] = await pool.query(`DELETE FROM inbound WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq);
          const deleted = delRes && delRes.affectedRows ? delRes.affectedRows : 0;
          try {
            let ip = req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "IP 알수없음";
            if (ip.includes(",")) ip = ip.split(",")[0];
            const detail = before
              .slice(0, 10)
              .map((r) => `#${r.id} ${r.bl_number || "-"}|${r.invoice || "-"}|${r.rd || "미정"}`)
              .join(", ");
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, 'DUPE_DELETE', ?, ?)",
              [currentAdmin, `[중복검사 삭제] ${deleted}건 (${detail}${before.length > 10 ? " 외" : ""})`.slice(0, 1000), ip],
            );
          } catch (e) {}
          return res.status(200).json({ success: true, deleted });
        } catch (e) {
          console.error("중복 삭제 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      } else if (action === "AI_QUERY") {
        try {
          const { question } = data;
          if (!question || !question.trim()) {
            return res.status(200).json({ success: false, msg: "질문을 입력해주세요." });
          }

          const today = new Date().toISOString().slice(0, 10);

          // 🌤️ 날씨 질문이면 실시간 날씨(서울)를 가져와 답변 (LLM은 실시간 정보를 모르므로 API로 보강)
          const isWeatherQ =
            /(날씨|기온|비\s*(가|와|올|오|내|쏟)|눈\s*(이|올|내|와)|우산|더울|더워|더운|추울|추워|추운|덥|춥|폭염|한파|장마|소나기|미세먼지|황사|맑|흐)/.test(
              question,
            );
          if (isWeatherQ) {
            const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY_AI || process.env.GEMINI_API_KEY}`;
            // 1) 질문에서 지역 추출 (시간표현 제외). 없으면 사용자에게 지역을 되물음
            let wLoc = "";
            try {
              const locPrompt = `다음 문장에서 날씨를 궁금해하는 '지역/도시 이름'만 추출해. 시간표현(오늘/내일/모레/이번주/주말/지금 등)은 지역이 아님. 지역이 없으면 빈 문자열. JSON만 출력: {"location":"..."}\n문장: ${question}`;
              const locCtrl = new AbortController();
              const locTimer = setTimeout(() => locCtrl.abort(), 8000);
              let lr;
              try {
                lr = await fetch(gUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: locPrompt }] }],
                    generationConfig: { temperature: 0, responseMimeType: "application/json" },
                  }),
                  signal: locCtrl.signal,
                });
              } finally {
                clearTimeout(locTimer);
              }
              const lj = await lr.json();
              const lt = (lj.candidates?.[0]?.content?.parts?.[0]?.text || "")
                .replace(/```json/gi, "")
                .replace(/```/g, "")
                .trim();
              wLoc = (JSON.parse(lt).location || "").trim();
            } catch (e) {
              console.error("지역 추출 실패:", e.message);
            }

            if (!wLoc) {
              return res.status(200).json({
                success: true,
                sql: "",
                rows: [],
                count: 0,
                isChat: true,
                summary: "어느 지역 날씨를 알려드릴까요? 🌍 (예: 수원, 용인, 분당)",
              });
            }

            // 2) 해당 지역 실시간 날씨 조회
            let wSummary = "";
            try {
              const wCtrl = new AbortController();
              const wTimer = setTimeout(() => wCtrl.abort(), 7000);
              const wRes = await fetch(`https://wttr.in/${encodeURIComponent(wLoc)}?format=j1&lang=ko`, {
                signal: wCtrl.signal,
              });
              clearTimeout(wTimer);
              const wData = await wRes.json();
              if (wData && Array.isArray(wData.weather)) {
                const cur = wData.current_condition?.[0] || {};
                const curDesc = cur.lang_ko?.[0]?.value || cur.weatherDesc?.[0]?.value || "";
                const fmtDay = (d, label) => {
                  if (!d) return "";
                  const noon = d.hourly?.[4] || d.hourly?.[Math.floor((d.hourly?.length || 1) / 2)] || {};
                  const desc = noon.lang_ko?.[0]?.value || noon.weatherDesc?.[0]?.value || "";
                  return `${label}(${d.date}): ${d.mintempC}~${d.maxtempC}℃, ${desc}, 강수확률 ${noon.chanceofrain ?? "?"}%`;
                };
                wSummary =
                  `[${wLoc} 실시간 날씨]\n현재: ${cur.temp_C ?? "?"}℃, ${curDesc}, 습도 ${cur.humidity ?? "?"}%\n` +
                  [fmtDay(wData.weather[0], "오늘"), fmtDay(wData.weather[1], "내일"), fmtDay(wData.weather[2], "모레")]
                    .filter(Boolean)
                    .join("\n");
              }
            } catch (e) {
              console.error("날씨 조회 실패:", e.message);
            }

            // 3) 자연스럽게 답변
            let wAnswer = "";
            try {
              const wPrompt = `사용자가 "${question}"라고 물었어. 아래 '${wLoc}' 실시간 날씨 데이터를 근거로 친근하고 짧게(2~3문장, 존댓말, 이모지 1개 정도) 답해. 데이터에 없는 내용은 지어내지 마.\n\n${wSummary || "(날씨 데이터를 가져오지 못함)"}`;
              const wgRes = await fetch(gUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: wPrompt }] }], generationConfig: { temperature: 0.7 } }),
              });
              const wgJson = await wgRes.json();
              wAnswer = wgJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
            } catch (e) {
              console.error("날씨 답변 생성 실패:", e.message);
            }
            if (!wAnswer) {
              wAnswer = wSummary
                ? `🌤️ ${wSummary}`
                : `'${wLoc}' 날씨 정보를 가져오지 못했어요. 지역명을 다시 확인해 주실래요? 😅`;
            }
            return res.status(200).json({ success: true, sql: "", rows: [], count: 0, isChat: true, summary: wAnswer });
          }

          // 🏢 거래처 CRM에서 업체 약어(shortName) → 정식명 용어집 동적 생성 (15개 등 전체 자동 반영)
          let compGlossary = "";
          try {
            const [ciRows] = await pool.query(
              `SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`,
            );
            const ciDb = ciRows.length > 0 ? parseJSON(ciRows[0].setting_value) : {};
            const lines = [];
            for (const fullName in ciDb) {
              const sn = (ciDb[fullName] && ciDb[fullName].shortName ? String(ciDb[fullName].shortName) : "").trim();
              if (sn && sn !== fullName) lines.push(`- ${sn} → ${fullName}`);
            }
            if (lines.length > 0) {
              compGlossary =
                `\n\n[출고 업체 약어/별칭 → 정식명] (⚠️ 이건 테이블이 아니라 네가 머릿속에서 약어를 변환하는 참고 목록이야. DB엔 inbound/outbound 두 테이블만 있고 company_alias 같은 별도 테이블은 없어 — 절대 조회/JOIN 하지 마. 약어를 아래 정식명으로 바꾼 뒤 outbound.company 를 LIKE 로 검색해.)\n${lines.join("\n")}\n` +
                `※ 사용자는 정식명·등록약어는 물론, 그 일부·앞글자·변형으로도 부를 수 있어. 공백·'(주)'·'㈜'·괄호·기호 차이는 전부 무시하고, '이름 일부+층수/위치' 조합도 이해해. 예: '메디뱅'→메디뱅크, '위비'→위드비아, '드림'→드림케어, '메디2'·'메디맥2층'·'메디맥 2층'→(주)메디맥 2층. 위 목록에서 가장 알맞은 업체를 찰떡같이 추론해 그 정식명의 핵심부로 company LIKE 검색(층수가 의미있으면 함께 매칭). 애매하면 가장 비슷한 후보로.`;
            }
          } catch (e) {
            console.error("업체 약어 용어집 로드 실패(무시):", e.message);
          }

          // 스키마 정의
          const schema = `
[inbound 테이블 - 입고 데이터]
- id: 고유번호
- bl_number: B/L 번호
- pallets: 팔레트 수 (varchar)
- eta: 예상 입항일 (date)
- receive_date: 실제 입고일 (date)
- fwd: 포워더명
- s_type: 운송 타입 (SEA=해상, AIR=항공)
- invoice: 인보이스 번호
- remarks: 비고
- status: 상태 (입고대기, 완료)
- is_ai_modified: AI수정여부

[outbound 테이블 - 출고 데이터]
- id: 고유번호
- company: 업체명
- pal: 팔레트 수 (varchar)
- box: 박스 수 (varchar)
- outbound_date: 출고일 (date)
- etc: 비고/위치
- isDone: 완료여부 (0=대기, 1=완료)
        `.trim();

          const prompt = `
너는 물류 창고 관리 비서 AI야. 주 업무는 입·출고 DB 조회용 SQL 생성이지만, 일상적인 질문에도 친절하고 똑똑하게 답하는 도우미이기도 해.
오늘 날짜: ${today}
이번 주 시작(일요일): ${getMondayOfWeek(today)}
이번 주 종료(토요일): ${getSaturdayOfWeek(today)}
이번 달: ${today.slice(0, 7)}

[DB 스키마]
${schema}${compGlossary}

[규칙]
1. 데이터 조회 질문이면 SELECT 쿼리만 생성(INSERT/UPDATE/DELETE/DROP 절대 금지) 후 이 형식: {"sql": "SELECT ...", "explanation": "쿼리 설명"}. ⚠️ 오직 inbound·outbound 두 테이블만 사용 — 그 외 테이블(company_alias 등) 참조·JOIN 절대 금지.
2. 데이터 조회와 무관한 질문(인사·잡담·농담·일반상식·일상대화·조언·계산 등 무엇이든)이면 SQL 없이 {"chat": "..."} 형식으로 똑똑하고 친근한 만능 비서처럼 성심껏 답해. '저는 물류 AI라서 모릅니다' 식의 회피·딱딱한 거절은 금지! 아는 건 적극적으로 답하고, 날씨·뉴스처럼 실시간 정보만 "실시간 정보는 확인이 어렵다"고 솔직히 말하되 대화는 따뜻하게 이어가(짧은 팁이나 농담 곁들여도 좋아).
3. 응답은 위 두 JSON 형식 중 하나로만. JSON 외 다른 텍스트 절대 포함 금지.
4. 날짜 계산 시 오늘(${today}) 기준으로 정확하게. 결과가 없을 수 있으니 LIMIT 50 이하로.
5. 이 DB는 MySQL/TiDB임. (a) 숫자 변환은 CAST(컬럼 AS SIGNED) 사용(CAST AS INT 절대 금지). pallets, pal, box는 varchar이므로 SUM 등 연산 시 반드시 CAST(컬럼 AS SIGNED) 적용. (b) 날짜는 MySQL 함수만 사용: YEAR(), MONTH(), DAY(), DATE_FORMAT(), CURDATE(), DATE_SUB/DATE_ADD(날짜 INTERVAL n DAY/MONTH/YEAR). ⚠️ SQLite/기타 함수(strftime, date('now'), datetime 등) 절대 금지. 예) 저번달: YEAR(outbound_date)=YEAR(CURDATE() - INTERVAL 1 MONTH) AND MONTH(outbound_date)=MONTH(CURDATE() - INTERVAL 1 MONTH). (c) 문자열 연결은 CONCAT()(|| 금지), NULL 대체는 IFNULL/COALESCE, 불리언은 1/0. MySQL 표준 구문만.
6. 업체명·포워더(fwd)·B/L·인보이스·비고 등 텍스트 검색은 항상 부분일치 LIKE '%값%' (대소문자 무시: LOWER 비교)로 생성해서, 사용자가 약어·줄임말·일부만 입력하거나 오타가 있어도 최대한 찾게 해. 약어/줄임말은 의도를 추론해 가장 알맞은 컬럼에 매칭.

[데이터 해석 가이드]
- 날짜(eta·receive_date·outbound_date)가 '미정'인 건 NULL로 저장됨. 특정 기간/월 조회 시 NULL은 자동 제외됨. '날짜 미정/안 잡힌 건'을 물으면 해당 컬럼 IS NULL 로 검색.
- 완료/대기 구분: 출고 "나갔다/출고됨/완료"=outbound.isDone=1, "예정/대기/안 나간"=isDone=0. 입고 "입고됨/완료"=inbound.status='완료', "대기/예정"=inbound.status='입고대기'.
- 수량 "몇 개/얼마나"는 기본 팔레트 기준: 출고=SUM(CAST(pal AS SIGNED)), 입고=SUM(CAST(pallets AS SIGNED)). 박스를 물으면 box, 둘 다면 둘 다 보여줘. 건수는 COUNT(*).
- ⚠️ outbound.company엔 실제 출고가 아닌 작업/메모 행도 섞여 있음(company가 '[TASK]'로 시작하거나 폐기·반품·제작·하프·점검·휴무·야근 등). 순수 출고 건수/수량을 물으면 이런 행은 제외(예: AND company NOT LIKE '[TASK]%' AND company NOT REGEXP '폐기|반품|제작|하프|점검|휴무|야근'). 단 사용자가 그 작업 자체를 물으면 포함.

[질문]
${question}
        `.trim();

          // Gemini 호출 — 20초 타임아웃
          const aiCtrl = new AbortController();
          const aiTimer = setTimeout(() => aiCtrl.abort(), 20000);
          let geminiRes;
          try {
            geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY_AI || process.env.GEMINI_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { temperature: 0.0, responseMimeType: "application/json" },
                }),
                signal: aiCtrl.signal,
              },
            );
          } catch (fetchErr) {
            return res.status(200).json({
              success: false,
              msg: fetchErr.name === "AbortError" ? "AI 응답 시간 초과(20초). 잠시 후 다시 시도해주세요." : "AI 서버 오류. 잠시 후 다시 시도해주세요.",
            });
          } finally {
            clearTimeout(aiTimer);
          }
          const geminiJson = await geminiRes.json();
          const aiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!aiText) {
            // 429(할당량) 등 Gemini 에러를 사용자에게 친절히 안내
            const errMsg = geminiJson?.error?.message || "";
            if (geminiJson?.error?.code === 429 || /quota|rate/i.test(errMsg)) {
              return res
                .status(200)
                .json({ success: false, msg: "AI 사용량 한도에 도달했습니다. 잠시 후 다시 시도해주세요." });
            }
            return res.status(200).json({ success: false, msg: "AI 응답이 없습니다." });
          }
          let parsed;
          try {
            // 🚨 수정: rawAiText -> aiText 로 변경
            const cleanText = aiText
              .replace(/```json/gi, "")
              .replace(/```/g, "")
              .trim();
            parsed = JSON.parse(cleanText);
          } catch (e) {
            // 💡 디버깅을 위해 에러 내용을 서버 로그에 찍어보세요
            console.error("AI 응답 파싱 실패, 원본 텍스트:", aiText);
            return res.status(200).json({ success: false, msg: "AI가 올바른 형식으로 응답하지 않았습니다." });
          }

          // 잡담/농담이면 SQL 실행 없이 바로 위트있게 응답 (Gemini 1회로 끝)
          if (parsed.chat && !parsed.sql) {
            return res.status(200).json({
              success: true,
              sql: "",
              rows: [],
              summary: parsed.chat,
              count: 0,
              isChat: true,
            });
          }

          const sql = parsed.sql || "";

          // 🛡️ MySQL 문법 자동 보정: CAST(... AS INT) → SIGNED
          let safeSql = sql.replace(/AS\s+INT\s*\)/gi, "AS SIGNED)");
          // 끝에 붙는 세미콜론은 정상(단일 쿼리)이므로 제거 후 검사 → 중간 세미콜론(다중쿼리)만 차단
          safeSql = safeSql.trim().replace(/;+\s*$/, "");

          // SELECT만 허용 + 세미콜론/다중쿼리 차단
          if (!/^\s*SELECT/i.test(safeSql)) {
            return res.status(200).json({ success: false, msg: "조회 쿼리만 허용됩니다." });
          }
          if (/;/.test(safeSql)) {
            return res.status(200).json({ success: false, msg: "단일 쿼리만 허용됩니다." });
          }
          // 🔒 민감 테이블/파일/스키마 접근 차단 (입·출고 데이터만 허용)
          if (
            /\b(admins|admin_audit_logs|system_settings|processed_images|ocr_store|mysql|information_schema|performance_schema)\b/i.test(
              safeSql,
            ) ||
            /into\s+(outfile|dumpfile)|load_file\s*\(|\bsys\./i.test(safeSql)
          ) {
            return res
              .status(200)
              .json({ success: false, msg: "입·출고 데이터만 조회할 수 있어요. (허용되지 않은 테이블/구문)" });
          }
          // LIMIT 없으면 안전 상한 부여 (과도한 조회 방지)
          if (!/\blimit\b/i.test(safeSql)) safeSql += " LIMIT 100";

          // SQL 실행 (AI가 만든 SQL 문법 오류 등은 실제 메시지로 안내 → 진단/수정 용이)
          let rows;
          try {
            [rows] = await pool.query(safeSql);
          } catch (sqlErr) {
            console.error("AI SQL 실행 오류:", sqlErr.sqlMessage || sqlErr.message, "| SQL:", safeSql);
            return res.status(200).json({
              success: false,
              msg: `조회 중 오류가 났어요 😢\n(${sqlErr.sqlMessage || sqlErr.message})`,
            });
          }

          // 결과 자연어 요약 (위트 있는 톤). 결과가 0건이면 호출 아끼고 코드로 처리
          let summary;
          if (!rows || rows.length === 0) {
            summary = "음... 눈 씻고 찾아봐도 해당하는 데이터가 없네요. 질문을 살짝 바꿔서 다시 물어봐 주실래요? 🔍";
          } else {
            const summaryPrompt = `
너는 물류 창고 데이터를 분석해주는 센스 있는 AI 비서야.
관리자가 "${question}" 라고 물었고, DB 조회 결과는 다음과 같아:
${JSON.stringify(rows, null, 2)}

[답변 스타일 가이드]
- 딱딱한 보고서 말투 금지! 친근하고 위트 있게, 가벼운 농담이나 비유를 섞어도 좋아.
- 관리자가 농담조로 물으면 너도 센스 있게 받아쳐도 돼. 단, 숫자/사실은 정확하게.
- 핵심 숫자는 강조하고, 너무 길지 않게 2~3문장으로.
- 이모지는 1~2개 정도만 자연스럽게.
- 어조는 친한 동료가 데이터 봐주는 느낌으로. 존댓말 유지.

이 결과를 위 스타일로 요약해줘.
            `.trim();

            try {
              const sumCtrl = new AbortController();
              const sumTimer = setTimeout(() => sumCtrl.abort(), 12000);
              let summaryRes;
              try {
                summaryRes = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY_AI || process.env.GEMINI_API_KEY}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      contents: [{ parts: [{ text: summaryPrompt }] }],
                      generationConfig: { temperature: 0.8 },
                    }),
                    signal: sumCtrl.signal,
                  },
                );
              } finally {
                clearTimeout(sumTimer);
              }
              const summaryJson = await summaryRes.json();
              summary = summaryJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
              // 요약 호출이 429 등으로 실패하면 표는 살리고 간단 요약으로 폴백
              if (!summary) {
                const cnt = rows.length;
                summary = `총 ${cnt.toLocaleString()}건 찾았어요! (AI 요약은 잠시 쉬는 중이라 표로 보여드릴게요 😅)`;
              }
            } catch (se) {
              const cnt = rows.length;
              summary = `총 ${cnt.toLocaleString()}건 찾았어요! (AI 요약은 잠시 쉬는 중이라 표로 보여드릴게요 😅)`;
            }
          }

          return res.status(200).json({
            success: true,
            sql: sql,
            rows: rows,
            summary: summary,
            count: rows.length,
          });
        } catch (e) {
          console.error("AI_QUERY 에러:", e);
          console.error("API 처리 오류:", e);
          return res.status(200).json({ success: false, msg: "요청 처리 중 오류가 발생했습니다." });
        }
      } else {
        const targetBL = data?.oldBL || "알수없음";
        const newName = data?.newComp || data?.newBL;
        const newDate = data?.newDate === "미정" ? null : data?.newDate;

        if (action === "DONE" || action === "UNDO_DONE") {
          const statusVal = action === "DONE" ? "완료" : "입고대기";
          const statName = action === "DONE" ? "✅ 완료" : "⏳ 대기(취소)";
          if (data?.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, data.id]);
          else
            await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [
              statusVal,
              data?.oldBL,
              data?.oldDate === "미정" ? null : data?.oldDate,
            ]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)",
            [currentAdmin, `[입고 상태] ${targetBL} (${data?.oldDate || "미정"}) ➡️ ${statName}`],
          );
          notifyCalendarChange(`[입고 상태] ${targetBL} (${data?.oldDate || "미정"}) ➡️ ${statName}`, currentAdmin);
        } else if (action === "DELETE") {
          if (data?.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [data.id]);
          else
            await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [
              data?.oldBL,
              data?.oldDate === "미정" ? null : data?.oldDate,
            ]);
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)",
            [currentAdmin, `[입고 삭제] ${targetBL} (${data?.oldDate || "미정"}) 파기`],
          );
          notifyCalendarChange(`[입고 삭제] ${targetBL} (${data?.oldDate || "미정"}) 파기`, currentAdmin);
        } else if (action === "EDIT") {
          if (data?.id) {
            await pool.query(
              `UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE id=?`,
              [
                newDate,
                newName,
                data?.newPal || "",
                data?.newEtc || "",
                data?.newSType || "",
                data?.newFwd || "",
                (data?.newInvoice || "").trim(),
                data.id,
              ],
            );
          } else {
            await pool.query(
              `UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE bl_number=? AND receive_date<=>?`,
              [
                newDate,
                newName,
                data?.newPal || "",
                data?.newEtc || "",
                data?.newSType || "",
                data?.newFwd || "",
                (data?.newInvoice || "").trim(),
                data?.oldBL,
                data?.oldDate === "미정" ? null : data?.oldDate,
              ],
            );
          }

          // 🚨 [스마트 로그 패치] 입고 변경사항 정밀 추적
          let changes = [];
          const oldD = data?.oldDate || "미정";
          const newD = newDate || "미정";
          if (oldD !== newD) changes.push(`날짜: ${oldD} ➡️ ${newD}`);
          if (targetBL !== newName) changes.push(`B/L: ${targetBL} ➡️ ${newName}`);

          // "" 와 "0" 을 동일하게 취급 (null/empty → 0으로 정규화)
          const oldP = data?.oldPal !== undefined ? String(data.oldPal || 0) : null;
          const newP = String(data?.newPal || 0);
          if (oldP !== null && oldP !== newP) changes.push(`PL: ${oldP} ➡️ ${newP}`);

          // s_type / fwd / invoice 변경 추적 — old 값이 전송된 경우에만 비교 (executeMove 오탐 방지)
          if (data?.oldSType !== undefined && (data.oldSType||"") !== (data?.newSType||"")) changes.push(`타입: ${data.oldSType||"없음"} ➡️ ${data?.newSType||"없음"}`);
          if (data?.oldFwd !== undefined && (data.oldFwd||"") !== (data?.newFwd||"")) changes.push(`포워더: ${data.oldFwd||"없음"} ➡️ ${data?.newFwd||"없음"}`);
          if (data?.oldInvoice !== undefined && String(data.oldInvoice||"").trim() !== String(data?.newInvoice||"").trim()) changes.push(`인보이스: ${data.oldInvoice||"없음"} ➡️ ${data?.newInvoice||"없음"}`);

          // 비고(etc) 변경 추적 — old 값 전송된 경우에만 비교
          if (data?.oldEtc !== undefined) {
            const _oldEtcIn = String(data.oldEtc || "").trim();
            const _newEtcIn = String(data?.newEtc || "").trim();
            if (_oldEtcIn !== _newEtcIn) changes.push(`비고: "${_oldEtcIn||"없음"}"→"${_newEtcIn||"없음"}"`);
          }

          const inLogDesc = `[입고 수정] ${targetBL} (${oldD}) ${changes.length > 0 ? changes.join(", ") : "변경사항 없음"}`;
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)",
            [currentAdmin, inLogDesc],
          );
          if (changes.length > 0) notifyCalendarChange(inLogDesc, currentAdmin);
        } else if (action === "ADD") {
          let reqBl = (data?.newBL || data?.bl || data?.newComp || data?.company || data?.bl_number || "").trim();
          let reqDate =
            data?.newDate !== undefined ? data?.newDate : data?.date !== undefined ? data?.date : data?.receive_date;
          if (reqDate === "미정" || reqDate === "" || !reqDate) reqDate = null;
          else if (typeof reqDate === "string" && reqDate.length > 10) reqDate = reqDate.substring(0, 10);

          let reqInvoice = (data?.newInvoice || data?.invoice || "").trim();
          let reqPal = data?.newPal || data?.pal || data?.pallets || "";
          let reqSType = data?.newSType || data?.sType || data?.s_type || "";
          let reqFwd = data?.newFwd || data?.fwd || "";
          let reqEtc = data?.newEtc || data?.etc || data?.remarks || "";

          let exist = [];
          if (reqInvoice !== "") {
            [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(invoice) = ? AND receive_date <=> ?`, [
              reqInvoice,
              reqDate,
            ]);
          }
          if (exist.length === 0 && reqBl !== "") {
            [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? AND receive_date <=> ?`, [
              reqBl,
              reqDate,
            ]);
          }

          if (exist.length > 0) {
            await pool.query(
              `UPDATE inbound SET bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, is_ai_modified=1 WHERE id=?`,
              [reqBl, reqPal, reqEtc, reqSType, reqFwd, reqInvoice, exist[0].id],
            );
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)",
              [currentAdmin, `[입고 병합] ${reqBl} (${reqDate || "미정"}) ➡️ 덮어쓰기 완료 (PL:${reqPal || 0})`],
            );
            notifyCalendarChange(`[입고 병합] ${reqBl} (${reqDate || "미정"})`, currentAdmin);
          } else {
            await pool.query(
              `INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, 1)`,
              [reqBl, reqPal, reqDate, reqEtc, reqSType, reqFwd, reqInvoice],
            );
            await pool.query(
              "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)",
              [currentAdmin, `[입고 등록] ${reqBl} (${reqDate || "미정"}) 신규 추가 (PL:${reqPal || 0})`],
            );
            notifyCalendarChange(`[입고 등록] ${reqBl} (${reqDate || "미정"}) PL:${reqPal || 0}`, currentAdmin);
          }
        } else if (action === "UPDATE_ORDER" && data?.dailyOrders) {
          let moveCount = 0;
          for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
            let tDate = dateStr === "미정" ? null : dateStr;
            for (const item of orderList) {
              moveCount++;
              if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
              else
                await pool.query(
                  `UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`,
                  [item.sortIdx, item.company, tDate, item.pal],
                );
            }
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)",
            [currentAdmin, `[입고 정렬] 화면 드래그 순서 변경 (${moveCount}건 이동)`],
          );
          notifyCalendarChange(`[입고 정렬] ${Object.keys(data.dailyOrders).map((d) => d === "미정" ? "미정" : String(d).slice(5).replace("-", "/")).join(", ")} 일정 순서 변경 (${moveCount}건)`, currentAdmin);
        } else if (action === "MULTI_DELETE" && data?.items) {
          for (const it of data.items) {
            if (it.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [it.id]);
            else
              await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [
                it.bl,
                it.dateStr === "미정" ? null : it.dateStr,
              ]);
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)",
            [currentAdmin, `[입고 다중삭제] ${(data.items||[]).map(it=>`${(it.bl||"").slice(-6)}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 파기`],
          );
          notifyCalendarChange(`[입고 다중삭제] ${(data.items||[]).map(it=>`${(it.bl||"").slice(-6)}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 파기`, currentAdmin);
        } else if ((action === "MULTI_DONE" || action === "MULTI_UNDO_DONE") && data?.items) {
          const statusVal = action === "MULTI_DONE" ? "완료" : "입고대기";
          const statName = action === "MULTI_DONE" ? "✅ 완료" : "⏳ 대기(취소)";
          for (const it of data.items) {
            if (it.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, it.id]);
            else
              await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [
                statusVal,
                it.bl,
                it.dateStr === "미정" ? null : it.dateStr,
              ]);
          }
          await pool.query(
            "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)",
            [currentAdmin, `[입고 다중상태] ${(data.items||[]).map(it=>`${(it.bl||"").slice(-6)}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 ➡️ ${statName}`],
          );
          notifyCalendarChange(`[입고 다중상태] ${(data.items||[]).map(it=>`${(it.bl||"").slice(-6)}(${(it.dateStr||"미정").slice(5).replace("-","/")})`).join(", ")} ${data.items.length}건 ➡️ ${statName}`, currentAdmin);
        }
        return res.status(200).json({ success: true, msg: "작업 완료" });
      }
    }
  } catch (error) {
    console.error("🔥 API 에러:", error);
    res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
  }
};
