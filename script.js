// ── [H] 운영 환경 콘솔 침묵 (localhost 에서만 로그 출력) ──
(function () {
  try {
    var h = location.hostname;
    if (!(h === "localhost" || h === "127.0.0.1" || h === "")) {
      console.log = function () {};
      console.warn = function () {};
      // console.error 는 진짜 에러 추적용으로 유지
    }
  } catch (e) {}
})();

// ── 0. 전역 변수 (이름 충돌 방지를 위해 fabDragging 사용)
window.fabDragging = false;

// ═══════════════════════════════════════════════
// ── 1. AI 질의 기능
// ═══════════════════════════════════════════════
// 대화 저장 키 (출고/입고 분리)
function _aiChatKey() {
  var t = typeof currentType !== "undefined" ? currentType : "out";
  return "ai_chat_history_" + t;
}

function openAiQuery() {
  if (window.fabDragging) return;
  const modal = document.getElementById("aiQueryModal");
  if (!modal) return;
  modal.style.display = "flex";
  // 열 때 항상 초기화 (엔진/✕/배경 어떤 방식으로 닫혔든 칩·패널 정상화)
  const chipRow = document.getElementById("ai-chip-row");
  if (chipRow) chipRow.style.display = "flex";
  const panel = modal.firstElementChild;
  if (panel) {
    panel.style.transform = "";
    panel.style.transition = "";
    panel.style.maxHeight = "";
  }
  renderAiChatHistory(); // 저장된 대화 복원
  _attachKeyboardHandling();
  // 자동 포커스 안 함 (열자마자 키보드 뜨는 어색함 방지). 사용자가 입력창 탭하면 키보드 올라옴.
  // 대화가 있으면 맨 아래(최신)로 스크롤
  const log = document.getElementById("ai-chat-log");
  if (log)
    setTimeout(() => {
      log.scrollTop = log.scrollHeight;
    }, 100);
}

// 상단(핸들/헤더)을 아래로 끌면 모달 닫기 (다른 모달과 동일 UX)

// 입력창 포커스 시 살짝 아래로 스크롤해 보이게만 함 (기존 모달과 동일하게 OS가 키보드 처리)
function _scrollInputIntoView() {
  const log = document.getElementById("ai-chat-log");
  // 키보드가 올라오면 대화 맨 아래(최신)로 — 가장 자연스러움
  if (log)
    setTimeout(() => {
      log.scrollTop = log.scrollHeight;
    }, 350);
}

// 단순화: 입력창 포커스 시 칩만 접어 공간 확보 (키보드는 OS가 처리)
function _attachKeyboardHandling() {
  const inp = document.getElementById("ai-question-input");
  if (!inp || inp._focusBound) return;
  inp._focusBound = true;
  const chipRow = document.getElementById("ai-chip-row");
  inp.addEventListener("focus", () => {
    if (chipRow) chipRow.style.display = "none"; // 입력 시작하면 칩 접기
    _scrollInputIntoView();
  });
  inp.addEventListener("blur", () => {
    if (chipRow) chipRow.style.display = "flex"; // 입력 끝나면 칩 복원
  });
}

// 저장된 대화를 말풍선으로 복원
function renderAiChatHistory() {
  const log = document.getElementById("ai-chat-log");
  if (!log) return;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(_aiChatKey()) || "[]");
  } catch (e) {}
  log.innerHTML = "";
  if (history.length === 0) {
    log.style.display = "none";
    return;
  }
  log.style.display = "block";
  history.forEach((msg) => log.appendChild(_buildBubble(msg)));
  // 맨 아래로 스크롤
  setTimeout(() => {
    log.scrollTop = log.scrollHeight;
  }, 50);
}

// 대화 1건을 localStorage 에 추가 저장 (최근 30건만 유지)
function _saveAiMessage(msg) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(_aiChatKey()) || "[]");
  } catch (e) {}
  history.push(msg);
  if (history.length > 30) history = history.slice(-30);
  try {
    localStorage.setItem(_aiChatKey(), JSON.stringify(history));
  } catch (e) {}
}

// 말풍선 DOM 생성 (msg: {role:'user'|'ai', text, rows, sql, count, isError})
function _buildBubble(msg) {
  const wrap = document.createElement("div");
  wrap.className = "ai-bubble-in";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";

  if (msg.role === "user") {
    wrap.style.alignItems = "flex-end";
    const b = document.createElement("div");
    b.style.cssText =
      "max-width:80%; background:linear-gradient(135deg,#6e6cf0,#bf5af2); color:#fff; padding:11px 15px; border-radius:18px 18px 5px 18px; box-shadow:0 2px 10px rgba(110,108,240,0.3); font-size:0.9em; word-break:break-word;";
    b.textContent = msg.text;
    wrap.appendChild(b);
  } else {
    wrap.style.alignItems = "flex-start";
    const b = document.createElement("div");
    if (msg.isError) {
      b.style.cssText =
        "max-width:90%; background:rgba(255,59,48,0.12); color:#ff6b6b; padding:12px 15px; border-radius:18px 18px 18px 5px; font-size:0.9em; word-break:break-word; line-height:1.5;";
    } else {
      b.className = "ai-ans-bubble";
      b.style.cssText =
        "max-width:90%; background:rgba(120,120,128,0.16); color:var(--text-main, #fff); padding:12px 15px; border-radius:18px 18px 18px 5px; font-size:0.9em; word-break:break-word; line-height:1.5;";
    }
    b.textContent = msg.text || "";
    wrap.appendChild(b);

    // 데이터 표가 있으면 말풍선 아래에 붙임
    if (msg.rows && msg.rows.length > 0) {
      const tableWrap = document.createElement("div");
      tableWrap.style.cssText =
        "margin-top:8px; max-width:100%; overflow-x:auto; border-radius:10px; border:1px solid #333;";
      const cols = Object.keys(msg.rows[0]);
      let html =
        '<div style="padding:6px 8px; font-size:0.7em; border-bottom:1px solid #333; display:flex; justify-content:space-between; color:#888;">';
      html += "<span>" + (msg.count || msg.rows.length) + "건 조회됨</span>";
      if (msg.sql) html += '<span class="ai-sql-mini" style="cursor:pointer; color:#5e5ce6;">SQL</span>';
      html += "</div>";
      if (msg.sql)
        html +=
          '<div class="ai-sql-mini-box" style="display:none; padding:8px; font-size:0.7em; color:#bf5af2; background:rgba(0,0,0,0.3); white-space:pre-wrap; word-break:break-all;">' +
          _escTbl(msg.sql) +
          "</div>";
      html += '<table style="width:100%; border-collapse:collapse; font-size:0.78em;"><thead><tr>';
      html += cols
        .map(
          (c) =>
            '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #444; color:#aaa; white-space:nowrap;">' +
            _escTbl(c) +
            "</th>",
        )
        .join("");
      html += "</tr></thead><tbody>";
      msg.rows.forEach((row, i) => {
        html += '<tr style="background:' + (i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.03)") + '">';
        cols.forEach((c) => {
          html +=
            '<td style="padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.05); white-space:nowrap;">' +
            _escTbl(row[c]) +
            "</td>";
        });
        html += "</tr>";
      });
      html += "</tbody></table>";
      tableWrap.innerHTML = html;
      // SQL 토글
      const toggle = tableWrap.querySelector(".ai-sql-mini");
      const sqlBox = tableWrap.querySelector(".ai-sql-mini-box");
      if (toggle && sqlBox)
        toggle.addEventListener("click", () => {
          sqlBox.style.display = sqlBox.style.display === "none" ? "block" : "none";
        });
      wrap.appendChild(tableWrap);
    }
  }
  return wrap;
}

// AI 테이블 전용 이스케이프 (null → '-' 표시)
function _escTbl(v) {
  if (v === null || v === undefined) return "-";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 대화 지우기
function clearAiChat() {
  try {
    localStorage.removeItem(_aiChatKey());
  } catch (e) {}
  const log = document.getElementById("ai-chat-log");
  if (log) {
    log.innerHTML = "";
    log.style.display = "none";
  }
}

function closeAiQuery() {
  const modal = document.getElementById("aiQueryModal");
  if (modal) {
    const panel = modal.firstElementChild;
    if (panel) {
      panel.style.transform = "";
      panel.style.maxHeight = "";
      panel.style.height = "";
      panel.style.transition = "";
    } // 보정/스와이프 초기화
    const chipRow = document.getElementById("ai-chip-row");
    if (chipRow) chipRow.style.display = "flex"; // 칩 복원
    modal.style.display = "none";
  }
}

function setAiQuestion(el) {
  const input = document.getElementById("ai-question-input");
  if (!input) return;
  // data-q 가 있으면 그 명확한 질문을, 없으면 보이는 라벨을 사용
  const q = el.getAttribute("data-q") || el.textContent.replace(/^[^\uAC00-\uD7A3a-zA-Z0-9]+/, "").trim();
  input.value = q;
  input.focus();
  _scrollInputIntoView();
}

async function runAiQuery() {
  const inputEl = document.getElementById("ai-question-input");
  if (!inputEl || !inputEl.value.trim()) return;
  const question = inputEl.value.trim();
  inputEl.value = "";

  const log = document.getElementById("ai-chat-log");
  const loading = document.getElementById("ai-loading");
  const sendBtn = document.getElementById("ai-send-btn");
  if (!log) return;

  // 1) 사용자 말풍선 즉시 추가 + 저장
  log.style.display = "block";
  const userMsg = { role: "user", text: question };
  log.appendChild(_buildBubble(userMsg));
  _saveAiMessage(userMsg);
  log.scrollTop = log.scrollHeight;

  if (loading) loading.style.display = "block";
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "...";
  }

  try {
    const adminId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id");
    // 보안 액션은 session_token 필수(토큰 폴백 제거됨). apiCall을 안 거치는 raw fetch라 직접 첨부.
    const sessionToken =
      window._sessionToken || localStorage.getItem("session_token") || sessionStorage.getItem("session_token");
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "AI_QUERY", admin_id: adminId, session_token: sessionToken, data: { question } }),
    });
    const result = await res.json();
    if (loading) loading.style.display = "none";

    let aiMsg;
    if (!result.success) {
      aiMsg = { role: "ai", text: "⚠️ " + (result.msg || "오류가 발생했습니다."), isError: true };
    } else if (result.isChat) {
      // 잡담/농담 → 답변만
      aiMsg = { role: "ai", text: result.summary };
    } else {
      // 데이터 질의 → 요약 + 표
      aiMsg = { role: "ai", text: result.summary, rows: result.rows, sql: result.sql, count: result.count };
    }

    log.appendChild(_buildBubble(aiMsg));
    _saveAiMessage(aiMsg);
    log.scrollTop = log.scrollHeight;
  } catch (e) {
    console.error("AI_QUERY 에러:", e);
    if (loading) loading.style.display = "none";
    const errMsg = { role: "ai", text: "⚠️ 네트워크 오류가 발생했습니다.", isError: true };
    log.appendChild(_buildBubble(errMsg));
    _saveAiMessage(errMsg);
    log.scrollTop = log.scrollHeight;
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "전송";
    }
    inputEl.focus();
  }
}

// 잔상 없이 즉시 메뉴 닫기 (transition 끄고 숨긴 뒤 다음 프레임에 원복)
function _closeFabMenuInstant(wrapper) {
  if (!wrapper || !wrapper.classList.contains("open")) return;
  const container = wrapper.querySelector(".fab-sub-container");
  if (container) {
    container.style.transition = "none";
    container.style.opacity = "0";
    container.style.visibility = "hidden";
  }
  wrapper.classList.remove("open");
  if (container) {
    requestAnimationFrame(() => {
      // 드래그 중이 아닐 때만 원복 (드래그 중엔 :not(.open) CSS가 숨김 처리)
      if (!window.fabDragging) {
        container.style.transition = "";
        container.style.opacity = "";
        container.style.visibility = "";
      }
    });
  }
}

function toggleFabMenu() {
  if (window.fabDragging) return; // 드래그 직후 메뉴 안 열리게
  const wrapper = document.getElementById("fabBtn");
  if (!wrapper) return;
  if (wrapper.classList.contains("open")) {
    _closeFabMenuInstant(wrapper); // 닫기: 잔상 방지
  } else {
    wrapper.classList.add("open"); // 열기: CSS 애니메이션 사용
  }
}

// ═══════════════════════════════════════════════
// ── 3. FAB 드래그 (가장자리 스냅 + 메뉴방향 자동전환)
// ═══════════════════════════════════════════════
function initDraggableFab() {
  const fabOut = document.getElementById("fabBtn"); // 출고: 부채꼴 메뉴 있음
  const fabIn = document.getElementById("inboundAiFab"); // 입고: 단일 버튼

  if (fabOut) _attachDrag(fabOut, "outboundFabPos", true);
  if (fabIn) _attachDrag(fabIn, "inboundFabPos", false);
}

function _attachDrag(fab, storageKey, hasMenu) {
  _restorePos(fab, storageKey, hasMenu);

  let startX,
    startY,
    baseStartLeft,
    baseStartTop,
    dragged = false;
  let offX = 0,
    offY = 0; // wrapper(left/top) 와 버튼본체(.fab-main) 의 좌표 차이
  const THRESHOLD = 8;

  // 버튼 본체의 화면상 좌상단 좌표
  const getBaseRect = () => {
    const main = hasMenu ? fab.querySelector(".fab-main") : null;
    return main ? main.getBoundingClientRect() : fab.getBoundingClientRect();
  };

  let rafId = null;
  let pendingBaseLeft = 0,
    pendingBaseTop = 0;
  const applyMove = () => {
    rafId = null;
    const btn = _btnSize(fab, hasMenu);
    const PAD = 0;
    // 본체 기준으로 화면 경계 클램프
    const clampedBaseLeft = Math.max(PAD, Math.min(pendingBaseLeft, window.innerWidth - btn.w - PAD));
    const clampedBaseTop = Math.max(PAD, Math.min(pendingBaseTop, window.innerHeight - btn.h - PAD));
    // wrapper 의 left/top = 본체 좌표 - offset (라벨이 왼/위로 뻗은 만큼 보정)
    fab.style.setProperty("left", clampedBaseLeft - offX + "px", "important");
    fab.style.setProperty("top", clampedBaseTop - offY + "px", "important");
  };

  const moveTo = (clientX, clientY) => {
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (!dragged && Math.sqrt(dx * dx + dy * dy) > THRESHOLD) {
      dragged = true;
      window.fabDragging = true;
      if (hasMenu) _closeFabMenuInstant(fab); // 드래그 시작 시 잔상 없이 닫기
      if (!hasMenu) fab.style.setProperty("transition", "none", "important"); // 단일버튼: 드래그 중 transition 제거로 부드럽게
      // 드래그 확정 순간: 본체 기준 시작좌표 + offset 확정 후 left/top 모드로 전환
      const wrapRect = fab.getBoundingClientRect();
      const baseRect = getBaseRect();
      offX = baseRect.left - wrapRect.left;
      offY = baseRect.top - wrapRect.top;
      baseStartLeft = baseRect.left;
      baseStartTop = baseRect.top;
      fab.style.setProperty("position", "fixed", "important");
      fab.style.setProperty("right", "auto", "important");
      fab.style.setProperty("bottom", "auto", "important");
    }
    if (!dragged) return false;
    pendingBaseLeft = baseStartLeft + dx;
    pendingBaseTop = baseStartTop + dy;
    if (rafId === null) rafId = requestAnimationFrame(applyMove);
    return true;
  };

  const endDrag = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (dragged) {
      if (!hasMenu) fab.style.removeProperty("transition"); // snap 애니메이션은 CSS transition으로 복구
      _snapToEdge(fab, hasMenu);
      _savePos(fab, storageKey);
      // 드래그 중 닫기로 남은 인라인 스타일 원복 (다음 메뉴 열기 정상화)
      if (hasMenu) {
        const c = fab.querySelector(".fab-sub-container");
        if (c) {
          c.style.transition = "";
          c.style.opacity = "";
          c.style.visibility = "";
        }
      }
    }
    setTimeout(() => {
      window.fabDragging = false;
    }, 150);
  };

  // 터치
  fab.addEventListener(
    "touchstart",
    (e) => {
      e.stopPropagation();
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dragged = false;
      window.fabDragging = false;
    },
    { passive: false },
  );

  fab.addEventListener(
    "touchmove",
    (e) => {
      e.stopPropagation();
      const t = e.touches[0];
      const moved = moveTo(t.clientX, t.clientY);
      if (moved) e.preventDefault();
    },
    { passive: false },
  );

  fab.addEventListener("touchend", (e) => {
    e.stopPropagation();
    endDrag();
  });
  fab.addEventListener("touchcancel", (e) => {
    e.stopPropagation();
    endDrag();
  });

  // 마우스 (PC)
  fab.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    dragged = false;
    window.fabDragging = false;

    const onMove = (e) => moveTo(e.clientX, e.clientY);
    const onUp = () => {
      endDrag();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // 클릭 처리 (입고 단일버튼만)
  if (!hasMenu) {
    fab.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        if (window.fabDragging) {
          e.preventDefault();
          return;
        }
        openAiQuery();
      },
      false,
    );
  }
}

function _btnSize(fab, hasMenu) {
  if (hasMenu) {
    const main = fab.querySelector(".fab-main");
    if (main) {
      const r = main.getBoundingClientRect();
      return { w: r.width || 60, h: r.height || 60 };
    }
    return { w: 60, h: 60 };
  }
  return { w: fab.offsetWidth || 60, h: fab.offsetHeight || 60 };
}

function _setAbsolute(fab) {
  // wrapper 전체가 아니라 버튼 본체(.fab-main) 위치를 기준으로 left/top 고정
  const main = fab.querySelector(".fab-main");
  const wrapRect = fab.getBoundingClientRect();
  const baseRect = main ? main.getBoundingClientRect() : wrapRect;
  // 본체 left - (wrapper left와의 차이) 보정: wrapper의 left를 본체 left에 맞춤
  // width:max-content + 라벨이 왼쪽으로 뻗은 경우 wrapRect.left가 라벨 끝이므로 그 차이만큼 빼줌
  const offsetX = baseRect.left - wrapRect.left;
  fab.style.setProperty("position", "fixed", "important");
  fab.style.setProperty("left", baseRect.left - offsetX + "px", "important");
  fab.style.setProperty("top", baseRect.top + "px", "important");
  fab.style.setProperty("right", "auto", "important");
  fab.style.setProperty("bottom", "auto", "important");
}

function _snapToEdge(fab, hasMenu) {
  const btn = _btnSize(fab, hasMenu);

  // 1) 먼저 본체 중심으로 좌/우, 상/하 방향 판정
  const baseRect0 =
    (hasMenu ? fab.querySelector(".fab-main")?.getBoundingClientRect() : null) || fab.getBoundingClientRect();
  const cx = baseRect0.left + btn.w / 2;
  const cy = baseRect0.top + btn.h / 2;
  const isLeft = cx < window.innerWidth / 2;
  const isBottom = cy > window.innerHeight / 2;
  const PAD = 12;

  // 2) 🚨 방향 클래스를 '먼저' 적용해서 메뉴 펼침 방향(=wrapper 모양)을 확정
  if (hasMenu) {
    fab.classList.toggle("snap-left", isLeft);
    fab.classList.toggle("snap-right", !isLeft);
    fab.classList.toggle("snap-bottom", isBottom);
    fab.classList.toggle("snap-top", !isBottom);
  }

  // 3) 클래스 적용 후 강제 reflow → 바뀐 레이아웃 기준으로 offset 재측정
  void fab.offsetWidth;

  const wrapRect = fab.getBoundingClientRect();
  const baseRect = (hasMenu ? fab.querySelector(".fab-main")?.getBoundingClientRect() : null) || wrapRect;
  const offY = baseRect.top - wrapRect.top;

  // 4) 세로 위치: 현재 본체 위치 유지 + 화면 안 보정
  const baseTop = Math.max(PAD, Math.min(baseRect.top, window.innerHeight - btn.h - PAD));
  fab.style.setProperty("top", baseTop - offY + "px", "important");
  fab.style.setProperty("bottom", "auto", "important");

  // 5) 좌우 고정 (바뀐 클래스 기준으로 측정된 값 사용)
  if (isLeft) {
    const offX = baseRect.left - wrapRect.left;
    fab.style.setProperty("left", PAD - offX + "px", "important");
    fab.style.setProperty("right", "auto", "important");
  } else {
    const offRight = wrapRect.right - baseRect.right;
    fab.style.setProperty("right", PAD - offRight + "px", "important");
    fab.style.setProperty("left", "auto", "important");
  }
}

function _savePos(fab, key) {
  const isLeftSnap = fab.classList.contains("snap-left") || (fab.style.left && fab.style.left !== "auto");
  localStorage.setItem(
    key,
    JSON.stringify({
      // 오른쪽 고정이면 right 값을, 왼쪽 고정이면 left 값을 저장
      side: fab.style.right && fab.style.right !== "auto" ? "right" : "left",
      left: fab.style.left,
      right: fab.style.right,
      top: fab.style.top,
      snapLeft: fab.classList.contains("snap-left"),
      snapBottom: fab.classList.contains("snap-bottom"),
    }),
  );
}

function _restorePos(fab, key, hasMenu) {
  const saved = localStorage.getItem(key);
  if (!saved) return;
  try {
    const pos = JSON.parse(saved);
    const t = parseInt(pos.top);
    if (isNaN(t)) return;
    // 세로 화면 밖이면 저장값 폐기
    if (t < 0 || t > window.innerHeight - 20) {
      localStorage.removeItem(key);
      return;
    }

    fab.style.setProperty("position", "fixed", "important");
    fab.style.setProperty("top", pos.top, "important");
    fab.style.setProperty("bottom", "auto", "important");

    // side 정보로 좌우 고정 방식 복원
    if (pos.side === "right" && pos.right && pos.right !== "auto") {
      fab.style.setProperty("right", pos.right, "important");
      fab.style.setProperty("left", "auto", "important");
    } else {
      const l = parseInt(pos.left);
      if (isNaN(l) || l < 0 || l > window.innerWidth - 20) {
        localStorage.removeItem(key);
        return;
      }
      fab.style.setProperty("left", pos.left, "important");
      fab.style.setProperty("right", "auto", "important");
    }

    if (hasMenu) {
      fab.classList.toggle("snap-left", !!pos.snapLeft);
      fab.classList.toggle("snap-right", !pos.snapLeft);
      fab.classList.toggle("snap-bottom", !!pos.snapBottom);
      fab.classList.toggle("snap-top", !pos.snapBottom);
    }
  } catch (e) {
    localStorage.removeItem(key);
  }
}

// ═══════════════════════════════════════════════
// ── 4. 관리자 확인 후 FAB 표시
// ═══════════════════════════════════════════════
function showAiFabIfAdmin() {
  const isAdminFlag =
    window.isAdmin === true ||
    localStorage.getItem("isAdmin") === "true" ||
    sessionStorage.getItem("isAdmin") === "true";

  const fabBtn = document.getElementById("fabBtn");
  if (fabBtn && isAdminFlag) {
    const isMulti = typeof isMultiMode !== "undefined" && isMultiMode;
    if (!isMulti) fabBtn.style.display = "flex";
    const aiSub = document.getElementById("fab-sub-ai-wrap");
    if (aiSub) aiSub.style.display = "flex";
  }

  const inboundFab = document.getElementById("inboundAiFab");
  if (inboundFab) {
    if (isAdminFlag) {
      const isMulti = typeof isMultiMode !== "undefined" && isMultiMode;
      if (!isMulti) inboundFab.style.display = "flex";
    } else {
      inboundFab.style.display = "none";
    }
  }
}

// ═══════════════════════════════════════════════
// ── [E] 오래된 로컬 캐시 정리 (12개월 초과분 삭제)
// ═══════════════════════════════════════════════
function cleanOldCache() {
  try {
    var now = new Date();
    var curYM = now.getFullYear() * 12 + now.getMonth();
    var KEEP_MONTHS = 12;
    var removed = 0;
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    keys.forEach(function (k) {
      if (!k) return;
      var m1 = k.match(/^cal_cache_\w+_(\d{4})_(\d{1,2})$/);
      var m2 = k.match(/^yearly_stats_cache_\w+_(\d{4})$/);
      if (m1) {
        var ym = parseInt(m1[1]) * 12 + (parseInt(m1[2]) - 1);
        if (Math.abs(curYM - ym) > KEEP_MONTHS) {
          localStorage.removeItem(k);
          removed++;
        }
      } else if (m2) {
        var y = parseInt(m2[1]);
        if (Math.abs(now.getFullYear() - y) > 1) {
          localStorage.removeItem(k);
          removed++;
        }
      }
    });
  } catch (e) {}
}

// ═══════════════════════════════════════════════
// ── 5. 초기화
// ═══════════════════════════════════════════════
// ♿ 아이콘 전용 버튼에 스크린리더용 라벨 부여 (기호/이모지뿐이라 음성 안내가 안 되던 버튼들)
//    selector가 해당 페이지에 없으면 그냥 건너뜀(출고/입고 공용 안전)
function initA11yLabels() {
  const setLabel = (sel, label) =>
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", label);
    });
  setLabel(".close-btn", "닫기");
  setLabel(".fab-main", "빠른 작업 메뉴");
  setLabel(".fab-sub-btn.ai", "AI 질의");
  setLabel(".fab-sub-btn.add", "신규 등록");
  setLabel("#compInfoBtn", "거래처 정보");
}

document.addEventListener("DOMContentLoaded", () => {
  cleanOldCache();
  initDraggableFab();
  showAiFabIfAdmin();
  initA11yLabels();
});
