// ====================================================================
// 🚀 [Vercel 독립 생명유지장치] 구글 서버가 몰래 주던 변수들을 직접 생성!
// ====================================================================
let currentType = "in"; // 🟢 입고 달력 (출고는 'out'으로 변경)
let isAdmin = false;
let adminToken = null;
let todayDateObj = new Date();
let lastLocalUpdateTime = 0;
let isDarkMode = false; // 다크모드 충돌 방지

// 📋 칩 하단 표시: B/L 끝4자리 ↔ 인보이스 끝4자리 토글
let blDisplayMode = localStorage.getItem("blDisplayMode") === "invoice" ? "invoice" : "bl";
function toggleBlDisplayMode() {
  blDisplayMode = blDisplayMode === "bl" ? "invoice" : "bl";
  localStorage.setItem("blDisplayMode", blDisplayMode);
  if (typeof renderCalendar === "function") renderCalendar();
  if (typeof renderPcLeftbar === "function") renderPcLeftbar();
  syncBlToggleUI();
  // 토글 직후 칩 숫자에 '값 변경' 플립 애니메이션 — 새로 그려진 .bl-sub에 클래스 부여
  requestAnimationFrame(() => {
    document.querySelectorAll(".bl-sub").forEach((el) => el.classList.add("num-flip"));
  });
}
// 토글 스위치 UI(모바일·PC) 상태 동기화
function syncBlToggleUI() {
  const isInv = blDisplayMode === "invoice";
  document.querySelectorAll(".bl-toggle").forEach((el) => el.classList.toggle("on", isInv));
}
// 칩 하단에 보여줄 끝4자리(현재 모드 기준) 계산
function chipSubText(item) {
  if (blDisplayMode === "invoice") {
    const inv = (item.invoice || "").trim();
    if (!inv) return "—"; // 인보이스 없음
    return inv.length > 4 ? inv.slice(-4) : inv;
  }
  if (item.bl && item.bl.startsWith("발행전")) return "발행전";
  return item.bl && item.bl.length > 4 ? item.bl.slice(-4) : item.bl || "";
}

// 텅 빈 달력 뼈대를 미리 만들어줍니다.
let serverData = {
  year: todayDateObj.getFullYear(),
  month: todayDateObj.getMonth() + 1,
  firstDay: new Date(todayDateObj.getFullYear(), todayDateObj.getMonth(), 1).getDay(),
  daysInMonth: new Date(todayDateObj.getFullYear(), todayDateObj.getMonth() + 1, 0).getDate(),
  monthData: {},
  pendingItems: [],
};
window.yearlyHolidays = {};

// 누락되었던 공휴일 통신 함수 복구

// 💡 [추가] 공휴일 이름 표시 ON/OFF 상태 (기본값 ON)
let isShowHoliday = localStorage.getItem("cal_show_holiday") !== "false";

// 💡 [추가] 공휴일 토글 실행 함수

// (폴리필 -> common-core.js 로 분리됨)

let activeRequests = 0;


function updateFooterUI() {
  const footer = document.getElementById("infoFooter");
  if (footer) {
    footer.innerText = isAdmin
      ? "👆 날짜 터치: 상세내역 확인 및 수정 / 꾹 누르기: 이동"
      : "👆 날짜 터치: 상세내역 확인";
  }
}

function computeWeekHeights() {
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (serverData.monthData[d]) {
      serverData.monthData[d].forEach((item, idx) => {
        item._rawIdx = idx;
      });
    }
  }

  // 🚨 [입고 지능형 가변 높이 엔진] - 초밀착 정렬형
  let weekHeights = {};
  let savedSize = localStorage.getItem("cal_fontSize") || "M";
  let charsPerLine = savedSize === "L" ? 4 : 5; // 글자 크기에 따른 줄바꿈 기준

  for (let d = 1; d <= serverData.daysInMonth; d++) {
    let wIdx = Math.floor((serverData.firstDay + d - 1) / 7);
    if (!weekHeights[wIdx]) weekHeights[wIdx] = "auto";

    let dYmd = _ymd(serverData.year, serverData.month, d);
    let hName = window.yearlyHolidays ? window.yearlyHolidays[dYmd] : null;
    let hasSched = serverData.monthData[d] && serverData.monthData[d].length > 0;

    // 공휴일에 입고 일정이 있을 때만! 그 주차(Week)의 헤더 높이를 통일함
    // 🛠️ 수정 후 (isShowHoliday 조건 추가)
    if (hName && hasSched && isShowHoliday) {
      let linesNeeded = Math.ceil(hName.length / charsPerLine);
      // 입고 레이아웃(1.0 + 공휴일줄)에 최적화된 수치 적용
      let calcH = (1.0 + linesNeeded * 0.75).toFixed(2) + "em";

      if (weekHeights[wIdx] === "auto" || parseFloat(weekHeights[wIdx]) < parseFloat(calcH)) {
        weekHeights[wIdx] = calcH;
      }
    }
  }

  return weekHeights;
}

function renderPending() {
  // 💡 [수정] 미정건 전역 상태 유지 로직 확실하게 고정
  if (serverData.pendingItems && serverData.pendingItems.length > 0) {
    window.globalPendingItems = serverData.pendingItems;
  } else if (window.globalPendingItems && window.globalPendingItems.length > 0) {
    serverData.pendingItems = window.globalPendingItems;
  }
  let currentPending = serverData.pendingItems || [];

  if (currentPending.length > 0) {
    document.getElementById("pendingSection").style.display = "block";
    document.getElementById("pendingCount").innerText = `(${currentPending.length}건)`;
    let pListHtml = "";
    currentPending.forEach((item, idx) => {
      let meaningfulEtc = item.etc
        ? item.etc.replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고완료)\]/g, "").trim()
        : "";
      let etcTag = meaningfulEtc !== "" ? `<div class="pending-etc">${_esc(meaningfulEtc)}</div>` : "";
      let isItemDone = item.isDone === true || String(item.isDone) === "true";
      let bindPending = `onmousedown="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="handleItemClick(event, 'pending', ${idx}, '${_argq(item.bl)}', ${isItemDone})"`;
      let checkIcon = isItemDone ? '<span style="font-size:0.9em; margin-right:4px;">✅</span>' : "";

      let isPendingAir = item.sType === "AIR";
      let pendingPastelBg = isPendingAir ? "#ff7eff" : "#26e2fd";
      let circleHtml = `<div style="width:12px; height:12px; border-radius:50%; background:${pendingPastelBg}; margin-right:8px; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>`;

      pListHtml += `<div class="pending-item" id="main-pending-${idx}" ${bindPending}><div style="display:flex; align-items:center; width:100%; pointer-events:none;">${circleHtml}<div class="pending-comp">${checkIcon}${_esc(item.bl)}</div><div class="pending-vol">📦 ${_esc(item.pal)}P (${_esc(item.sType)})</div>${etcTag}</div></div>`;
    });
    document.getElementById("pendingList").innerHTML = pListHtml;
  } else {
    document.getElementById("pendingSection").style.display = "none";
  }
}

function renderCalendar() {
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (serverData.monthData[d]) {
      serverData.monthData[d].forEach((item, idx) => {
        item._rawIdx = idx;
      });
    }
  }
  const weekHeights = computeWeekHeights();

  document.getElementById("calTitle").innerText =
    `${String(serverData.year).slice(2)}.${String(serverData.month).padStart(2, "0")}`;
  const grid = document.getElementById("calendarGrid");
  let rowHtml = '<div class="grid-row">';
  let cellCount = 0;
  for (let i = 0; i < serverData.firstDay; i++) {
    rowHtml += `<div class="day-cell empty"></div>`;
    cellCount++;
  }

  const isThisMonthView =
    serverData.year === todayDateObj.getFullYear() && serverData.month === todayDateObj.getMonth() + 1;
  const todayDayNumber = todayDateObj.getDate();

  for (let day = 1; day <= serverData.daysInMonth; day++) {
    if (cellCount > 0 && cellCount % 7 === 0) rowHtml += '</div><div class="grid-row">';
    const dayOfWeek = (serverData.firstDay + day - 1) % 7;
    let dateClass = "date-num";
    if (dayOfWeek === 0) dateClass += " sun";
    if (dayOfWeek === 6) dateClass += " sat";
    let cellClass = isThisMonthView && day === todayDayNumber ? "day-cell today-cell" : "day-cell";
    let dayData = serverData.monthData[day];
    let bindCell = `onmousedown="startPress(event, 'cell', ${day})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="startPress(event, 'cell', ${day})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="handleCellClick(event, ${day})"`;
    let currentYmd = _ymd(serverData.year, serverData.month, day);

    let holidayName = window.yearlyHolidays ? window.yearlyHolidays[currentYmd] : null;
    let isHoliday = !!holidayName;
    let redStyle = dayOfWeek === 0 || isHoliday ? "color: #ff3b30 !important; font-weight: bold;" : "";

    let w = Math.floor((serverData.firstDay + day - 1) / 7);
    let currentHeaderHeight = weekHeights[w];

    // 일정이 없는 공휴일은 공간 절약을 위해 auto로 찰싹 붙임
    if (isHoliday && (!dayData || dayData.length === 0)) {
      currentHeaderHeight = "auto";
    }

    // 🚨 [입고 2층 구조 유지] 1층(날짜/합계) + 2층(공휴일) 유지하며 height만 조절
    let dateRowHtml = `<div class="date-row" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0px; width: 100%; height: ${currentHeaderHeight}; overflow: hidden; justify-content: flex-start; margin-bottom: 2px;">`;

    // (1층) 날짜와 총 팔레트 수
    dateRowHtml += `<div style="display: flex; justify-content: space-between; width: 100%; align-items: center; line-height: 1.0; height: 1.1em;">`;
    dateRowHtml += `<span class="${dateClass}" style="${redStyle}">${day}</span>`;
    if (dayData && dayData.length > 0) {
      let totalPallets = dayData.reduce((sum, item) => sum + parseInt(item.pal || 0), 0);
      if (totalPallets > 0) {
        dateRowHtml += `<span class="daily-total" style="flex-shrink: 0; font-weight: 800; font-size: 0.75em;">${totalPallets}</span>`;
      }
    }
    dateRowHtml += `</div>`;

    // (2층) 공휴일 이름 (전체 너비 사용)
    if (isHoliday && typeof holidayName === "string" && isShowHoliday) {
      dateRowHtml += `<span style="color:#ff3b30; font-size:0.6em; font-weight:800; letter-spacing:-0.5px; margin-top:1px; display: block; width: 100%; white-space: normal; word-break: break-all; line-height: 1.0;">${holidayName}</span>`;
    }
    dateRowHtml += `</div>`;

    let cellHtml = `<div class="${cellClass}" ${bindCell}>${dateRowHtml}`;

    // ... (이후 item-tag 렌더링 및 미정건 로직은 기존과 동일) ...

    if (dayData && dayData.length > 0) {
      dayData.forEach((item, idx) => {
        let isItemDone = item.isDone === true || String(item.isDone) === "true";
        let isAir = item.sType === "AIR";
        let pastelBg = isItemDone
          ? (isAir ? "#ff7eff" : "#26e2fd")
          : (isAir ? "#ff91ff" : "#47e6fd");

        let tagClass = `item-tag`;
        if (isItemDone) tagClass += " done-mark";
        let meaningfulEtc = item.etc
          ? item.etc.replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고완료)\]/g, "").trim()
          : "";
        if (meaningfulEtc !== "") tagClass += " has-etc";

        // 기존에 있던 AI 뱃지는 과감하게 지우고 P 글씨도 뺍니다!
        let iconHtml = isItemDone ? `<span class="done-icon">✓</span>` : "";
        let shortName = chipSubText(item);

        let innerHtml = `<span class="pal-main">${_esc(item.pal)}</span><span class="bl-sub">${iconHtml}${_esc(shortName)}</span>`;
        let originalIdx = item._rawIdx !== undefined ? item._rawIdx : idx;
        let bindItem = `onmousedown="event.stopPropagation(); startPress(event, 'item', ${day}, ${originalIdx})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="event.stopPropagation(); startPress(event, 'item', ${day}, ${originalIdx})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="event.stopPropagation(); handleItemClick(event, ${day}, ${originalIdx}, '${_argq(item.bl)}', ${isItemDone})"`;

        let textColor = isItemDone ? "#111111" : "#ffffff";
        let customStyle = `background-color: ${pastelBg} !important; color: ${textColor} !important; border: 1px solid rgba(0,0,0,0.1);`;

        // hover 툴팁 내용(PC모드): 1줄=제목, 이후 "라벨: 값"
        let _tip = `${item.bl}`;
        _tip += `\n수량: ${item.pal} PAL`;
        if (item.sType) _tip += `\n타입: ${item.sType}`;
        if (item.fwd) _tip += `\nFWD: ${item.fwd}`;
        if (item.invoice) _tip += `\nINV: ${item.invoice}`;
        if (meaningfulEtc) _tip += `\n비고: ${meaningfulEtc}`;
        _tip += `\n상태: ${isItemDone ? "✅ 입고완료" : "입고대기"}`;

        cellHtml += `<div class="${tagClass}" style="${customStyle}" data-raw-idx="${originalIdx}" data-fwd="${_esc(item.fwd || "")}" data-tip="${_esc(_tip)}" ${bindItem}>${innerHtml}</div>`;
      });
    }
    cellHtml += `</div>`;
    rowHtml += cellHtml;
    cellCount++;
  }
  while (cellCount % 7 !== 0) {
    rowHtml += `<div class="day-cell empty"></div>`;
    cellCount++;
  }
  rowHtml += "</div>";
  grid.innerHTML = rowHtml;

  renderPending();

  updateStatsSummary();
  renderPcSidePanel(); // PC 밀집 모드일 때만 내부에서 동작
  renderPcLeftbar(); // PC 밀집 좌측 사이드바
  updateSyncTime();
  const _bl = document.getElementById("bootLoader");
  if (_bl) _bl.classList.add("hide");
  // 검색 점프 하이라이트: 재렌더 직후 즉시 재적용(깜빡임 없이 유지)
  if (window._pcHl) reapplyPcHl();
}

// 🖥️ PC 사이드 패널 렌더 — 토글 ON(pc-dense)일 때만. serverData만 사용(추가 API 없음)
function renderPcSidePanel() {
  if (!document.body.classList.contains("pc-dense")) return;
  const panel = document.getElementById("pcSidePanel");
  if (!panel) return;

  let totalPal = 0,
    totalCnt = 0,
    doneCnt = 0,
    seaCnt = 0,
    airCnt = 0;
  const md = serverData.monthData || {};
  Object.keys(md).forEach((d) =>
    (md[d] || []).forEach((it) => {
      totalCnt++;
      totalPal += parseInt(it.pal || 0) || 0;
      if (it.isDone === true || String(it.isDone) === "true") doneCnt++;
      if (it.sType === "AIR") airCnt++;
      else seaCnt++;
    }),
  );
  const waitCnt = totalCnt - doneCnt;
  const donePct = totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0;
  const pend = serverData.pendingItems || [];

  // 📊 미니 통계보드 지표 계산 (serverData만 사용)
  const now = new Date();
  const isCurMonth =
    parseInt(serverData.year) === now.getFullYear() && parseInt(serverData.month) === now.getMonth() + 1;
  const dim = new Date(parseInt(serverData.year), parseInt(serverData.month), 0).getDate();
  let todayCnt = 0,
    weekCnt = 0,
    notDonePal = 0,
    peakDay = 0,
    peakPal = 0;
  const wkStart = now.getDate() - ((now.getDay() + 6) % 7); // 이번주 월요일
  const wkEnd = wkStart + 6;
  for (let d = 1; d <= dim; d++) {
    const arr = md[d] || [];
    if (!arr.length) continue;
    let dayPal = 0;
    arr.forEach((it) => {
      const p = parseInt(it.pal || 0) || 0;
      dayPal += p;
      if (!(it.isDone === true || String(it.isDone) === "true")) notDonePal += p;
    });
    if (dayPal > peakPal) {
      peakPal = dayPal;
      peakDay = d;
    }
    if (isCurMonth && d === now.getDate()) todayCnt = arr.length;
    if (isCurMonth && d >= wkStart && d <= wkEnd) weekCnt += arr.length;
  }
  const seaPct = seaCnt + airCnt ? Math.round((seaCnt / (seaCnt + airCnt)) * 100) : 0;
  const miniBoard = `
    <div class="pcp-card">
      <div class="pcp-title">📊 미니 통계</div>
      <div class="pcp-tiles">
        <div class="pcp-tile"><span class="pcp-tile-v">${isCurMonth ? todayCnt : "–"}</span><span class="pcp-tile-l">오늘 입고</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${isCurMonth ? weekCnt : "–"}</span><span class="pcp-tile-l">이번주</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${notDonePal}<small>P</small></span><span class="pcp-tile-l">미완료 물량</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${peakDay ? peakDay + "일" : "–"}</span><span class="pcp-tile-l">최다일 ${peakDay ? peakPal + "P" : ""}</span></div>
      </div>
      <div class="pcp-ratio">
        <div class="pcp-ratio-bar"><span style="width:${seaPct}%"></span></div>
        <div class="pcp-ratio-lbl"><span>🚢 해상 ${seaCnt}</span><span>✈️ 항공 ${airCnt}</span></div>
      </div>
    </div>`;

  let html = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
      <button class="pc-collapse-btn" onclick="togglePcRight()" title="패널 접기">›</button>
    </div>
    <div class="pcp-card">
      <div class="pcp-title">📊 ${serverData.year}.${String(serverData.month).padStart(2, "0")} 요약</div>
      <div class="pcp-donut" style="background: conic-gradient(#34c759 0% ${donePct}%, var(--btn-bg) ${donePct}% 100%);">
        <div class="pcp-donut-hole"><b>${donePct}%</b><span>완료</span></div>
      </div>
      <div class="pcp-stat-row"><span>총 팔레트</span><b>${totalPal} P</b></div>
      <div class="pcp-stat-row"><span>총 건수</span><b>${totalCnt}건</b></div>
      <div class="pcp-stat-row"><span>🚢 해상 / ✈️ 항공</span><b>${seaCnt} / ${airCnt}</b></div>
      <div class="pcp-stat-row"><span>✅ 완료 / ⏳ 대기</span><b>${doneCnt} / ${waitCnt}</b></div>
      <div style="margin-top:10px;"><button class="pcp-btn" onclick="openDashboard()">📊 전체 통계 보기</button></div>
    </div>
    ${miniBoard}
    <div class="pcp-card">
      <div class="pcp-title">⏳ 입고 보류 / 대기 (${pend.length}건)</div>`;
  if (pend.length === 0) {
    html += `<div class="pcp-empty"><span class="pcp-empty-ico">✅</span><span>대기 중인 건이 없습니다</span></div>`;
  } else {
    pend.forEach((it, idx) => {
      const isAir = it.sType === "AIR";
      const dot = isAir ? "#ff7eff" : "#26e2fd";
      const typeLabel = isAir ? "✈️ AIR" : "🚢 SEA";
      const isItemDone = it.isDone === true || String(it.isDone) === "true";
      const pal = parseInt(it.pal || 0);
      const rawEtc = String(it.etc || "");
      const meaningfulEtc = rawEtc.replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고완료)\]/g, "").trim();
      const blLabel = it.bl && it.bl.startsWith("발행전") ? "발행전" : (it.bl || "");

      // 툴팁
      let tip = blLabel || "(B/L 없음)";
      tip += `\n수량: ${pal} PAL`;
      tip += `\n타입: ${it.sType || "-"}`;
      if (it.fwd) tip += `\nFWD: ${it.fwd}`;
      if (it.invoice) tip += `\nINV: ${it.invoice}`;
      if (meaningfulEtc) tip += `\n비고: ${meaningfulEtc}`;
      tip += `\n상태: ${isItemDone ? "✅ 입고완료" : "⏳ 입고대기(미정)"}`;

      const qtyBadge = `<span style="font-size:0.8em; font-weight:800; color:var(--text-sub); background:var(--btn-bg,rgba(128,128,128,0.12)); border-radius:5px; padding:1px 6px; flex-shrink:0; pointer-events:none;">${pal}P</span>`;
      const typeBadge = `<span style="font-size:0.72em; background:${isAir ? "rgba(255,126,255,0.12)" : "rgba(38,226,253,0.12)"}; color:${dot}; border:1px solid ${isAir ? "rgba(255,126,255,0.25)" : "rgba(38,226,253,0.25)"}; border-radius:4px; padding:1px 5px; font-weight:700; flex-shrink:0; pointer-events:none;">${typeLabel}</span>`;
      const statusDot = isItemDone ? `<span style="font-size:0.8em; color:#34c759; flex-shrink:0; pointer-events:none;">✅</span>` : "";

      html += `<div class="pcp-pend-item" style="cursor:grab;" data-tip="${_esc(tip)}"
        onmousedown="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" onmouseup="cancelPress()" onmouseleave="cancelPress()"
        ontouchstart="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" ontouchend="cancelPress()" ontouchmove="cancelPress()"
        oncontextmenu="event.preventDefault();"
        onclick="handleItemClick(event, 'pending', ${idx}, '${_argq(it.bl)}', ${isItemDone})">
        <div style="display:flex; align-items:center; gap:6px; width:100%; pointer-events:none;">
          <span style="color:var(--text-sub); font-size:0.85em; flex-shrink:0; opacity:0.45; letter-spacing:-1px; pointer-events:none;">⠿</span>
          <div style="width:9px; height:9px; border-radius:50%; background:${dot}; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.15); pointer-events:none;"></div>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; pointer-events:none;">${_esc(blLabel)}</span>
          ${typeBadge}${statusDot}${qtyBadge}
        </div>
        ${meaningfulEtc ? `<div style="font-size:0.78em; color:var(--text-sub); margin-top:3px; padding-left:21px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none;">${_esc(meaningfulEtc)}</div>` : ""}
        ${it.fwd ? `<div style="font-size:0.78em; color:var(--text-sub); margin-top:1px; padding-left:21px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none;">${_esc(it.fwd)}</div>` : ""}
      </div>`;
    });
  }
  html += `</div>`;
  panel.innerHTML = html;
}

function navMonth(offset) {
  let currentY = parseInt(serverData.year, 10);
  let currentM = parseInt(serverData.month, 10);
  if (isNaN(currentY) || isNaN(currentM)) {
    let now = new Date();
    currentY = now.getFullYear();
    currentM = now.getMonth() + 1;
  }
  // 임의 offset도 정확히 처리(모듈로) — 오늘로 이동처럼 여러 달 점프 대응
  let total = currentY * 12 + (currentM - 1) + parseInt(offset, 10);
  let newYear = Math.floor(total / 12);
  let newMonth = (total % 12) + 1;
  goToAsync(newYear, newMonth);
}

let tempPickerYear = serverData.year;
function openPicker() {
  tempPickerYear = parseInt(serverData.year, 10);
  renderPicker();
  document.getElementById("monthPickerModal").style.display = "flex";
}

function renderPicker() {
  document.getElementById("pickerYearText").innerText = `${tempPickerYear}년`;
  let gridHtml = "";
  for (let i = 1; i <= 12; i++) {
    let isCurrent =
      tempPickerYear === parseInt(serverData.year, 10) && i === parseInt(serverData.month, 10) ? "current" : "";
    gridHtml += `<button class="month-btn ${isCurrent}" onclick="document.getElementById('monthPickerModal').style.display='none'; goToAsync(${tempPickerYear}, ${i})">${i}월</button>`;
  }
  document.getElementById("pickerMonthGrid").innerHTML = gridHtml;
}

// 🚀 [초고속 월 이동] 오염된 캐시 치료 + 깜빡임 방지 100% 최적화
function goToAsync(year, month) {
  const toastEl = document.getElementById("toast");
  if (toastEl) toastEl.classList.remove("show");
  if (window.toastTimer) clearTimeout(window.toastTimer);

  let safeYear = parseInt(year, 10);
  let safeMonth = parseInt(month, 10);

  checkAndFetchHolidays(safeYear);

  // 💡 [핵심 패치] 달력을 넘기기 전에 현재 가지고 있는 '미정(대기)' 최신 목록을 배낭에 챙깁니다!
  let globalPending =
    window.globalPendingItems && window.globalPendingItems.length > 0
      ? window.globalPendingItems
      : serverData.pendingItems || [];

  const cacheKey = `cal_cache_${currentType}_${safeYear}_${safeMonth}`;
  const cachedData = localStorage.getItem(cacheKey);
  let isCacheValid = false;

  if (cachedData) {
    try {
      let parsed = JSON.parse(cachedData);
      serverData = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      serverData.year = safeYear;
      serverData.month = safeMonth;
      serverData.firstDay = new Date(safeYear, safeMonth - 1, 1).getDay();
      serverData.daysInMonth = new Date(safeYear, safeMonth, 0).getDate();
      if (!isNaN(serverData.year)) isCacheValid = true;
    } catch (e) {}
  }

  if (!isCacheValid) {
    let tempFirstDay = new Date(safeYear, safeMonth - 1, 1).getDay();
    let tempDays = new Date(safeYear, safeMonth, 0).getDate();
    serverData = { year: safeYear, month: safeMonth, firstDay: tempFirstDay, daysInMonth: tempDays, monthData: {} };
  }

  // 💡 [핵심 패치] 새로 연 달력에 캐시 상관없이 아까 챙겨둔 '미정(대기)' 목록을 무조건 덮어씌움!
  serverData.pendingItems = globalPending;

  renderCalendar();

  window.currentNavId = (window.currentNavId || 0) + 1;
  let myNavId = window.currentNavId;
  let fetchStartTime = Date.now();
  apiGet({ type: currentType, year: safeYear, month: safeMonth }).then((res) => {
    if (res === null) return;
    if (myNavId !== window.currentNavId) return;
    if (typeof lastLocalUpdateTime !== "undefined" && lastLocalUpdateTime > fetchStartTime) return;

    res.year = safeYear;
    res.month = safeMonth;
    res.firstDay = new Date(safeYear, safeMonth - 1, 1).getDay();
    res.daysInMonth = new Date(safeYear, safeMonth, 0).getDate();

    const getScheduleSig = (dataObj) => {
      if (!dataObj) return "";
      const norm = (v) => {
        let s = v == null || v === "" ? "" : String(v).trim();
        return s === "0" || s === "" ? "" : s;
      };
      let sigs = [];
      if (dataObj.pendingItems)
        dataObj.pendingItems.forEach((it) =>
          sigs.push(`P_${it.company || it.bl || ""}_${norm(it.pal)}_${norm(it.box)}_${it.etc || ""}_${it.isDone}`),
        );
      if (dataObj.monthData) {
        for (let d in dataObj.monthData)
          dataObj.monthData[d].forEach((it) =>
            sigs.push(`${d}_${it.company || it.bl || ""}_${norm(it.pal)}_${norm(it.box)}_${it.etc || ""}_${it.isDone}`),
          );
      }
      return sigs.sort().join("||");
    };
    let isScheduleChanged = getScheduleSig(serverData) !== getScheduleSig(res);
    localStorage.setItem(cacheKey, JSON.stringify(res));
    if (isScheduleChanged) {
      serverData = res;
      renderCalendar();
    }
  });
}

// 🚀 [스텔스 연간 동기화 매니저] (연속 클릭 시 서버 과부하/멈춤 완벽 방어)
let stealthYearlyTimer = null;
function triggerStealthYearlySync(targetYear) {
  if (stealthYearlyTimer) clearTimeout(stealthYearlyTimer);

  stealthYearlyTimer = setTimeout(() => {
    apiGet({ action: "yearlyStats", type: currentType, year: targetYear }).then((res) => {
      if (res && res.year) {
        yearlyCache[res.year] = res;
        localStorage.setItem(`yearly_stats_cache_${currentType}_${res.year}`, JSON.stringify(res));
        if (
          document.getElementById("dashboardModal").style.display === "flex" &&
          window.dashMode === "year" &&
          window.dashYear === res.year
        ) {
          renderDashCharts();
        }
      }
    });
  }, 1500);
}

function updateLocalState(action, payload, idx) {
  let oldDay = payload.oldDate && payload.oldDate !== "미정" ? parseInt(payload.oldDate.split("-")[2], 10) : "pending";
  let newDay = payload.newDate && payload.newDate !== "미정" ? parseInt(payload.newDate.split("-")[2], 10) : "pending";
  let arr = oldDay === "pending" ? serverData.pendingItems : serverData.monthData[oldDay];
  if (!arr) return;

  if (action === "ADD") {
    // 신규 등록 → 해당 날짜(또는 대기)에 즉시 한 건 추가 (id는 다음 동기화 때 서버값으로 채워짐)
    let newItem = {
      bl: payload.newBL,
      company: payload.newBL, // 시스템 호환용
      pal: payload.newPal || "",
      sType: payload.newSType || "",
      fwd: payload.newFwd || "",
      invoice: payload.newInvoice || "",
      etc: payload.newEtc || "",
      isDone: false,
      id: null,
    };
    if (newDay !== "pending" && !serverData.monthData[newDay]) serverData.monthData[newDay] = [];
    let newArr = newDay === "pending" ? serverData.pendingItems : serverData.monthData[newDay];
    newArr.push(newItem);
  } else if (action === "EDIT") {
    let item = arr.splice(idx, 1)[0];

    // 🚨 [핵심 픽스] 수정된 모든 데이터를 내 폰 화면(로컬 객체)에도 즉시 덮어씌웁니다!
    if (payload.newBL !== undefined) {
      item.bl = payload.newBL;
      item.company = payload.newBL; // 시스템 호환용
    }
    if (payload.newPal !== undefined) item.pal = payload.newPal;
    if (payload.newSType !== undefined) item.sType = payload.newSType;
    if (payload.newFwd !== undefined) item.fwd = payload.newFwd;
    if (payload.newInvoice !== undefined) item.invoice = payload.newInvoice;
    if (payload.newEtc !== undefined) item.etc = payload.newEtc;

    if (newDay !== "pending" && !serverData.monthData[newDay]) serverData.monthData[newDay] = [];
    let newArr = newDay === "pending" ? serverData.pendingItems : serverData.monthData[newDay];
    newArr.push(item);
  } else if (action === "DELETE") {
    arr.splice(idx, 1);
  } else if (action === "DONE") {
    arr[idx].isDone = true;
  } else if (action === "UNDO_DONE") {
    arr[idx].isDone = false;
  }

  lastLocalUpdateTime = Date.now();
  localStorage.setItem(`cal_cache_${currentType}_${serverData.year}_${serverData.month}`, JSON.stringify(serverData));

  triggerStealthYearlySync(serverData.year);
}

function updateMultiLocalState(action, items) {
  const norm = (v) => {
    let s = String(v != null ? v : "").trim();
    return s === "0" || s === "" ? "" : s;
  };
  items.forEach((target) => {
    let day = target.dateStr === "미정" ? "pending" : parseInt(target.dateStr.split("-")[2], 10);
    let arr = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
    if (!arr) return;
    // 🚨 ID가 있으면 무조건 ID로 잡고, 없으면 글자로 찾아서 확실하게 업데이트!
    let idx = arr.findIndex((i) => {
      if (target.id && i.id === target.id) return true;
      return i.bl === target.bl && norm(i.pal) === norm(target.pal);
    });
    if (idx !== -1) {
      if (action === "MULTI_DELETE") arr.splice(idx, 1);
      else if (action === "MULTI_DONE") arr[idx].isDone = true;
      else if (action === "MULTI_UNDO_DONE") arr[idx].isDone = false;
    }
  });
  lastLocalUpdateTime = Date.now();
  localStorage.setItem(`cal_cache_${currentType}_${serverData.year}_${serverData.month}`, JSON.stringify(serverData));
  triggerStealthYearlySync(serverData.year);
}

if (isAdmin) {
  const btn = document.getElementById("adminBtn");
  btn.innerHTML = "🔓 관리자";
  btn.classList.add("unlocked");
  document.getElementById("adminActions").style.display = "flex";
}

// =====================================================
// 🔒 [통합 인증 및 세션 제어 엔진] - 중복 코드 제거 및 최적화
// =====================================================

// 🚨 1. 인증 데이터 통합 저장/삭제 헬퍼

// 🚨 2. 수동 로그인 모달창 띄우기

// 🚨 3. 권한에 따른 프로필 모달 및 세팅 토글

// 🚨 4. 자동 로그인 토글 (스토리지 이사)
function handleAutoLoginToggle(checkbox) {
  const id = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id");
  const role = localStorage.getItem("admin_role") || sessionStorage.getItem("admin_role");

  if (checkbox.checked) {
    localStorage.setItem("auto_login", "true");
    if (id) saveAuthData(id, role, true);
    showToast("자동 로그인 기능이 켜졌습니다.", 1500);
  } else {
    localStorage.setItem("auto_login", "false");
    if (id) saveAuthData(id, role, true);
    showToast("앱 종료 시 자동으로 로그아웃됩니다.", 1500);
  }
}

window.addEventListener("beforeunload", () => {
  if (localStorage.getItem("auto_login") === "false") {
    saveAuthData(null, null, false);
  }
});

// 🚨 5. 생체 인증 스위치 컨트롤 (모달 호출)

// 모달 취소 시 스위치 원상복구

// 💡 [PWA 완벽 대응 및 무반응 버그 원천 차단] 통합 가동 엔진

// 🚨 [가장 중요한 핵심 타이밍 제어]
// 이미 DOM 로드가 완료된 인터랙티브/컴플리트 상태라면 대기하지 않고 즉시 이벤트를 바인딩합니다.
if (document.readyState === "complete" || document.readyState === "interactive") {
  bindBioAuthEvents();
} else {
  document.addEventListener("DOMContentLoaded", bindBioAuthEvents);
}

// 🚨 6. 비밀번호 눈알 아이콘 토글

// 🚨 7. 로그아웃 (서버에 로그아웃 기록 전송 추가)

let isMultiMode = false;
let selectedItems = [];
function toggleMultiMode() {
  isMultiMode = !isMultiMode;
  selectedItems = [];
  document.querySelectorAll(".item-tag, .pending-item").forEach((el) => el.classList.remove("multi-selected"));
  const btn = document.getElementById("multiBtn");
  const bar = document.getElementById("multiActionBar");
  if (isMultiMode) {
    btn.innerText = "❌ 취소";
    btn.classList.add("active");
    bar.style.display = "flex";
    document.getElementById("selCount").innerText = "0";
  } else {
    btn.innerText = "☑️ 다중 선택";
    btn.classList.remove("active");
    bar.style.display = "none";
  }
}

// 🚀 [초정밀 통합 드래그 엔진] (입고/출고 공통)
let pressTimer = null;
let isLongPress = false;
let pressTarget = null;
let startX = 0,
  startY = 0;
let isDragging = false;
let dragGhost = null;
let dragData = null;
let hasMovedDuringDrag = false;
let dragOffsetX = 0,
  dragOffsetY = 0;
let dragReq = null;
let lastDropTarget = null;
let _lastInsertPos = null; // 'top' | 'bottom' | 'cell'

function startPress(e, type, day, idx = null) {
  if (!isAdmin || isMultiMode) return;
  cancelPress();
  isLongPress = false;
  hasMovedDuringDrag = false;
  pressTarget = e.currentTarget;
  let clientX = e.touches ? e.touches[0].clientX : e.clientX;
  let clientY = e.touches ? e.touches[0].clientY : e.clientY;
  startX = clientX;
  startY = clientY;
  pressTarget.classList.add("cell-pressing");
  pressTimer = setTimeout(() => {
    isLongPress = true;
    if (pressTarget) pressTarget.classList.remove("cell-pressing");
    if (navigator.vibrate) navigator.vibrate(50);

    if (type === "cell") {
      if (typeof openAddFormWithDate === "function") openAddFormWithDate(day);
    } else if (type === "item") {
      isDragging = true;
      dragData = { day: day, idx: idx };
      let rect = pressTarget.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;

      dragGhost = pressTarget.cloneNode(true);
      pressTarget.style.opacity = "0.3";

      if (day === "pending") {
        dragGhost.className = "item-tag";
        if (serverData.pendingItems[idx].sType) {
          let cClass = serverData.pendingItems[idx].sType === "SEA" ? "color-sea" : "color-air";
          dragGhost.classList.add(cClass);
          dragGhost.innerHTML = serverData.pendingItems[idx].bl.slice(-4);
          dragGhost.style.color = "#fff";
        } else {
          let cleanComp = serverData.pendingItems[idx].company.replace(/\[TASK\]/gi, "").trim();
          let shortName = typeof getShortName === "function" ? getShortName(cleanComp) : cleanComp.slice(0, 4);
          if (typeof getCompanyColor === "function") {
            let colorObj = getCompanyColor(cleanComp);
            dragGhost.style.background = colorObj.bg;
            dragGhost.style.color = colorObj.cMain;
          }
          dragGhost.innerHTML = shortName;
        }
        dragGhost.style.width = "60px";
        dragGhost.style.height = "35px";
        dragGhost.style.justifyContent = "center";
        dragGhost.style.alignItems = "center";
        dragGhost.style.display = "flex";
        dragGhost.style.borderRadius = "6px";
        dragGhost.style.fontSize = "0.85em";
        dragGhost.style.fontWeight = "900";
        dragOffsetX = 30;
        dragOffsetY = 17;
      } else {
        let isWideTask = rect.width > window.innerWidth * 0.4;
        dragGhost.style.width = isWideTask ? "100px" : rect.width + "px";
        dragGhost.style.height = rect.height + "px";
        if (isWideTask) dragOffsetX = 50;
        dragGhost.classList.remove("linked-left", "linked-right", "item-tag-slim", "edge-left", "edge-right");
        dragGhost.style.margin = "0px";
        dragGhost.style.borderRight = "";
        dragGhost.style.borderLeft = "";
        dragGhost.style.borderRadius = "8px";
      }

      dragGhost.style.position = "fixed";
      dragGhost.style.left = "0px";
      dragGhost.style.top = "0px";
      dragGhost.style.margin = "0px";
      dragGhost.style.zIndex = "999999";
      dragGhost.style.opacity = "0.95";
      dragGhost.style.pointerEvents = "none";
      dragGhost.style.willChange = "transform";
      dragGhost.style.boxShadow = "0 15px 35px rgba(0,0,0,0.3)";
      dragGhost.style.transition = "none";

      document.body.appendChild(dragGhost);

      // 🚨 화면에 박자마자 즉시 좌표 적용! (입고 버그 픽스)
      dragGhost.style.transform = `translate3d(${clientX - dragOffsetX}px, ${clientY - dragOffsetY}px, 0) scale(1.05)`;
    }
  }, 400);
}

function updateGhostPosition(x, y) {
  if (!dragGhost) return;
  // 🚨 픽셀 단위 직접 주입으로 입고 달력 먹통 현상 완벽 해결!
  dragGhost.style.left = x - dragOffsetX + "px";
  dragGhost.style.top = y - dragOffsetY + "px";
  dragGhost.style.transform = "scale(1.05)"; // 크기만 살짝 키움

  if (!dragReq) {
    dragReq = requestAnimationFrame(() => {
      let dropElement = document.elementFromPoint(x, y);
      let targetCell = dropElement ? dropElement.closest(".day-cell:not(.empty)") : null;
      let targetItem = dropElement ? dropElement.closest(".item-tag") : null;
      if (targetItem === pressTarget) targetItem = null; // 자기 자신 제외

      // 셀 안의 '보이는' 아이템 목록 (자기 자신·투명 placeholder 제외)
      let visItems = targetCell
        ? Array.from(targetCell.querySelectorAll(".item-tag")).filter(
            (el) => el !== pressTarget && el.style.pointerEvents !== "none" && el.style.opacity !== "0",
          )
        : [];
      let lastItem = visItems.length ? visItems[visItems.length - 1] : null;
      let belowAll = lastItem && y > lastItem.getBoundingClientRect().bottom;

      // 🛡️ [떨림 방지] 벌어진 갭(빈 자리) 위에 있으면 직전 결정을 그대로 유지
      if (
        !belowAll &&
        !targetItem &&
        lastDropTarget &&
        lastDropTarget.classList &&
        lastDropTarget.classList.contains("item-tag") &&
        targetCell &&
        lastDropTarget.closest(".day-cell") === targetCell
      ) {
        dragReq = null;
        return;
      }

      let desiredTarget = null,
        desiredPos = null;
      if (targetCell) {
        if (belowAll) {
          desiredTarget = lastItem;
          desiredPos = "bottom";
        } else if (targetItem) {
          let rect = targetItem.getBoundingClientRect();
          let ratio = (y - rect.top) / rect.height;
          if (ratio < 0.4) desiredPos = "top";
          else if (ratio > 0.6) desiredPos = "bottom";
          else
            desiredPos =
              lastDropTarget === targetItem && _lastInsertPos ? _lastInsertPos : ratio < 0.5 ? "top" : "bottom";
          desiredTarget = targetItem;
        } else {
          desiredTarget = targetCell;
          desiredPos = "cell";
        }
      }

      if (desiredTarget === lastDropTarget && desiredPos === _lastInsertPos) {
        dragReq = null;
        return;
      }

      document.querySelectorAll(".insert-line-top, .insert-line-bottom, .drag-over").forEach((el) => {
        el.classList.remove("insert-line-top", "insert-line-bottom", "drag-over");
      });
      if (desiredTarget) {
        if (desiredPos === "top") desiredTarget.classList.add("insert-line-top");
        else if (desiredPos === "bottom") desiredTarget.classList.add("insert-line-bottom");
        else desiredTarget.classList.add("drag-over");
      }
      lastDropTarget = desiredTarget;
      _lastInsertPos = desiredPos;
      dragReq = null;
    });
  }
}

document.addEventListener(
  "touchmove",
  function (e) {
    if (isDragging) {
      e.preventDefault();
      hasMovedDuringDrag = true;
      updateGhostPosition(e.touches[0].clientX, e.touches[0].clientY);
    }
  },
  { passive: false },
);
document.addEventListener("mousemove", function (e) {
  if (isDragging) {
    hasMovedDuringDrag = true;
    updateGhostPosition(e.clientX, e.clientY);
  }
});
document.addEventListener("touchend", endDrag);
document.addEventListener("mouseup", endDrag);
document.addEventListener("touchcancel", endDrag); // 터치 취소 시 드래그 얼어붙음 방지

async function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  if (dragReq) {
    cancelAnimationFrame(dragReq);
    dragReq = null;
  }

  let x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  let y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  if (pressTarget) {
    pressTarget.style.opacity = "1";
  }

  let currentDropTarget = lastDropTarget;
  let isTopInsert = currentDropTarget ? currentDropTarget.classList.contains("insert-line-top") : false;
  if (lastDropTarget) {
    lastDropTarget.classList.remove("drag-over", "insert-line-top", "insert-line-bottom");
    lastDropTarget = null;
  }
  _lastInsertPos = null;

  if (!hasMovedDuringDrag) return;
  // 🚨 타겟 결정 안전장치
  let targetCell = currentDropTarget ? currentDropTarget.closest(".day-cell") : null;
  let isOutsideCalendar = false;
  let targetPending = false;
  if (!targetCell) {
    let dropElement = document.elementFromPoint(x, y);
    targetCell = dropElement ? dropElement.closest(".day-cell") : null;
    isOutsideCalendar =
      !dropElement || (!dropElement.closest(".calendar-container") && !dropElement.closest(".overlay-modal"));
    targetPending = dropElement ? dropElement.closest(".pending-container") : null;
  }

  let item =
    dragData.day === "pending"
      ? serverData.pendingItems[dragData.idx]
      : serverData.monthData[dragData.day][dragData.idx];
  let oldDateStr =
    dragData.day === "pending"
      ? "미정"
      : _ymd(serverData.year, serverData.month, dragData.day);
  if (targetCell && !targetCell.classList.contains("empty")) {
    let newDay = parseInt(targetCell.querySelector(".date-num").innerText.trim());
    // 💡 [순서 변경 로직] 파란선이 있었을 때만 끼워넣기 동작!
    // 💡 [순서 변경 로직] 파란선이 있었을 때만 끼워넣기 동작!
    if (newDay === dragData.day && dragData.day !== "pending") {
      let arr = serverData.monthData[dragData.day];
      let targetIdx;
      if (currentDropTarget && currentDropTarget.classList.contains("item-tag")) {
        targetIdx = parseInt(currentDropTarget.getAttribute("data-raw-idx"));
      } else {
        // 같은 날 빈 공간(맨 아래)에 드롭 → 맨 끝으로 이동
        targetIdx = arr.length - 1;
        isTopInsert = false;
      }
      if (!isNaN(targetIdx) && arr) {
        let movedItem = arr[dragData.idx];

        arr.splice(dragData.idx, 1);
        if (targetIdx > dragData.idx) targetIdx--;

        let insertIdx = isTopInsert ? targetIdx : targetIdx + 1;
        arr.splice(insertIdx, 0, movedItem);

        // 🚨 사용자가 만든 커스텀 순서를 무조건 유지하도록 도장 꽝!
        serverData.customOrderFlags = serverData.customOrderFlags || {};
        serverData.customOrderFlags[dragData.day] = true;

        // 🚨 [패치 4] Vercel 서버로 순서표 전송! (이게 빠져서 새로고침 시 튕겼음!)
        let orderPayload = { dailyOrders: {} };
        let dStr = _ymd(serverData.year, serverData.month, dragData.day);
        orderPayload.dailyOrders[dStr] = [];
        arr.forEach((it, i) => {
          it.sortIdx = i; // 로컬 반영
          orderPayload.dailyOrders[dStr].push({
            id: it.id || null,
            company: it.bl,
            pal: String(it.pal || "").trim(),
            sortIdx: i,
          });
        });

        localStorage.setItem(
          `cal_cache_${currentType}_${serverData.year}_${serverData.month}`,
          JSON.stringify(serverData),
        );
        renderCalendar();

        apiCall({
          source: "vercel",
          domain: "in",
          action: "UPDATE_ORDER",
          data: orderPayload,
          token: adminToken,
          admin_id: localStorage.getItem("admin_id"),
        });
        return;
      }
    }

    if (newDay === dragData.day) return;
    let newDateStr = _ymd(serverData.year, serverData.month, newDay);
    let rawName = item.company || item.bl;
    let cleanName = rawName.replace(/\[TASK\]/gi, "").trim();
    if (await uiConfirm(`🚚 [${cleanName}] 일정을 ${newDay}일로 이동하시겠습니까?`)) {
      executeMove(item, oldDateStr, newDateStr, dragData.idx);
    }
  } else if (isOutsideCalendar || targetPending) {
    if (dragData.day === "pending") return;
    let rawName = item.company || item.bl;
    let cleanName = rawName.replace(/\[TASK\]/gi, "").trim();
    if (await uiConfirm(`🚚 [${cleanName}] 일정을 '미정(대기)'으로 변경하시겠습니까?`)) {
      executeMove(item, oldDateStr, "미정", dragData.idx);
    }
  }
}

function executeMove(item, oldDateStr, newDateStr, idx) {
  let payload = {
    action: "EDIT",
    id: item.id,
    oldBL: item.bl,
    oldDate: oldDateStr,
    oldDone: item.isDone,
    oldPal: String(item.pal || ""),
    newDate: newDateStr,
    newBL: item.bl,
    newPal: item.pal,
    newSType: item.sType,
    newFwd: item.fwd,
    newInvoice: item.invoice,
    newEtc: item.etc,
  };
  updateLocalState("EDIT", payload, idx);
  renderCalendar();
  apiCall({
    source: "vercel",
    domain: "in",
    action: "EDIT",
    data: payload,
    token: adminToken,
    admin_id: localStorage.getItem("admin_id"),
  }).then((res) => {
    if (res === null || !res.success) {
      showToast("❌ 서버 저장 실패! 데이터를 다시 불러옵니다.", 2000);
      goToAsync(serverData.year, serverData.month);
    }
  });
}

function handleItemClick(e, day, idx, bl, isDone) {
  if (isMultiMode) {
    const el = e.currentTarget;
    let dateStr =
      day === "pending"
        ? "미정"
        : _ymd(serverData.year, serverData.month, day);
    let isItemDone = isDone === true || String(isDone) === "true";
    let itemKey = `${bl}_${dateStr}_${isItemDone}_${idx}`;
    let item = day === "pending" ? serverData.pendingItems[idx] : serverData.monthData[day][idx];
    const safeStr = (val) => (val === "" || val == null ? "" : String(val).trim());
    let existingIdx = selectedItems.findIndex((i) => i.key === itemKey);
    if (existingIdx > -1) {
      selectedItems.splice(existingIdx, 1);
      el.classList.remove("multi-selected");
    }
    // 기존 코드 덮어쓰기
    else {
      selectedItems.push({
        key: itemKey,
        id: item.id,
        bl: bl,
        dateStr: dateStr,
        isDone: isItemDone,
        pal: safeStr(item.pal),
      });
      el.classList.add("multi-selected");
    }
    document.getElementById("selCount").innerText = selectedItems.length;
    return;
  }
  if (isLongPress) {
    setTimeout(() => {
      isLongPress = false;
    }, 100);
    return;
  }
  highlightClickedItem(e.currentTarget); // 달력 칩 강조
  showModal(day, idx); // 모달 안에서도 클릭한 항목 카드 강조
}

// 클릭된 일정 칩 강조 (상세 모달이 어떤 일정에서 열렸는지 한눈에)
function highlightClickedItem(el) {
  clearClickedHighlight();
  if (el && el.classList) el.classList.add("item-clicked");
}
function clearClickedHighlight() {
  document.querySelectorAll(".item-tag.item-clicked").forEach((n) => n.classList.remove("item-clicked"));
}

// 수량 음수 방지: 빈값은 유지, 숫자는 0 이상으로 클램프
function clampQty(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? "" : String(Math.max(0, n));
}

// ➕ 신규 입고 등록 폼 열기 (FAB '신규 등록' 버튼)
function openAddForm() {
  if (isMultiMode) toggleMultiMode();
  document.getElementById("add-bl").value = "";
  document.getElementById("add-pal").value = "";
  document.getElementById("add-stype").value = "SEA";
  document.getElementById("add-fwd").value = "";
  document.getElementById("add-invoice").value = "";
  document.getElementById("add-date").value = "";
  document.getElementById("add-etc").value = "";
  document.getElementById("addModal").style.display = "flex";
}

// 달력 날짜 롱프레스 → 그 날짜로 신규 등록 폼 열기
function openAddFormWithDate(day) {
  openAddForm();
  let dateStr = _ymd(serverData.year, serverData.month, day);
  document.getElementById("add-date").value = dateStr;
  setTimeout(() => document.getElementById("add-bl").focus(), 200);
}

async function submitCMS(action, oldBL = null, oldDate = null, idx = null, isDone = false) {
  if (action === "EDIT" || action === "DELETE") _editState = null; // 수정 세션 종료
  let oldPal = "";
  let itemId = null; // 🚨 ID 변수 추가
  const safeStr = (val) => (val === "" || val == null ? "" : String(val).trim());
  let currentIsDone = isDone === true || String(isDone) === "true";
  if (idx !== null) {
    let day = oldDate === "미정" ? "pending" : parseInt(oldDate.split("-")[2], 10);
    let item =
      day === "pending"
        ? serverData.pendingItems[idx]
        : serverData.monthData[day]
          ? serverData.monthData[day][idx]
          : null;
    if (item) {
      oldPal = safeStr(item.pal);
      currentIsDone = item.isDone === true || String(item.isDone) === "true";
      itemId = item.id; // 🚨 ID 획득!
    }
  }

  let payload = { action: action, id: itemId, oldBL: oldBL, oldDate: oldDate, oldDone: currentIsDone, oldPal: oldPal };
  if (action === "DONE") {
    if (!(await uiConfirm(`✅ [${oldBL}] 입고를 완료 처리하시겠습니까?`))) return;
  } else if (action === "UNDO_DONE") {
    if (!(await uiConfirm(`⏪ [${oldBL}] 입고 완료 상태를 취소하시겠습니까?`))) return;
  } else if (action === "DELETE") {
    if (!(await uiConfirm(`⚠️ 정말 [${oldBL}] 입고 스케줄을 영구 삭제하시겠습니까?`, { danger: true }))) return;
  } else if (action === "EDIT") {
    payload.newBL = document.getElementById(`edit-bl-${idx}`).value;
    payload.newPal = (function (v) {
      const n = parseInt(v, 10);
      return isNaN(n) ? "" : String(Math.max(0, n));
    })(document.getElementById(`edit-pal-${idx}`).value);
    payload.newSType = document.getElementById(`edit-stype-${idx}`).value;
    payload.newFwd = document.getElementById(`edit-fwd-${idx}`).value;
    payload.newInvoice = document.getElementById(`edit-invoice-${idx}`).value;
    payload.newDate = document.getElementById(`edit-date-${idx}`).value || "미정";
    payload.newEtc = document.getElementById(`edit-etc-${idx}`).value;
  } else if (action === "ADD") {
    let bl = document.getElementById("add-bl").value.trim();
    if (!bl) {
      showToast("⚠️ B/L 번호는 필수입니다.", 2000);
      return;
    }
    payload.newBL = bl;
    payload.newPal = clampQty(document.getElementById("add-pal").value);
    payload.newSType = document.getElementById("add-stype").value;
    payload.newFwd = document.getElementById("add-fwd").value.trim();
    payload.newInvoice = document.getElementById("add-invoice").value.trim();
    payload.newDate = document.getElementById("add-date").value || "미정";
    payload.newEtc = document.getElementById("add-etc").value.trim();
    document.getElementById("addModal").style.display = "none";
  }

  document.getElementById("modal").style.display = "none";
  setTimeout(() => {
    updateLocalState(action, payload, idx);
    renderCalendar();
    apiCall({
      source: "vercel",
      domain: "in",
      action: action,
      data: payload,
      token: adminToken,
      admin_id: localStorage.getItem("admin_id"),
    }).then(function (res) {
      if (res === null || !res.success) {
        showToast("❌ 서버 실패! 원상복구합니다.", 2500);
        goToAsync(serverData.year, serverData.month);
      } else if (action === "ADD") {
        showToast("✅ 신규 입고가 등록되었습니다.", 2000);
      }
    });
    // 💡 수정 후엔 모달을 닫지 않고 상세보기로 복귀
    if (action === "EDIT") _reopenDetailAfter(payload.newDate || oldDate);
  }, 50);
}

async function executeMultiAction(action) {
  if (selectedItems.length === 0) {
    showToast("항목을 먼저 터치하여 선택해 주세요.", 2000);
    return;
  }
  let actionName =
    action === "MULTI_DONE" ? "입고 완료 처리" : action === "MULTI_UNDO_DONE" ? "완료 취소" : "영구 삭제";
  if (!(await uiConfirm(`⚠️ 선택된 ${selectedItems.length}개의 일정을 일괄 [${actionName}] 하시겠습니까?`))) return;

  let itemsToProcess = [...selectedItems];
  toggleMultiMode();
  setTimeout(() => {
    updateMultiLocalState(action, itemsToProcess);
    renderCalendar();
    apiCall({
      source: "vercel",
      domain: "in",
      action: action,
      data: { items: itemsToProcess },
      token: adminToken,
      admin_id: localStorage.getItem("admin_id"),
    }).then(function (res) {
      if (res === null || !res.success) {
        showToast("❌ 작업 실패! 복구합니다.", 2500);
        goToAsync(serverData.year, serverData.month);
      } else {
        showToast(`✅ 다중 ${actionName} 완료!`, 2500);
      }
    });
  }, 50);
}

function showModal(day, clickedIdx) {
  let dayData = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  if (!dayData || dayData.length === 0) return;
  let titleText = "",
    dateStr = "";
  if (day === "pending") {
    titleText = "⚠️ 입고 보류 / 대기 상세";
    dateStr = "미정";
  } else {
    const dayOfWeekIdx = ["일", "월", "화", "수", "목", "금", "토"];
    const dayOfWeek = dayOfWeekIdx[new Date(serverData.year, serverData.month - 1, day).getDay()];
    titleText = `${serverData.month}월 ${day}일 (${dayOfWeek})`;
    dateStr = _ymd(serverData.year, serverData.month, day);
  }
  document.getElementById("modalTitle").innerText = titleText;
  let contentHtml = "";
  dayData.forEach((item, idx) => {
    let isItemDone = item.isDone === true || String(item.isDone) === "true";
    let typeIcon = item.sType === "SEA" ? "🚢" : "✈️";

    let isAir = item.sType === "AIR";
    let pastelBg = isAir ? "#ff7eff" : "#26e2fd";
    let iconOpacity = isItemDone ? "0.8" : "1";

    // 🚨 상세보기 창에만 예쁜 AI 알약 뱃지 장착!
    //let aiBadgeHtml = item.isAi ? `<span style="background:rgba(10,132,255,0.1); color:#0a84ff; border:1px solid rgba(10,132,255,0.3); padding:2px 6px; border-radius:8px; font-size:0.75em; font-weight:900; margin-left:8px; vertical-align:middle;">🤖 AI수정됨</span>` : '';

    let actionBtns = "";
    if (isAdmin) {
      if (!isItemDone) {
        actionBtns = `<div class="action-btn-group"><button class="done-toggle-btn" onclick="submitCMS('DONE', '${_argq(item.bl)}', '${dateStr}', ${idx}, false)">✅ 완료</button><button class="edit-toggle-btn" onclick="openEditForm('${day}', ${idx}, '${_argq(item.bl)}', '${dateStr}', '${item.pal}', '${_argq(item.etc || "")}')">✏️ 수정</button></div>`;
      } else {
        actionBtns = `<div class="action-btn-group"><button class="edit-toggle-btn" style="color:#ff9f0a; border: 1px solid #ff9f0a; background: rgba(255,159,10,0.1);" onclick="submitCMS('UNDO_DONE', '${_argq(item.bl)}', '${dateStr}', ${idx}, true)">⏪ 취소</button><button class="edit-toggle-btn" onclick="openEditForm('${day}', ${idx}, '${_argq(item.bl)}', '${dateStr}', '${item.pal}', '${_argq(item.etc || "")}')">✏️ 수정</button></div>`;
      }
    }

    let meaningfulEtc = item.etc
      ? item.etc.replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고완료)\]/g, "").trim()
      : "";
    let etcHtml = meaningfulEtc !== "" ? `<div class="modal-etc">📍 비고: ${_esc(meaningfulEtc)}</div>` : "";
    let stampHtml = isItemDone
      ? `<div class="status-badge"><span style="font-size: 1.1em; line-height: 1;">✔️</span> 입고 완료</div>`
      : "";

    contentHtml += `<div class="modal-card" id="modal-card-${day}-${idx}">
                              <div class="modal-icon" style="background-color: ${pastelBg}; opacity: ${iconOpacity}; box-shadow: 0 2px 5px rgba(0,0,0,0.15);"></div>
                              <div class="modal-info">
                                  <div class="modal-comp-row"><span class="modal-comp">${item.pal}P</span>${actionBtns}</div>
                                  <div class="modal-vol">📄 B/L: ${_esc(item.bl)} | ${typeIcon} 타입: ${_esc(item.sType)}</div>
                                  <div class="modal-detail-text">🏢 FWD: ${_esc(item.fwd || "-")} | 🧾 INV: ${_esc(item.invoice || "-")}</div>
                                  ${etcHtml}
                              </div>
                              ${stampHtml}
                          </div>`;
  });
  document.getElementById("modalContent").innerHTML = contentHtml;
  const _modal = document.getElementById("modal");
  _modal.style.display = "flex";
  const _modalBox = _modal.querySelector(".modal-box");
  if (_modalBox) _modalBox.scrollTop = 0;

  // 클릭한 항목 카드 강조 (여러 건일 때만 — 1건이면 강조 불필요)
  if (clickedIdx != null && dayData.length > 1) {
    const card = document.getElementById(`modal-card-${day}-${clickedIdx}`);
    if (card) {
      card.classList.add("modal-card-clicked");
      setTimeout(() => card.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
    }
  }
}

// ── 상세 모달 인라인 수정 상태 관리 ──
let _editState = null; // { day, idx, snapshot, saveArgs }

function _snapshotEdit(idx) {
  const g = (id) => {
    let e = document.getElementById(id);
    return e ? e.value : "";
  };
  return JSON.stringify([
    g(`edit-bl-${idx}`),
    g(`edit-pal-${idx}`),
    g(`edit-stype-${idx}`),
    g(`edit-fwd-${idx}`),
    g(`edit-invoice-${idx}`),
    g(`edit-date-${idx}`),
    g(`edit-etc-${idx}`),
  ]);
}
function _isEditDirty() {
  if (!_editState) return false;
  return _snapshotEdit(_editState.idx) !== _editState.snapshot;
}

async function closeEditForm(day, idx) {
  if (_isEditDirty()) {
    if (!(await uiConfirm("⚠️ 저장하지 않은 변경사항이 있습니다.\n변경을 취소하고 상세보기로 돌아갈까요?"))) return;
  }
  _editState = null;
  renderCalendar();
  showModal(day);
}

async function openEditForm(day, idx, bl, dateStr, pal, etc) {
  // 🔁 다른 일정 수정 중이면 변경사항 확인 후 전환 (아코디언)
  if (_editState && _editState.idx !== idx) {
    if (_isEditDirty()) {
      const save = await uiConfirm("✏️ 수정 중인 변경사항이 있습니다.", {
        okText: "저장하고 이동",
        cancelText: "변경취소 이동",
      });
      if (save) {
        const a = _editState.saveArgs;
        _editState = null;
        submitCMS("EDIT", a.bl, a.dateStr, a.idx);
        return;
      }
    }
    _editState = null;
    showModal(day);
  }

  const card = document.getElementById(`modal-card-${day}-${idx}`);
  if (!card) return;
  let inputDateVal = dateStr === "미정" ? "" : dateStr;
  let item = day === "pending" ? serverData.pendingItems[idx] : serverData.monthData[day][idx];

  let sType = item.sType || "";
  let fwd = item.fwd || "";
  let invoice = item.invoice || "";

  card.style.flexDirection = "";
  card.style.alignItems = "";
  // 🚨 폼 레이블(글자) 위아래 여백을 줘서 인풋창에 절대 안 겹치게 만듭니다!
  card.innerHTML = `
          <div class="edit-form" style="width: 100%; padding:0; border:none; margin-top:0;">
            <div class="form-label" style="margin-bottom: 6px; margin-top: 5px;">📦 B/L 번호</div>
            <input type="text" id="edit-bl-${idx}" class="edit-input" value="${_esc(bl)}">
            
            <div style="display:flex; gap:10px;">
              <div style="flex:1;">
                <div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">수량 (PAL)</div>
                <input type="number" min="0" id="edit-pal-${idx}" class="edit-input" value="${pal}">
              </div>
              <div style="flex:1;">
                <div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">운송 타입</div>
                <select id="edit-stype-${idx}" class="edit-input" style="background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23a0a0a0%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 15px top 50%; background-size: 10px auto;">
                  <option value="SEA" ${sType === "SEA" ? "selected" : ""}>🚢 해상 (SEA)</option>
                  <option value="AIR" ${sType === "AIR" ? "selected" : ""}>✈️ 항공 (AIR)</option>
                </select>
              </div>
            </div>

            <div style="display:flex; gap:10px;">
              <div style="flex:1;">
                <div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">포워더 (FWD)</div>
                <input type="text" id="edit-fwd-${idx}" class="edit-input" value="${_esc(fwd)}">
              </div>
              <div style="flex:1;">
                <div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">인보이스</div>
                <input type="text" id="edit-invoice-${idx}" class="edit-input" value="${_esc(invoice)}">
              </div>
            </div>

            <div class="form-label" style="margin-bottom: 6px; margin-top: 10px; display:flex; justify-content:space-between; align-items:center;">
              <span>입고일 (날짜)</span>
              <span style="color:#ff3b30; cursor:pointer; font-weight:800; font-size:0.85em; padding:4px 8px; background:rgba(255,59,48,0.1); border-radius:6px; transition:0.2s;" onclick="document.getElementById('edit-date-${idx}').value='';" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">✕ 미정(대기)으로 변경</span>
            </div>
            <input type="date" id="edit-date-${idx}" class="edit-input" value="${inputDateVal}">

            <div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">비고 (메모 입력)</div>
            <input type="text" id="edit-etc-${idx}" class="edit-input" value="${_esc(etc !== "undefined" ? etc : "")}">
            
            <div class="btn-row" style="margin-top: 15px; padding-bottom: 10px;">
              <button class="save-btn" onclick="submitCMS('EDIT', '${_argq(bl)}', '${dateStr}', ${idx})">💾 저장</button>
              <button class="cancel-btn" onclick="closeEditForm('${day}', ${idx})">취소</button>
            </div>
            <button class="delete-btn" style="margin-bottom: 15px;" onclick="submitCMS('DELETE', '${_argq(bl)}', '${dateStr}', ${idx})">🗑️ 이 스케줄 삭제</button>
          </div>
        `;

  // 수정 상태 기록
  _editState = {
    day,
    idx,
    snapshot: _snapshotEdit(idx),
    saveArgs: { bl, dateStr, idx },
  };
}

// =====================================================
// 🚀 [OCR 최종 패치] 광활한 핀치 투 줌/이동 엔진 (먹통 버그 해결)
// =====================================================
let ocrTransform = { scale: 1, x: 0, y: 0 };
let ocrImgFit = { w: 0, h: 0 }; // 패널에 맞춘 기준 크기(scale=1 기준) — 크기 기반 줌으로 선명도 유지
let ocrBakedScale = 1; // 현재 width/height 로 구워진(crisp) 배율. 제스처 중엔 transform 으로 그 위에 덧씌움
let _ocrBakeTimer = null;
let ocrEditRows = []; // 대조창에서 수정 중인 행 데이터(확정 시 서버로 전송)
let ocrOrigRows = []; // 불러온 직후 원본(변경된 행만 골라내기 위한 기준)
let ocrHiliteIdx = null; // 현재 하이라이트 중인 행 index (왼쪽 이미지 밴드 + 오른쪽 셀)
let _ocrSelectedCell = null; // 첫 탭으로 선택된 셀 {idx, field} — 같은 셀 두 번째 탭에서 편집
let _ocrKbBound = false; // PC 키보드(엑셀형) 핸들러 1회만 바인딩
let _ocrClipboard = null; // Ctrl+C 내부 폴백(클립보드 권한 없을 때)
const _ocrG = {
  dragging: false,
  moved: false,
  lastX: 0,
  lastY: 0,
  startX: 0,
  startY: 0,
  pinchDist: 0,
  startScale: 1,
  downTarget: null,
};
let _ocrWinBound = false;
// 대조 표 컬럼 정의 (key = ocrEditRows 의 필드명)
const OCR_COLS = [
  { key: "bl", label: "B/L번호", w: 92, align: "center" },
  { key: "pal", label: "PAL", w: 40, align: "center" },
  { key: "eta", label: "ETA", w: 84, align: "center" },
  { key: "inDate", label: "입고일", w: 84, align: "center" },
  { key: "fwd", label: "Fwd", w: 52, align: "center" },
  { key: "sType", label: "Type", w: 46, align: "center" },
  { key: "invoice", label: "인보이스", w: 80, align: "center" },
  { key: "etc", label: "비고", w: 120, align: "left" },
];

function showLastOcrImage() {
  document.getElementById("ocrImageModal").style.display = "flex";
  document.getElementById("ocrImageContent").innerHTML = "불러오는 중... ⏳";
  ocrTransform = { scale: 1, x: 0, y: 0 };
  // Raw 파싱 텍스트 보기 — 로그인 관리자만
  const rawWrap = document.getElementById("rawOcrToggleWrap");
  if (rawWrap) rawWrap.style.display = "none"; // 옛 위치(상단) 버튼 숨김 — 하단 버튼줄로 이동
  const rawArea = document.getElementById("raw-ocr-textarea-container");
  if (rawArea) rawArea.style.display = "none"; // 열려있던 raw 패널 닫기

  apiCall({ source: "vercel", domain: "system", action: "GET_LAST_OCR_IMAGE" }).then(function (res) {
    if (res === null) {
      document.getElementById("ocrImageContent").innerHTML = "이미지 로딩 에러";
      return;
    }
    let url = res && res.url ? res.url : typeof res === "string" ? res : "";
    if (url && url.startsWith("http")) {
      document.getElementById("ocrImageContent").innerHTML = `
        <div style="display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;">
          <div id="ocrHint" style="flex:0 0 auto; font-size:11px; color:var(--text-sub,#888); padding:0 2px 6px; text-align:center; line-height:1.4;">
            두 손가락=확대 · 한 손가락=이동
          </div>
          <div id="ocrSplitWrap" style="flex:1 1 auto; display:flex; overflow:hidden; background:#e9ecef; border-radius:8px; position:relative;">
            <div id="ocrPaneImg" style="flex:1 1 100%; min-width:0; overflow:hidden; position:relative; touch-action:none;">
              <img id="ocrImgElement" src="${url}" alt="스케줄 이미지" draggable="false" onload="ocrImgLoaded()" style="position:absolute; left:0; top:0; display:block; transform-origin:center center; user-select:none; -webkit-user-drag:none; -moz-user-select:none; will-change:transform;">
            </div>
            <div id="ocrSplitDivider" title="드래그해서 좌우 너비 조절" style="display:none; flex:0 0 8px; align-items:center; justify-content:center; cursor:col-resize; background:#cfd4da; touch-action:none; position:relative; z-index:6;">
              <div style="width:2px; height:44px; border-radius:2px; background:#7b828c; pointer-events:none;"></div>
            </div>
            <div id="ocrPaneTable" style="flex:0 0 0%; width:0; min-width:0; overflow:auto; -webkit-overflow-scrolling:auto; background:#fff; position:relative; display:none;">
              <div id="ocrTableInner" style="padding:2px; min-width:max-content; transform-origin:0 0;"></div>
            </div>
          </div>
          <div style="flex:0 0 auto; padding:8px 4px 2px; display:flex; gap:5px;">
            <button onclick="resetOcrTransform()" style="flex:0 0 auto; padding:11px 12px; background:var(--border-color,#444); color:var(--text-main,#fff); border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:13px;">↺</button>
            ${
              isAdmin
                ? `<button id="ocrRawBtn" onclick="toggleRawOcrView()" style="flex:0 0 auto; padding:11px 10px; background:var(--border-color,#444); color:var(--text-main,#fff); border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:13px;">📄 Raw</button>
            <button id="ocrCompareBtn" onclick="toggleOcrCompare(this)" style="flex:1.3 1 auto; padding:11px 8px; background:#4a90e2; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">📊 대조·수정 켜기</button>
            <button id="ocrAddRowBtn" onclick="addOcrBlankRow()" style="display:none; flex:0 0 auto; padding:11px 10px; background:#0a84ff; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">➕ 행</button>
            <button id="ocrVerifyBtn" onclick="verifyOcrRows(this)" style="display:none; flex:1 1 auto; padding:11px 8px; background:#f39c12; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">🔍 검증</button>
            <button id="ocrApplyBtn" onclick="applyOcrEdits(this)" style="display:none; flex:1 1 auto; padding:11px 8px; background:#27ae60; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:14px;">📌 확정</button>`
                : ``
            }
          </div>
        </div>
      `;
      initOcrSplitGestures();
      initOcrSplitDivider();
    } else {
      document.getElementById("ocrImageContent").innerHTML =
        '<div style="color:var(--text-sub); font-weight:800;">현재 서버에 등록된 최신 이미지가 없습니다.</div>';
    }
  });
}

// 대조·수정 모드 토글 (로그인 관리자 전용) — 기본은 이미지만, 켜면 우측에 편집 표
function toggleOcrCompare(btn) {
  if (!isAdmin) return;
  const pane = document.getElementById("ocrPaneTable");
  const imgPane = document.getElementById("ocrPaneImg");
  const applyBtn = document.getElementById("ocrApplyBtn");
  const verifyBtn = document.getElementById("ocrVerifyBtn");
  const addRowBtn = document.getElementById("ocrAddRowBtn");
  const rawBtn = document.getElementById("ocrRawBtn");
  const rawContainer = document.getElementById("raw-ocr-textarea-container");
  const divider = document.getElementById("ocrSplitDivider");
  const hint = document.getElementById("ocrHint");
  if (!pane || !imgPane) return;
  const isOn = pane.style.display !== "none";
  if (isOn) {
    // 끄기 → 이미지 전체
    pane.style.display = "none";
    pane.style.flex = "0 0 0%";
    imgPane.style.flex = "1 1 100%";
    if (divider) divider.style.display = "none";
    if (applyBtn) applyBtn.style.display = "none";
    if (verifyBtn) verifyBtn.style.display = "none";
    if (addRowBtn) addRowBtn.style.display = "none";
    if (rawBtn) rawBtn.style.display = ""; // 이미지보기로 복귀 → Raw 버튼 다시 표시
    btn.innerHTML = "📊 대조·수정 켜기";
    btn.style.background = "#4a90e2";
    if (hint) hint.innerHTML = "두 손가락=확대 · 한 손가락=이동";
    resetOcrTransform();
  } else {
    // 켜기 → 좌우 분할 + 데이터 로드
    pane.style.display = "block";
    pane.style.flex = "1 1 50%";
    imgPane.style.flex = "1 1 50%";
    if (divider) divider.style.display = "flex"; // 가운데 드래그 구분선 노출
    if (applyBtn) applyBtn.style.display = "block";
    if (verifyBtn) verifyBtn.style.display = "block";
    if (addRowBtn) addRowBtn.style.display = "block";
    if (rawBtn) rawBtn.style.display = "none"; // 대조·수정 모드에선 Raw 버튼 숨김
    if (rawContainer) rawContainer.style.display = "none"; // 열려있던 Raw 패널 닫기
    btn.innerHTML = "🖼️ 이미지만 보기";
    btn.style.background = "#e74c3c";
    if (hint)
      hint.innerHTML = "오른쪽 <b style='color:#4a90e2;'>셀 탭=수정</b> + 왼쪽 이미지에 그 줄 표시 · 왼쪽 핀치=확대";
    resetOcrTransform();
    loadOcrSplitData();
  }
}

// 대조창 가운데 구분선 드래그 → 좌(이미지)/우(표) 너비 비율 자유 조절
function initOcrSplitDivider() {
  const divider = document.getElementById("ocrSplitDivider");
  const wrap = document.getElementById("ocrSplitWrap");
  const imgPane = document.getElementById("ocrPaneImg");
  const tablePane = document.getElementById("ocrPaneTable");
  if (!divider || !wrap || !imgPane || !tablePane) return;
  let dragging = false;
  const apply = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    let ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0.15, Math.min(0.85, ratio)); // 한쪽이 너무 좁아지지 않게 제한
    imgPane.style.flex = `0 0 ${(ratio * 100).toFixed(1)}%`;
    tablePane.style.flex = "1 1 auto";
  };
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    try {
      divider.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    apply(e.clientX);
    e.preventDefault();
  });
  const end = (e) => {
    dragging = false;
    try {
      divider.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };
  divider.addEventListener("pointerup", end);
  divider.addEventListener("pointercancel", end);
}

// 대조창 데이터 로드 → 편집용 배열 생성 → 표 렌더 (제스처는 모달 열 때 이미 바인딩됨)
//  서버가 [OCR 파싱행 + 마지막 OCR 이후 추가/수정된 입고일정(_fromDb)]을 합쳐서 내려줌.
//  → 직접 추가분도 보이되, 새 이미지로 OCR하면 _fromDb 범위가 리셋되어 자동으로 빠짐(무한 누적 방지)
function loadOcrSplitData() {
  ocrHiliteIdx = null;
  const inner = document.getElementById("ocrTableInner");
  if (!inner) return;
  inner.innerHTML = `<div style="padding:20px; text-align:center; color:#888; font-size:12px;">데이터 불러오는 중... ⏳</div>`;
  apiCall({ source: "vercel", domain: "system", action: "GET_LAST_OCR_DATA" }).then(function (data) {
    const innerNow = document.getElementById("ocrTableInner");
    if (!innerNow) return;
    currentRawOcrString = (data && data.rawData) || "가져온 Raw 데이터가 존재하지 않습니다.";

    const parsed = data && Array.isArray(data.parsedData) ? data.parsedData : [];
    ocrEditRows = parsed.map((r) => ({
      bl: r.bl || "",
      pal: r.pal != null ? String(r.pal) : "0",
      eta: r.eta || "",
      inDate: r.inDate || "미정",
      fwd: r.fwd || "",
      sType: r.sType || "",
      invoice: r.invoice || "",
      etc: r.etc || "",
      iy: typeof r.iy === "number" ? r.iy : null, // 이미지 내 세로 위치(px)
      ih: typeof r.ih === "number" ? r.ih : null,
      cx: r.cx && typeof r.cx === "object" ? r.cx : null, // 열별 X(px) 맵
      _fromDb: !!r._fromDb, // 마지막 OCR 이후 달력에서 추가/수정된 행(좌표 없음) — 검증 제외 + 파란 음영
    }));
    ocrOrigRows = JSON.parse(JSON.stringify(ocrEditRows)); // 변경 비교 기준

    if (ocrEditRows.length === 0) {
      innerNow.innerHTML = `<div style="padding:20px; text-align:center; color:#888; font-size:12px;">저장된 파싱 데이터가 없습니다.</div>`;
      return;
    }
    renderOcrTable();
  });
}

// ocrEditRows 기반으로 편집 가능한 표 렌더 (자연 너비 + 가로스크롤, 셀 탭=수정)
function renderOcrTable() {
  const inner = document.getElementById("ocrTableInner");
  if (!inner) return;
  let html = `<table style="border-collapse:collapse; font-size:12px; color:#333; white-space:nowrap;">
    <thead><tr>`;
  OCR_COLS.forEach((c) => {
    html += `<th style="padding:7px 8px; border:1px solid #ddd; background:#f1f3f5; position:sticky; top:0; z-index:2;">${c.label}</th>`;
  });
  html += `</tr></thead><tbody>`;
  ocrEditRows.forEach((row, idx) => {
    // 달력 저장분(직접 추가 등)은 연한 파랑으로 구분 (OCR 파싱 행과 시각적 구분)
    const bg = row._fromDb ? "#eaf4ff" : idx % 2 ? "#fafbfc" : "#fff";
    html += `<tr style="background:${bg};">`;
    OCR_COLS.forEach((c) => {
      const v = row[c.key] != null ? String(row[c.key]) : "";
      const wrap = c.key === "etc" ? "white-space:normal; max-width:200px;" : "";
      html += `<td onclick="onOcrCellTap(this)" data-idx="${idx}" data-field="${c.key}" data-bg="${bg}" style="padding:7px 8px; border:1px solid #ddd; text-align:${c.align}; cursor:pointer; background:${bg}; ${wrap}">${_esc(v)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  inner.innerHTML = html;
  // PC 키보드(엑셀형 이동/편집/복사) 핸들러 1회 바인딩
  if (!_ocrKbBound) {
    document.addEventListener("keydown", _onOcrKeydown);
    _ocrKbBound = true;
  }
}

// ➕ 대조 표에 빈 행 추가 — OCR이 누락한 일정을 이미지 보면서 직접 입력 → '확정'으로 저장
function addOcrBlankRow() {
  if (!isAdmin) {
    showToast("⚠️ 로그인한 관리자만 추가할 수 있습니다.", 2500);
    return;
  }
  ocrEditRows.push({
    bl: "",
    pal: "0",
    eta: "",
    inDate: "미정",
    fwd: "",
    sType: "",
    invoice: "",
    etc: "",
    iy: null,
    ih: null,
    cx: null,
    _fromDb: true, // 직접 추가 행 — OCR 원본 검증 제외
  });
  renderOcrTable();
  // 새 행으로 스크롤 + 잠깐 강조
  const pane = document.getElementById("ocrPaneTable");
  const inner = document.getElementById("ocrTableInner");
  if (pane) pane.scrollTop = pane.scrollHeight;
  if (inner) {
    const lastRow = inner.querySelectorAll("tbody tr");
    const tr = lastRow[lastRow.length - 1];
    if (tr) {
      tr.querySelectorAll("td").forEach((td) => (td.style.background = "#fff8d6"));
    }
  }
  showToast("➕ 빈 행을 추가했습니다. 셀을 두 번 탭해 입력 후 '확정'하세요.", 2600);
}

// 왼쪽 이미지 위 하이라이트 밴드 element 확보
function ensureOcrHiliteBand() {
  const pane = document.getElementById("ocrPaneImg");
  if (!pane) return null;
  let band = document.getElementById("ocrHiliteBand");
  if (!band) {
    band = document.createElement("div");
    band.id = "ocrHiliteBand";
    band.style.cssText =
      "position:absolute; left:0; right:0; pointer-events:none; background:rgba(255,200,0,0.30); border-top:2px solid #f5a623; border-bottom:2px solid #f5a623; display:none; z-index:5; transition:top 0.3s ease, height 0.3s ease;";
    pane.appendChild(band);
  }
  return band;
}

// 현재 하이라이트 행을 왼쪽 이미지의 해당 위치(현재 줌/이동 반영)에 밴드로 표시
function positionOcrHilite() {
  const band = ensureOcrHiliteBand();
  const img = document.getElementById("ocrImgElement");
  const pane = document.getElementById("ocrPaneImg");
  if (!band || !img || !pane) return;
  const r = ocrHiliteIdx != null ? ocrEditRows[ocrHiliteIdx] : null;
  if (!r || typeof r.iy !== "number" || !img.naturalHeight || !ocrImgFit.h) {
    band.style.display = "none";
    return;
  }
  const f = r.iy / img.naturalHeight; // 이미지 세로 비율(0~1)
  const dispH = ocrImgFit.h * ocrTransform.scale; // 화면상 이미지 높이
  const screenY = pane.clientHeight / 2 + (f - 0.5) * dispH + ocrTransform.y;
  const rowFrac = typeof r.ih === "number" && r.ih > 0 ? r.ih / img.naturalHeight : 0.03;
  let bandH = Math.max(rowFrac * dispH * 1.8, 16);
  band.style.top = screenY - bandH / 2 + "px";
  band.style.height = bandH + "px";
  band.style.display = "block";
}

// 셀 탭 시 → 왼쪽 이미지를 그 행(+탭한 열)으로 확대(4.5배) + 정렬(가장자리 클램프)
const OCR_LEFT_COLS = new Set(["bl", "pal", "eta", "inDate"]); // 좌측 영역 열
function locateOcrImage(idx, field) {
  const r = ocrEditRows[idx];
  const img = document.getElementById("ocrImgElement");
  const pane = document.getElementById("ocrPaneImg");
  if (!img || !pane || !r || typeof r.iy !== "number" || !img.naturalHeight || !ocrImgFit.w) return false;
  const f = Math.max(0, Math.min(r.iy / img.naturalHeight, 1)); // 이미지 세로 비율(0~1)
  const targetScale = 4.5;
  ocrTransform.scale = targetScale;
  const dispH = ocrImgFit.h * targetScale;
  const dispW = ocrImgFit.w * targetScale;
  const paneH = pane.clientHeight;
  const paneW = pane.clientWidth;
  // 세로: 그 행을 중앙으로, 단 이미지가 패널 밖 빈공간 안 보이게 클램프
  let y = dispH * (0.5 - f);
  if (dispH > paneH) {
    const lim = (dispH - paneH) / 2;
    y = Math.max(-lim, Math.min(y, lim));
  } else y = 0;
  ocrTransform.y = y;
  // 가로: 탭한 열의 X로 중앙 정렬. 그 열 좌표 없으면 좌/우 영역 대표값으로 폴백
  const cx = r.cx || {};
  let ix = field && typeof cx[field] === "number" ? cx[field] : null;
  if (ix == null) {
    if (field && OCR_LEFT_COLS.has(field)) ix = typeof cx.bl === "number" ? cx.bl : cx.invoice;
    else ix = typeof cx.invoice === "number" ? cx.invoice : cx.bl;
  }
  if (typeof ix === "number" && img.naturalWidth && dispW > paneW) {
    const fx = Math.max(0, Math.min(ix / img.naturalWidth, 1));
    const lim = (dispW - paneW) / 2;
    ocrTransform.x = Math.max(-lim, Math.min(dispW * (0.5 - fx), lim));
  } else {
    ocrTransform.x = dispW > paneW ? (dispW - paneW) / 2 : 0; // 좌표 없으면 좌측 정렬(기존)
  }
  img.style.transition = "transform 0.3s ease";
  applyOcrTransform();
  if (_ocrBakeTimer) clearTimeout(_ocrBakeTimer);
  _ocrBakeTimer = setTimeout(() => {
    img.style.transition = "none";
    bakeOcr();
  }, 320);
  return true;
}

// 셀 탭 시 → 그 줄을 양쪽(왼쪽 이미지 밴드 + 오른쪽 셀)에 하이라이트
function highlightOcrRow(idx) {
  ocrHiliteIdx = idx;
  const inner = document.getElementById("ocrTableInner");
  if (inner) {
    inner.querySelectorAll('td[data-hl="1"]').forEach((td) => {
      td.style.background = td.getAttribute("data-bg") || "";
      td.removeAttribute("data-hl");
    });
    inner.querySelectorAll(`td[data-idx="${idx}"]`).forEach((td) => {
      td.setAttribute("data-hl", "1");
      td.style.background = "#ffe08a";
    });
  }
  positionOcrHilite();
}

// 셀 선택(테두리 + 이미지 정렬 + 줄 하이라이트) — 탭/키보드 공통
function selectOcrCell(idx, field, locate = true) {
  const inner = document.getElementById("ocrTableInner");
  if (!inner || !ocrEditRows[idx]) return;
  inner.querySelectorAll('td[data-sel="1"]').forEach((c) => {
    c.removeAttribute("data-sel");
    c.style.boxShadow = "";
  });
  const td = inner.querySelector(`td[data-idx="${idx}"][data-field="${field}"]`);
  if (!td) return;
  td.setAttribute("data-sel", "1");
  td.style.boxShadow = "inset 0 0 0 2px #4a90e2";
  _ocrSelectedCell = { idx, field };
  try {
    td.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch (_) {}
  if (locate) {
    locateOcrImage(idx, field); // 왼쪽 이미지를 그 줄·그 열로 확대·정렬
    highlightOcrRow(idx); // 그 줄 양쪽 하이라이트
  }
}

const _ocrColIndex = (field) => OCR_COLS.findIndex((c) => c.key === field);

// 화살표/탭 이동 (엑셀형) — 범위 밖이면 가장자리에 머무름
function moveOcrSel(dRow, dCol) {
  if (!_ocrSelectedCell) return;
  const maxRow = ocrEditRows.length - 1;
  const maxCol = OCR_COLS.length - 1;
  let ni = Math.max(0, Math.min(maxRow, _ocrSelectedCell.idx + dRow));
  let nc = Math.max(0, Math.min(maxCol, _ocrColIndex(_ocrSelectedCell.field) + dCol));
  selectOcrCell(ni, OCR_COLS[nc].key);
}

// 셀 값 직접 설정(키보드 Delete/붙여넣기 등) → 데이터 + 화면 + 수정표시
function setOcrCellValue(idx, field, val) {
  if (!ocrEditRows[idx]) return;
  ocrEditRows[idx][field] = val;
  const inner = document.getElementById("ocrTableInner");
  const td = inner && inner.querySelector(`td[data-idx="${idx}"][data-field="${field}"]`);
  if (td && !td.querySelector("input")) {
    td.innerHTML = _esc(val);
    td.style.background = "#fff8d6"; // 수정 표시(노랑)
    if (_ocrSelectedCell && _ocrSelectedCell.idx === idx && _ocrSelectedCell.field === field) {
      td.setAttribute("data-sel", "1");
      td.style.boxShadow = "inset 0 0 0 2px #4a90e2";
    }
  }
}

// PC 키보드 핸들러 — 대조표가 열려있고 셀이 선택된 상태에서만 동작(모바일/다른 입력엔 영향 X)
function _onOcrKeydown(e) {
  const modal = document.getElementById("ocrImageModal");
  const pane = document.getElementById("ocrPaneTable");
  if (!modal || modal.style.display !== "flex") return;
  if (!pane || pane.style.display === "none") return;
  if (!_ocrSelectedCell) return;
  const inner = document.getElementById("ocrTableInner");
  if (!inner) return;
  // 셀 편집 중(input 존재)이면 input 자체 keydown(Enter/Tab/Esc)이 처리 → 여기선 손대지 않음
  if (inner.querySelector("td input")) return;
  // 표 밖의 다른 입력(검색창 등)에 포커스가 있으면 무시
  const ae = document.activeElement;
  if (ae && /^(input|textarea|select)$/i.test(ae.tagName) && !ae.closest("#ocrTableInner")) return;

  const k = e.key;
  const cur = _ocrSelectedCell;
  if (k === "ArrowUp") {
    e.preventDefault();
    moveOcrSel(-1, 0);
  } else if (k === "ArrowDown") {
    e.preventDefault();
    moveOcrSel(1, 0);
  } else if (k === "ArrowLeft") {
    e.preventDefault();
    moveOcrSel(0, -1);
  } else if (k === "ArrowRight") {
    e.preventDefault();
    moveOcrSel(0, 1);
  } else if (k === "Tab") {
    e.preventDefault();
    moveOcrSel(0, e.shiftKey ? -1 : 1);
  } else if (k === "Enter" || k === "F2") {
    e.preventDefault();
    const td = inner.querySelector(`td[data-idx="${cur.idx}"][data-field="${cur.field}"]`);
    if (td) startEditOcrCell(td, cur.idx, cur.field);
  } else if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "C")) {
    e.preventDefault();
    const v = ocrEditRows[cur.idx] ? String(ocrEditRows[cur.idx][cur.field] ?? "") : "";
    _ocrClipboard = v;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).catch(() => {});
    const td = inner.querySelector(`td[data-idx="${cur.idx}"][data-field="${cur.field}"]`);
    if (td) {
      const ob = td.style.boxShadow;
      td.style.boxShadow = "inset 0 0 0 2px #27ae60"; // 복사 순간 초록 깜빡
      setTimeout(() => (td.style.boxShadow = ob), 220);
    }
  } else if ((e.ctrlKey || e.metaKey) && (k === "v" || k === "V")) {
    e.preventDefault();
    const apply = (t) => setOcrCellValue(cur.idx, cur.field, String(t == null ? "" : t).replace(/[\r\n\t]/g, " ").trim());
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard
        .readText()
        .then(apply)
        .catch(() => {
          if (_ocrClipboard != null) apply(_ocrClipboard);
        });
    } else if (_ocrClipboard != null) apply(_ocrClipboard);
  } else if (k === "Delete" || k === "Backspace") {
    e.preventDefault();
    setOcrCellValue(cur.idx, cur.field, "");
  } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 글자 바로 입력 → 그 글자로 편집 시작(엑셀처럼 덮어쓰기)
    e.preventDefault();
    const td = inner.querySelector(`td[data-idx="${cur.idx}"][data-field="${cur.field}"]`);
    if (td) startEditOcrCell(td, cur.idx, cur.field, k);
  }
}

// 셀 탭/클릭 진입점:
//  - 첫 탭(또는 다른 셀): 이미지 정렬 + 하이라이트만 (키보드 X) → 비교 가능
//  - 같은 셀 두 번째 탭: 인라인 편집 시작
function onOcrCellTap(td) {
  if (!td || td.querySelector("input")) return;
  const idx = parseInt(td.getAttribute("data-idx"));
  const field = td.getAttribute("data-field");
  if (isNaN(idx) || !field || !ocrEditRows[idx]) return;

  if (_ocrSelectedCell && _ocrSelectedCell.idx === idx && _ocrSelectedCell.field === field) {
    startEditOcrCell(td, idx, field); // 두 번째 탭 → 편집
    return;
  }
  selectOcrCell(idx, field); // 첫 탭 → 선택(이미지 이동 + 하이라이트)
}

// 📱 셀 편집 시: OCR 모달은 화면 꽉 찬 높이라 키보드가 하단을 가림 → '일반 모달처럼' 키보드 위 영역만큼으로
//   모달을 줄여 상단에 붙이고(visualViewport 기준), 편집 셀을 보이는 영역 안으로 스크롤.
//   ⚠️ 핵심: 포커스 틱/직후엔 모달 레이아웃을 절대 안 건드린다(건드리면 iOS가 키보드 등장을 취소함).
//      키보드가 실제로 떠서 viewport가 줄어든 뒤(visualViewport resize)에만 적용.
function _ocrFitModalAboveKeyboard(td) {
  const modal = document.getElementById("ocrImageModal");
  const box = modal && modal.querySelector(".modal-box");
  const pane = document.getElementById("ocrPaneTable");
  const vv = window.visualViewport;
  if (!modal || !box || !pane || !td || !vv) return; // vv 없으면 키보드 등장 우선(레이아웃 안 건드림)

  const cellIdx = parseInt(td.getAttribute("data-idx"));
  const cellField = td.getAttribute("data-field");
  let applied = false;
  let lastPaneH = 0; // 패널 높이 바뀔 때만 왼쪽 이미지 재정렬(불필요한 재줌 방지)
  const restore = () => {
    if (!applied) return;
    applied = false;
    modal.style.alignItems = "";
    box.style.removeProperty("height");
    box.style.removeProperty("max-height");
    box.style.transform = "";
    // 패널이 원래 크기로 돌아왔으니 이미지 기준 재계산 + 선택 셀로 재정렬
    requestAnimationFrame(() => {
      if (typeof computeOcrFit === "function") computeOcrFit();
      if (_ocrSelectedCell && typeof locateOcrImage === "function")
        locateOcrImage(_ocrSelectedCell.idx, _ocrSelectedCell.field);
      else if (typeof bakeOcr === "function") bakeOcr();
    });
  };
  const fit = () => {
    const input = td.querySelector("input");
    if (!input) return; // 편집 종료
    const kbVisible = vv.height < window.innerHeight - 80;
    if (kbVisible) {
      // 모달을 키보드 위 영역만큼으로 줄여 상단에 붙임 → 표 전체가 키보드 위로 올라옴
      modal.style.alignItems = "flex-start";
      box.style.setProperty("height", vv.height + "px", "important");
      box.style.setProperty("max-height", vv.height + "px", "important");
      box.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
      applied = true;
      // 편집 셀이 보이는 영역 안에 오도록 스크롤
      const paneRect = pane.getBoundingClientRect();
      const tdRect = td.getBoundingClientRect();
      if (tdRect.bottom > paneRect.bottom - 4) pane.scrollTop += tdRect.bottom - (paneRect.bottom - 4);
      else if (tdRect.top < paneRect.top + 4) pane.scrollTop += tdRect.top - (paneRect.top + 4);
      // 🔑 왼쪽 이미지 패널 크기가 줄었으니 기준 재계산 후 그 셀로 다시 정렬(확대 위치 어긋남 수정)
      const imgPane = document.getElementById("ocrPaneImg");
      const ph = imgPane ? imgPane.clientHeight : 0;
      if (ph && ph !== lastPaneH) {
        lastPaneH = ph;
        if (typeof computeOcrFit === "function") computeOcrFit();
        if (!isNaN(cellIdx) && typeof locateOcrImage === "function") locateOcrImage(cellIdx, cellField);
      }
    } else {
      restore();
    }
  };

  // 키보드가 떠서 viewport가 변한 뒤에만(디바운스로 안정 후) 모달을 맞춤 → 포커스 틱 무간섭
  let deb = null;
  const onVV = () => {
    if (deb) clearTimeout(deb);
    deb = setTimeout(() => {
      if (td.querySelector("input")) fit();
    }, 100);
  };
  vv.addEventListener("resize", onVV);
  vv.addEventListener("scroll", onVV);
  // resize 이벤트가 안 오는 환경 대비 늦게 한 번 시도(이때쯤 키보드 떠 있음)
  const fallback = setTimeout(() => {
    if (td.querySelector("input")) fit();
  }, 500);

  // 편집 끝나면(입력칸 사라지면) 정리 + 모달 원복
  const watch = setInterval(() => {
    if (!td.querySelector("input")) {
      clearInterval(watch);
      clearTimeout(fallback);
      if (deb) clearTimeout(deb);
      vv.removeEventListener("resize", onVV);
      vv.removeEventListener("scroll", onVV);
      // 다른 셀로 편집이 이어지는 중이면 모달 상태 유지(셀 이동 시 깜빡임 방지)
      if (!document.querySelector("#ocrTableInner td input")) restore();
    }
  }, 250);
}

// 인라인 입력 편집 시작 (initial: 키보드로 글자 바로 쳐서 진입 시 그 글자로 덮어씀)
function startEditOcrCell(td, idx, field, initial) {
  if (td.querySelector("input")) return;
  const cur = ocrEditRows[idx][field] != null ? String(ocrEditRows[idx][field]) : "";
  const align = (OCR_COLS.find((c) => c.key === field) || {}).align || "center";
  const startVal = initial != null ? initial : cur;
  td.innerHTML = `<input type="text" value="${_esc(startVal)}" style="width:100%; box-sizing:border-box; border:2px solid #4a90e2; border-radius:3px; padding:3px 2px; font-size:11px; text-align:${align}; outline:none;">`;
  const input = td.querySelector("input");
  input.focus();
  if (initial != null) {
    const L = input.value.length;
    input.setSelectionRange(L, L); // 글자 덮어쓰기 진입 → 커서 끝
  } else {
    input.select();
  }
  _ocrFitModalAboveKeyboard(td); // 📱 모달을 키보드 위 영역만큼으로 줄여 편집 셀이 항상 보이게
  let done = false;
  // move: "down"(Enter) | "right"/"left"(Tab) | "stay"(blur/제자리)
  const commit = (move) => {
    if (done) return;
    done = true;
    ocrEditRows[idx][field] = input.value;
    td.innerHTML = _esc(input.value);
    td.style.background = "#fff8d6"; // 수정 표시(노랑)
    const ci = _ocrColIndex(field);
    if (move === "down") selectOcrCell(Math.min(idx + 1, ocrEditRows.length - 1), field);
    else if (move === "right") selectOcrCell(idx, OCR_COLS[Math.min(ci + 1, OCR_COLS.length - 1)].key);
    else if (move === "left") selectOcrCell(idx, OCR_COLS[Math.max(ci - 1, 0)].key);
    else selectOcrCell(idx, field); // 제자리 재선택 → 키보드 내비 계속 가능
  };
  const cancel = () => {
    if (done) return;
    done = true;
    td.innerHTML = _esc(cur);
    selectOcrCell(idx, field);
  };
  input.addEventListener("blur", () => commit("stay"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation(); // _onOcrKeydown 재진입 방지 (마지막 행: 수정→선택 전환)
      commit("down");
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation(); // _onOcrKeydown 재진입 방지 (이중 이동 방지)
      commit(e.shiftKey ? "left" : "right");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });
}

// 🔍 검증 — 저장된 원본 OCR 텍스트와 파싱 데이터를 대조 (API 사용 0)
//   각 행의 B/L·인보이스·ETA·입고일 값이 원본 텍스트에 실제로 있는지 확인 → 없으면 빨강(확인필요)
function verifyOcrRows() {
  if (!ocrEditRows || ocrEditRows.length === 0) {
    showToast("검증할 데이터가 없습니다.", 2000);
    return;
  }
  const norm = (v) =>
    String(v == null ? "" : v)
      .toUpperCase()
      .replace(/[\s•·\-\*/().,]/g, "");
  const rawNorm = norm(currentRawOcrString);
  if (!rawNorm || rawNorm.length < 10) {
    showToast("원본 OCR 텍스트가 없어 검증할 수 없습니다. (새 OCR 필요)", 3000);
    return;
  }
  // 형식/자리 판별기
  const cleanBL = (v) => String(v || "").replace(/[\s•·\-\*]/g, "");
  const isBLok = (v) => {
    const c = cleanBL(v);
    return /^[A-Za-z]{2,5}\d{5,9}$/.test(c) || c === "발행전";
  };
  const isInvOk = (v) => /^\d{7,8}$/.test(String(v).trim()) || /^PI-?\d{4}-?\d{3,4}$/i.test(String(v).trim());
  const hasInvLike = (v) => /\d{7,8}/.test(String(v)) || /PI-?\d{4}-?\d{3,4}/i.test(String(v));
  const isDateOk = (v) => /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(v).trim());
  const isPalOk = (v) => /^\d{1,3}$/.test(String(v).trim());
  const inRaw = (v) => {
    const k = norm(v);
    return k.length < 4 || rawNorm.includes(k); // 짧은 값(발행전 등)은 통과
  };

  const inner = document.getElementById("ocrTableInner");
  let warnRows = 0;
  const details = []; // 사유 상세 목록
  ocrEditRows.forEach((r, idx) => {
    const issues = {}; // field -> 사유
    // 달력 저장분/직접 추가 행(_fromDb)은 OCR 원본 텍스트 대조 대상이 아님 → 셀 색만 원복하고 건너뜀
    if (!r._fromDb) {
      // B/L: 형식 + 원본존재
      if (r.bl) {
        if (!isBLok(r.bl)) issues.bl = "B/L 형식 아님";
        else if (!inRaw(r.bl)) issues.bl = "원본에 없음";
      }
      // 인보이스: 있으면 형식·존재 / 없는데 비고에 인보이스 형식이 있으면 '비고로 샘'
      if (r.invoice) {
        if (!isInvOk(r.invoice)) issues.invoice = "인보이스 형식 아님";
        else if (!inRaw(r.invoice)) issues.invoice = "원본에 없음";
      } else if (r.etc && hasInvLike(r.etc)) {
        issues.etc = "인보이스가 비고에 섞인 듯";
      }
      // 날짜: 형식 + 존재
      ["eta", "inDate"].forEach((f) => {
        if (r[f]) {
          if (!isDateOk(r[f])) issues[f] = "날짜 형식 아님";
          else if (!inRaw(r[f])) issues[f] = "원본에 없음";
        }
      });
      // PAL: 숫자 형식
      if (r.pal && !isPalOk(r.pal)) issues.pal = "PAL 형식 아님";
    }

    const cells = inner ? inner.querySelectorAll(`td[data-idx="${idx}"]`) : [];
    cells.forEach((td) => {
      if (td.querySelector("input")) return;
      td.style.background = td.getAttribute("data-bg") || ""; // 먼저 원복
      td.removeAttribute("title");
    });
    const keys = Object.keys(issues);
    if (keys.length) {
      warnRows++;
      cells.forEach((td) => {
        const f = td.getAttribute("data-field");
        if (issues[f]) {
          td.style.background = "#ffd1d1"; // 확인필요 = 빨강
          td.title = issues[f];
        }
      });
      // 사유 상세(모바일은 title 안 보이므로 안내줄에 풀어서 표시)
      const blLabel = r.bl || "발행전";
      keys.forEach((f) => {
        const colLabel = (OCR_COLS.find((c) => c.key === f) || {}).label || f;
        details.push(`${idx + 1}행(${blLabel}) ${colLabel}: ${issues[f]}`);
      });
    }
  });

  // 행 개수 대조 — 공백 기준 토큰 분리 후 완전 매칭(SEA+인보이스 연결 오매칭 방지)
  const rawTokens = currentRawOcrString.toUpperCase().split(/[\s\n\r•·*/().,\-]+/).filter(Boolean);
  const rawRowCount = rawTokens.filter((t) => /^[A-Za-z]{2,5}\d{5,9}$/.test(t)).length + (currentRawOcrString.match(/발행\s*전/g) || []).length;
  // 행수 비교는 OCR 파싱 행만 대상(직접 추가/달력 저장분 _fromDb 제외)
  const ocrRowCount = ocrEditRows.filter((r) => !r._fromDb).length;
  const countNote =
    rawRowCount && rawRowCount !== ocrRowCount ? ` · ⚠️행수 원본 ${rawRowCount}/표 ${ocrRowCount}` : "";

  const problem = warnRows || countNote;
  const head = warnRows
    ? `🔍 ${ocrRowCount}건 중 ${warnRows}건 확인필요${countNote}`
    : countNote
    ? `⚠️ 개별 오류 없음${countNote}`
    : `✅ 검증 완료 — 이상 없음`;
  // 사유를 안내줄에 직접 표시(모바일 title 미지원) — 너무 많으면 앞 6건만
  let detailHtml = "";
  if (details.length) {
    const shown = details.slice(0, 6);
    detailHtml =
      `<div style="margin-top:4px; font-weight:normal; color:var(--text-sub,#666); font-size:10.5px; line-height:1.5; text-align:left;">` +
      shown.map((d) => _esc(d)).join("<br>") +
      (details.length > shown.length ? `<br>…외 ${details.length - shown.length}건` : "") +
      `</div>`;
  }
  const hint = document.getElementById("ocrHint");
  if (hint) hint.innerHTML = `<b style="color:${problem ? "#e74c3c" : "#27ae60"};">${head}</b>${detailHtml}`;
  showToast(head, 4000);
}

// 줌/이동 원위치 (패널 크기가 바뀌었을 수 있으니 기준 크기 재계산)
function resetOcrTransform() {
  ocrTransform = { scale: 1, x: 0, y: 0 };
  ocrBakedScale = 1;
  computeOcrFit();
  bakeOcr();
}

// '수정 확정' → 서버 upsert
async function applyOcrEdits(btn) {
  if (!isAdmin) {
    showToast("⚠️ 로그인한 관리자만 수정할 수 있습니다.", 2500);
    return;
  }
  if (!ocrEditRows || ocrEditRows.length === 0) {
    showToast("⚠️ 적용할 데이터가 없습니다.", 2500);
    return;
  }
  // 행에 의미있는 데이터가 하나라도 있는지 (pal 0 / 미정 / 빈값은 '없음'으로 취급)
  const meaningful = (r) => {
    if (!r) return false;
    const t = (v) => String(v == null ? "" : v).trim();
    return (
      t(r.bl) !== "" ||
      t(r.invoice) !== "" ||
      t(r.fwd) !== "" ||
      t(r.etc) !== "" ||
      t(r.eta) !== "" ||
      t(r.sType) !== "" ||
      (t(r.pal) !== "" && t(r.pal) !== "0") ||
      (t(r.inDate) !== "" && t(r.inDate) !== "미정")
    );
  };

  // 변경된 행만 추려서 전송 (전체 덮어쓰기 방지) + 다 비운 행은 삭제 대상으로 분리
  const FLD = ["bl", "pal", "eta", "inDate", "fwd", "sType", "invoice", "etc"];
  const changed = [];
  const deletes = [];
  ocrEditRows.forEach((r, i) => {
    const o = ocrOrigRows[i] || {};
    if (!meaningful(r)) {
      // 행 데이터를 전부 지운 경우: 원래 일정이 있던 행이면 '삭제', 빈 행 그대로면 무시
      if (meaningful(o)) deletes.push({ bl: o.bl || "", invoice: o.invoice || "", inDate: o.inDate || "" });
      return;
    }
    if (FLD.some((f) => String(r[f] == null ? "" : r[f]) !== String(o[f] == null ? "" : o[f]))) changed.push(r);
  });

  if (changed.length === 0 && deletes.length === 0) {
    showToast("변경된 내용이 없습니다.", 2500);
    return;
  }

  let confirmMsg = "";
  if (changed.length) confirmMsg += `수정/추가 ${changed.length}건`;
  if (deletes.length) confirmMsg += (confirmMsg ? "\n" : "") + `🗑️ 빈 행 ${deletes.length}건의 입고 일정을 삭제`;
  confirmMsg += "\n입고 DB에 반영할까요?";
  if (!(await uiConfirm(confirmMsg, deletes.length ? { danger: true, okText: "반영" } : { okText: "반영" }))) return;

  const orig = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "반영 중... ⏳";
  }
  apiCall({
    source: "vercel",
    domain: "system",
    action: "APPLY_OCR_DATA",
    admin_id: localStorage.getItem("admin_id"),
    data: { rows: changed, deletes: deletes },
  }).then(function (res) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
    if (res && res.success) {
      const delPart = res.deleteCount > 0 ? ` / 삭제 ${res.deleteCount}` : "";
      const skipPart = res.skipCount > 0 ? ` / 완료건 건너뜀 ${res.skipCount}` : "";
      showToast(`✅ 반영 완료 (신규 ${res.insertCount} / 수정 ${res.updateCount}${delPart}${skipPart})`, 3000);
      if (typeof navMonth === "function") navMonth(0);
      loadOcrSplitData(); // 대조표 새로고침(삭제된 빈 행 제거 + 최신값 반영 + 기준 갱신)
    } else {
      showToast("⚠️ " + ((res && res.msg) || "반영에 실패했습니다."), 3000);
    }
  });
}

// 패널 크기에 맞춘 기준 표시 크기(scale=1) 계산 — contain 방식
function computeOcrFit() {
  const pane = document.getElementById("ocrPaneImg");
  const img = document.getElementById("ocrImgElement");
  if (!pane || !img || !img.naturalWidth) return;
  const pw = pane.clientWidth;
  const ph = pane.clientHeight;
  const ratio = img.naturalWidth / img.naturalHeight;
  let w = pw;
  let h = pw / ratio;
  if (h > ph) {
    h = ph;
    w = ph * ratio;
  }
  ocrImgFit = { w, h };
}

// 이미지 로드 완료 시 기준 크기 잡고 배치
function ocrImgLoaded() {
  resetOcrTransform();
}

// 제스처 중(매 프레임): 가벼운 GPU transform 만 갱신 → 부드러움. 표는 같은 배율로 동기화(시각용 transform)
function applyOcrTransform() {
  const img = document.getElementById("ocrImgElement");
  if (img && ocrImgFit.w) {
    const rel = ocrTransform.scale / ocrBakedScale;
    img.style.transform = `translate3d(${ocrTransform.x}px, ${ocrTransform.y}px, 0) scale(${rel})`;
  }
  positionOcrHilite();
}

// 손 뗀 뒤(1회): 현재 배율을 실제 width/height 로 구워 선명하게. 표는 zoom 으로 확정(스크롤 영역도 확장)
function bakeOcr() {
  const img = document.getElementById("ocrImgElement");
  const pane = document.getElementById("ocrPaneImg");
  if (img && pane && ocrImgFit.w) {
    ocrBakedScale = ocrTransform.scale;
    const w = ocrImgFit.w * ocrBakedScale;
    const h = ocrImgFit.h * ocrBakedScale;
    img.style.width = w + "px";
    img.style.height = h + "px";
    img.style.left = (pane.clientWidth - w) / 2 + "px";
    img.style.top = (pane.clientHeight - h) / 2 + "px";
    img.style.transform = `translate3d(${ocrTransform.x}px, ${ocrTransform.y}px, 0) scale(1)`;
  }
  positionOcrHilite();
}

// 제스처 끝나면 살짝 뒤에 굽기 (휠 연속 입력 대비 디바운스)
function scheduleOcrBake() {
  if (_ocrBakeTimer) clearTimeout(_ocrBakeTimer);
  _ocrBakeTimer = setTimeout(bakeOcr, 140);
}

// 이미지 패널 전용 핀치 줌/이동 (표 패널은 네이티브 스크롤 + 셀 onclick 편집)
function initOcrSplitGestures() {
  const imgPane = document.getElementById("ocrPaneImg");
  if (!imgPane) return;

  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

  // ── 터치
  imgPane.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        _ocrG.dragging = true;
        _ocrG.moved = false;
        _ocrG.lastX = _ocrG.startX = e.touches[0].clientX;
        _ocrG.lastY = _ocrG.startY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        e.preventDefault();
        _ocrG.dragging = false;
        _ocrG.pinchDist = dist(e.touches);
        _ocrG.startScale = ocrTransform.scale;
        const m = mid(e.touches);
        _ocrG.lastX = m.x;
        _ocrG.lastY = m.y;
      }
    },
    { passive: false },
  );

  imgPane.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 1 && _ocrG.dragging) {
        if (Math.abs(e.touches[0].clientX - _ocrG.startX) > 6 || Math.abs(e.touches[0].clientY - _ocrG.startY) > 6)
          _ocrG.moved = true;
        if (_ocrG.moved) {
          e.preventDefault();
          ocrTransform.x += e.touches[0].clientX - _ocrG.lastX;
          ocrTransform.y += e.touches[0].clientY - _ocrG.lastY;
          _ocrG.lastX = e.touches[0].clientX;
          _ocrG.lastY = e.touches[0].clientY;
          requestAnimationFrame(applyOcrTransform);
        }
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const cd = dist(e.touches);
        ocrTransform.scale = Math.max(1, Math.min(_ocrG.startScale * (cd / _ocrG.pinchDist), 8));
        const m = mid(e.touches);
        ocrTransform.x += m.x - _ocrG.lastX;
        ocrTransform.y += m.y - _ocrG.lastY;
        _ocrG.lastX = m.x;
        _ocrG.lastY = m.y;
        requestAnimationFrame(applyOcrTransform);
      }
    },
    { passive: false },
  );

  imgPane.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      if (ocrTransform.scale <= 1) {
        ocrTransform.scale = 1;
        ocrTransform.x = 0;
        ocrTransform.y = 0;
      }
      bakeOcr(); // 손 떼면 현재 배율로 선명하게 굽기
      _ocrG.dragging = false;
      _ocrG.moved = false;
    } else if (e.touches.length === 1) {
      // 핀치 중 한 손가락만 뗌 → 남은 손가락으로 드래그 이어가기(점프 방지)
      _ocrG.dragging = true;
      _ocrG.moved = true;
      _ocrG.lastX = e.touches[0].clientX;
      _ocrG.lastY = e.touches[0].clientY;
    }
  });

  // ── 마우스(PC)
  imgPane.addEventListener("mousedown", (e) => {
    _ocrG.dragging = true;
    _ocrG.moved = false;
    _ocrG.lastX = _ocrG.startX = e.clientX;
    _ocrG.lastY = _ocrG.startY = e.clientY;
  });
  imgPane.addEventListener("mousemove", (e) => {
    if (!_ocrG.dragging) return;
    if (Math.abs(e.clientX - _ocrG.startX) > 6 || Math.abs(e.clientY - _ocrG.startY) > 6) _ocrG.moved = true;
    if (_ocrG.moved) {
      ocrTransform.x += e.clientX - _ocrG.lastX;
      ocrTransform.y += e.clientY - _ocrG.lastY;
      _ocrG.lastX = e.clientX;
      _ocrG.lastY = e.clientY;
      requestAnimationFrame(applyOcrTransform);
    }
  });

  imgPane.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      ocrTransform.scale = Math.max(1, Math.min(ocrTransform.scale + delta, 8));
      if (ocrTransform.scale <= 1) {
        ocrTransform.x = 0;
        ocrTransform.y = 0;
      }
      requestAnimationFrame(applyOcrTransform);
      scheduleOcrBake(); // 휠 멈추면 선명하게 굽기
    },
    { passive: false },
  );

  // window mouseup 은 1회만 바인딩
  if (!_ocrWinBound) {
    _ocrWinBound = true;
    window.addEventListener("mouseup", () => {
      if (_ocrG.dragging && _ocrG.moved) bakeOcr();
      _ocrG.dragging = false;
    });
  }
}

function closeModalOnBgClick(e) {
  if (isLongPress || isMultiMode) return;
  if (e.target === document.getElementById("modal")) {
    _editState = null;
    document.getElementById("modal").style.display = "none";
    clearClickedHighlight();
  }
  if (e.target === document.getElementById("ocrImageModal"))
    document.getElementById("ocrImageModal").style.display = "none";
  if (e.target === document.getElementById("dashboardModal"))
    document.getElementById("dashboardModal").style.display = "none";
}

function toggleTheme() {
  const body = document.body;
  const themeBtn = document.querySelector(".theme-toggle");
  if (isDarkMode) {
    body.classList.add("light-mode");
    isDarkMode = false;
    if (themeBtn) themeBtn.innerText = "🌙";
    localStorage.setItem("cal_theme", "light");
    document.documentElement.style.background = "#f4f6f9";
  } else {
    body.classList.remove("light-mode");
    isDarkMode = true;
    if (themeBtn) themeBtn.innerText = "☀️";
    localStorage.setItem("cal_theme", "dark");
    document.documentElement.style.background = "#212225";
  }
  // PWA 상태바/주소창 색도 테마에 맞게 (다크에서 흰 상태바 방지)
  const tcMeta = document.querySelector('meta[name="theme-color"]');
  if (tcMeta) tcMeta.setAttribute("content", isDarkMode ? "#212225" : "#f4f6f9");
}

// =====================================================
// 🚀 [스텔스 자동 동기화 엔진] (귀신 데이터 & 가짜 토스트 완벽 차단)
// =====================================================
function silentBackgroundSync() {
  // 🚨 스마트폰 네트워크가 기절해 있거나 끄고 켤 때, 드래그 중일 때는 무조건 스킵!
  // 수정 — fabDragging도 함께 체크
  if (!navigator.onLine || isDragging || window.fabDragging || activeRequests > 0) return;
  let modal = document.getElementById("modal");
  let addModal = document.getElementById("addModal");
  let ocrModal = document.getElementById("ocrImageModal");
  let dashModal = document.getElementById("dashboardModal");
  if (
    (modal && modal.style.display === "flex") ||
    (addModal && addModal.style.display === "flex") ||
    (ocrModal && ocrModal.style.display === "flex") ||
    (dashModal && dashModal.style.display === "flex")
  )
    return;
  let fetchStartTime = Date.now();

  // 🚨 [핵심 1] 심부름 보내기 직전의 '연/월'과 '달력 번호표'를 박제해둡니다!
  const reqYear = serverData.year;
  const reqMonth = serverData.month;
  const reqNavId = window.currentNavId;

  apiGet({ type: currentType, year: reqYear, month: reqMonth }).then((res) => {
    if (res === null) return;
    if (reqYear !== serverData.year || reqMonth !== serverData.month || reqNavId !== window.currentNavId) return;
    if (typeof lastLocalUpdateTime !== "undefined" && lastLocalUpdateTime > fetchStartTime) return;

    res.year = reqYear;
    res.month = reqMonth;
    res.firstDay = new Date(reqYear, reqMonth - 1, 1).getDay();
    res.daysInMonth = new Date(reqYear, reqMonth, 0).getDate();

    const getScheduleSig = (dataObj) => {
      if (!dataObj) return "";
      const norm = (v) => {
        let s = v == null || v === "" ? "" : String(v).trim();
        return s === "0" || s === "" ? "" : s;
      };
      let sigs = [];
      if (dataObj.pendingItems)
        dataObj.pendingItems.forEach((it) =>
          sigs.push(`P_${it.company || it.bl || ""}_${norm(it.pal)}_${norm(it.box)}_${it.etc || ""}_${it.isDone}`),
        );
      if (dataObj.monthData) {
        for (let d in dataObj.monthData)
          dataObj.monthData[d].forEach((it) =>
            sigs.push(`${d}_${it.company || it.bl || ""}_${norm(it.pal)}_${norm(it.box)}_${it.etc || ""}_${it.isDone}`),
          );
      }
      return sigs.sort().join("||");
    };
    let isScheduleChanged = getScheduleSig(serverData) !== getScheduleSig(res);
    if (isScheduleChanged) {
      serverData = res;
      localStorage.setItem(`cal_cache_${currentType}_${reqYear}_${reqMonth}`, JSON.stringify(res));
      renderCalendar();
      showToast("🔄 새로운 스케줄이 업데이트되었습니다.", 2000);
    }
    updateSyncTime();
  });
}

// 수정
setInterval(() => {
  if (!window.fabDragging && document.visibilityState === "visible") silentBackgroundSync();
}, 60000);
// 수정 — 드래그 중이면 sync 건너뛰기
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !window.fabDragging) silentBackgroundSync();
});

// =====================================================
// 📊 [개발 추가] 입고 통계 대시보드 스크립트 모음
// =====================================================
window.dashMode = "month";
window.dashYear = new Date().getFullYear(); // 월간용 년도
window.dashMonth = new Date().getMonth() + 1;
window.dashYearlyYear = new Date().getFullYear(); // 🚨 연간 전용 년도 (완벽 분리!)
let yearlyCache = {};
let mainChartIns = null;
let shareChartIns = null;
window.dashCurrentData = null;

function updateStatsSummary() {
  let tPal = 0,
    dPal = 0;
  const process = (it) => {
    let rawName = String(it.bl || it.company || "").trim();
    if (!rawName || rawName === "미정") return;
    tPal += parseInt(it.pal) || 0;
    // 🚨 입고(status='완료') 또는 출고(isDone=true) 로직을 모두 커버하여 완벽하게 카운트합니다!
    if (it.isDone === true || String(it.isDone) === "true" || it.status === "완료") dPal += parseInt(it.pal) || 0;
  };

  // 미정 데이터 제외하고 날짜 확정된 데이터만 계산 (기존 로직 완벽 유지)
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (serverData.monthData[d]) serverData.monthData[d].forEach(process);
  }

  let elD = document.getElementById("sumDonePal");
  if (elD) elD.innerText = dPal;
  let elT = document.getElementById("sumTotalPal");
  if (elT) elT.innerText = tPal;

  // 🚀 [V2 게이지 바 애니메이션 로직 탑재] 계산된 숫자를 바탕으로 즉시 게이지를 채웁니다.
  const barEl = document.getElementById("progressBar");
  if (barEl) {
    let percent = tPal === 0 ? 0 : Math.round((dPal / tPal) * 100);
    setTimeout(() => {
      barEl.style.width = `${percent}%`;
      if (percent === 100 && tPal > 0) {
        // 완료: 단색 대신 또렷한 그라데이션(초록→에메랄드→틸)
        barEl.style.background = "linear-gradient(90deg, #30d158 0%, #2bc7a0 55%, #00b8d4 100%)";
      } else {
        barEl.style.background = "linear-gradient(90deg, #0a84ff 0%, #34c759 100%)";
      }
    }, 100);
  }
}

function openDashboard() {
  window.dashYear = serverData.year;
  window.dashMonth = serverData.month;
  window.dashYearlyYear = serverData.year;
  window.dashCurrentData = serverData;
  document.getElementById("dashboardModal").style.display = "flex";
  setTimeout(renderDashCharts, 380); // 모달 슬라이드인 끝난 뒤 생성해야 진입 애니메이션이 보임
}

function setDashMode(mode) {
  window.dashMode = mode;
  document.getElementById("btnDashMonth").classList.toggle("active", mode === "month");
  document.getElementById("btnDashYear").classList.toggle("active", mode === "year");

  // 🚨 [5번 해결] 탭 바꿀 때마다 각자의 독립된 년도/월 데이터로 강제 리프레시!
  if (mode === "year") {
    if (!yearlyCache[window.dashYearlyYear]) fetchYearlyAndRender();
    else renderDashCharts();
  } else {
    fetchDashMonthAndRender();
  }
}

function navDashDate(offset) {
  if (window.dashMode === "month") {
    window.dashMonth += offset;
    if (window.dashMonth > 12) {
      window.dashMonth = 1;
      window.dashYear++;
    } else if (window.dashMonth < 1) {
      window.dashMonth = 12;
      window.dashYear--;
    }
    fetchDashMonthAndRender();
  } else {
    window.dashYearlyYear += offset; // 🚨 연간 모드는 연간용 년도만 움직임
    fetchYearlyAndRender();
  }
}

function fetchDashMonthAndRender() {
  document.getElementById("dashTitleText").innerText = `${window.dashYear}년 ${window.dashMonth}월`;
  let sub = document.getElementById("dashSubTitleText");
  if (sub) sub.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약 (조회중)`;

  let cacheKey = `cal_cache_${currentType}_${window.dashYear}_${window.dashMonth}`;
  let cached = localStorage.getItem(cacheKey);
  let oldSig = null; // 🚨 [방어막 지문]

  if (cached) {
    try {
      window.dashCurrentData = JSON.parse(cached);
      // 로컬 캐시 알맹이 지문
      oldSig =
        JSON.stringify(window.dashCurrentData.monthData || {}) +
        JSON.stringify(window.dashCurrentData.pendingItems || []);
      renderDashCharts();
    } catch (e) {}
  } else {
    window.dashCurrentData = { monthData: {}, pendingItems: [] };
    renderDashCharts();
    document.getElementById("dashCardTitle1").innerText = "데이터 불러오는 중...";
    document.getElementById("dashAvg").innerText = "⏳";
  }

  // 🚀 Vercel API 백그라운드 호출 (기존 래퍼 사용)
  apiGet({ type: currentType, year: window.dashYear, month: window.dashMonth }).then((res) => {
    if (res === null) {
      if (window.dashMode === "month" && !cached)
        document.getElementById("dashTitleText").innerText = "불러오기 실패 🥲";
      return;
    }
    let finalData = typeof res === "string" ? JSON.parse(res) : res;
    let newSig = JSON.stringify(finalData.monthData || {}) + JSON.stringify(finalData.pendingItems || []);
    if (oldSig === newSig) {
      localStorage.setItem(cacheKey, JSON.stringify(finalData));
      let subTxt = document.getElementById("dashSubTitleText");
      if (subTxt) subTxt.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약`;
      return;
    }
    window.dashCurrentData = finalData;
    localStorage.setItem(cacheKey, JSON.stringify(finalData));
    if (window.dashMode === "month") {
      let subTxt = document.getElementById("dashSubTitleText");
      if (subTxt) subTxt.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약`;
      renderDashCharts();
    }
  });
}

function fetchYearlyAndRender() {
  document.getElementById("dashTitleText").innerText = `${window.dashYearlyYear}년`;
  let sub = document.getElementById("dashSubTitleText");
  if (sub) sub.innerText = `${window.dashYearlyYear}년 연간 요약 (조회중)`;

  let cacheKey = `yearly_stats_cache_${currentType}_${window.dashYearlyYear}`;
  let cached = localStorage.getItem(cacheKey);
  let oldSig = null; // 🚨 [방어막 지문]

  if (cached) {
    try {
      yearlyCache[window.dashYearlyYear] = JSON.parse(cached);
      let yData = yearlyCache[window.dashYearlyYear];
      oldSig = JSON.stringify(yData.monthly || []) + JSON.stringify(yData.comp || {});
      renderDashCharts();
    } catch (e) {}
  } else {
    let dummyArr = [];
    for (let i = 0; i < 12; i++) dummyArr.push({ pal: 0, box: 0, details: {} });
    yearlyCache[window.dashYearlyYear] = { year: window.dashYearlyYear, monthly: dummyArr, comp: {} };
    renderDashCharts();
    document.getElementById("dashCardTitle1").innerText = "데이터 불러오는 중...";
    document.getElementById("dashAvg").innerText = "⏳";
  }

  // 🚀 Vercel API 백그라운드 호출
  apiGet({ action: "yearlyStats", type: currentType, year: window.dashYearlyYear }).then((res) => {
    if (res === null) {
      if (window.dashMode === "year" && !cached)
        document.getElementById("dashTitleText").innerText = "불러오기 실패 🥲";
      return;
    }
    let newSig = JSON.stringify(res.monthly || []) + JSON.stringify(res.comp || {});
    if (oldSig === newSig) {
      yearlyCache[res.year] = res;
      localStorage.setItem(cacheKey, JSON.stringify(res));
      let subTxt = document.getElementById("dashSubTitleText");
      if (subTxt) subTxt.innerText = `${window.dashYearlyYear}년 연간 요약`;
      return;
    }
    yearlyCache[res.year] = res;
    localStorage.setItem(cacheKey, JSON.stringify(res));
    if (window.dashMode === "year" && window.dashYearlyYear === res.year) {
      let subTxt = document.getElementById("dashSubTitleText");
      if (subTxt) subTxt.innerText = `${window.dashYearlyYear}년 연간 요약`;
      renderDashCharts();
    }
  });
}

// 1. 도넛 가운데에 정보 띄우기 플러그인 유지
const pieCenterTextPlugin = {
  id: "pieCenterText",
  beforeDraw(chart) {
    if (chart.config.type !== "doughnut") return;
    const ctx = chart.ctx;
    const centerX = chart.chartArea.left + chart.chartArea.width / 2;
    const centerY = chart.chartArea.top + chart.chartArea.height / 2;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (window.activePieIndex !== null) {
      const idx = window.activePieIndex;
      const data = chart.data.datasets[0].data;
      const colors = chart.data.datasets[0].backgroundColor;
      const fullNames = chart.data.fullNames;
      const displayName = fullNames ? fullNames[idx] : chart.data.labels[idx];
      const totalSum = data.reduce((a, b) => a + b, 0);
      const percent = ((data[idx] / totalSum) * 100).toFixed(1);
      const unitStr = "P";

      ctx.font = "bold 15px -apple-system, sans-serif";
      ctx.fillStyle = colors[idx] !== "rgba(128,128,128,0.1)" ? colors[idx] : "#0a84ff";

      let textWidth = ctx.measureText(displayName).width;
      if (textWidth > 100) ctx.font = "bold 11px -apple-system, sans-serif";
      else if (textWidth > 80) ctx.font = "bold 13px -apple-system, sans-serif";

      ctx.fillText(displayName, centerX, centerY - 22, 100);

      ctx.font = "900 26px -apple-system, sans-serif";
      ctx.fillStyle = document.body.classList.contains("light-mode") ? "#222" : "#eee";
      ctx.fillText(`${percent}%`, centerX, centerY + 6);

      ctx.font = "bold 15px -apple-system, sans-serif";
      ctx.fillStyle = "gray";
      ctx.fillText(`(${data[idx]}${unitStr})`, centerX, centerY + 30);
    } else {
      ctx.font = "bold 14px -apple-system, sans-serif";
      ctx.fillStyle = "gray";
      ctx.fillText("👆 조각을", centerX, centerY - 10);
      ctx.fillText("터치하세요", centerX, centerY + 10);
    }
    ctx.restore();
  },
};

const pieHybridLabelPlugin = {
  id: "pieHybridLabel",
  afterDraw(chart) {
    if (chart.config.type !== "doughnut") return;
    const ctx = chart.ctx;
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    const labels = chart.data.labels;
    const totalSum = data.reduce((a, b) => a + b, 0);
    const centerX = chart.chartArea.left + chart.chartArea.width / 2;
    const centerY = chart.chartArea.top + chart.chartArea.height / 2;
    let rightLabels = [];
    let leftLabels = [];
    const isLight = document.body.classList.contains("light-mode");

    meta.data.forEach((element, index) => {
      if (data[index] === 0) return;
      const midAngle = element.startAngle + (element.endAngle - element.startAngle) / 2;
      const circumference = element.endAngle - element.startAngle;
      const radius = element.outerRadius;
      const isRight = Math.cos(midAngle) > 0;
      const percent = ((data[index] / totalSum) * 100).toFixed(1);
      const isActive = window.activePieIndex === null || window.activePieIndex === index;

      if (circumference > 0.35) {
        const r = element.innerRadius + (element.outerRadius - element.innerRadius) * 0.55;
        const x = centerX + Math.cos(midAngle) * r;
        const y = centerY + Math.sin(midAngle) * r;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = isActive ? "bold 13px -apple-system, sans-serif" : "13px -apple-system, sans-serif";
        ctx.fillStyle = isActive ? "#111" : "rgba(128,128,128,0.5)";
        ctx.fillText(labels[index], x, y - 6);
        ctx.font = isActive ? "bold 11px -apple-system, sans-serif" : "11px -apple-system, sans-serif";
        ctx.fillText(`${percent}%`, x, y + 8);
        ctx.restore();
      } else {
        const startX = centerX + Math.cos(midAngle) * radius;
        const startY = centerY + Math.sin(midAngle) * radius;
        let elbowX = centerX + Math.cos(midAngle) * (radius + 15);
        let elbowY = centerY + Math.sin(midAngle) * (radius + 15);
        const text = `${labels[index]} (${percent}%)`;
        ctx.font = "bold 11px -apple-system, sans-serif";
        let obj = { index, text, textWidth: ctx.measureText(text).width, startX, startY, elbowX, elbowY, isRight };
        if (isRight) rightLabels.push(obj);
        else leftLabels.push(obj);
      }
    });

    const avoidCollision = (lbls) => {
      lbls.sort((a, b) => a.elbowY - b.elbowY);
      let prevY = -9999;
      lbls.forEach((lbl) => {
        if (lbl.elbowY < prevY + 16) lbl.elbowY = prevY + 16;
        prevY = lbl.elbowY;
      });
    };
    avoidCollision(rightLabels);
    avoidCollision(leftLabels);

    ctx.save();
    ctx.textBaseline = "middle";
    const drawLabel = (lbl) => {
      let lineEndX, textX;
      if (lbl.isRight) {
        textX = chart.width - 2;
        ctx.textAlign = "right";
        lineEndX = textX - lbl.textWidth - 5;
        if (lineEndX < centerX + meta.data[0].outerRadius + 10) lineEndX = centerX + meta.data[0].outerRadius + 10;
      } else {
        textX = 2;
        ctx.textAlign = "left";
        lineEndX = textX + lbl.textWidth + 5;
        if (lineEndX > centerX - meta.data[0].outerRadius - 10) lineEndX = centerX - meta.data[0].outerRadius - 10;
      }

      let safeElbowX = lbl.elbowX;
      if (!lbl.isRight && safeElbowX > centerX - meta.data[0].outerRadius - 10)
        safeElbowX = centerX - meta.data[0].outerRadius - 10;
      if (lbl.isRight && safeElbowX < centerX + meta.data[0].outerRadius + 10)
        safeElbowX = centerX + meta.data[0].outerRadius + 10;
      const isActive = window.activePieIndex === null || window.activePieIndex === lbl.index;

      ctx.strokeStyle = isActive ? (isLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.3)") : "rgba(128,128,128,0.1)";
      ctx.beginPath();
      ctx.moveTo(lbl.startX, lbl.startY);
      ctx.lineTo(safeElbowX, lbl.elbowY);
      ctx.lineTo(lineEndX, lbl.elbowY);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lbl.startX, lbl.startY, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = isActive
        ? isLight
          ? "rgba(100,100,100,0.7)"
          : "rgba(180,180,180,0.7)"
        : "rgba(128,128,128,0.1)";
      ctx.fill();
      ctx.font = isActive ? "bold 11px -apple-system, sans-serif" : "11px -apple-system, sans-serif";
      ctx.fillStyle = isActive ? (isLight ? "#444" : "#ccc") : "rgba(128,128,128,0.3)";
      ctx.fillText(lbl.text, textX, lbl.elbowY);
    };
    rightLabels.forEach(drawLabel);
    leftLabels.forEach(drawLabel);
    ctx.restore();
  },
};

// 🚨 chart.js(defer 로드) 준비 후에만 플러그인 등록 (Chart is not defined 방지)

_registerChartPlugins();

function renderDashCharts() {
  Chart.defaults.color = document.body.classList.contains("light-mode") ? "#777" : "#a0a0a0";
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';

  let unitName = "PAL";
  let labels = [];
  let seaData = [];
  let airData = [];
  let compMap = { "🚢 해상 (SEA)": 0, "✈️ 항공 (AIR)": 0 };
  let barDetails = [];
  let totalQty = 0;
  let doneQty = 0;
  document.getElementById("barDetailBox").style.display = "none";
  const includePending = document.getElementById("includePendingCheck")?.checked;

  if (window.dashMode === "month") {
    document.getElementById("dashTitleText").innerText = `${window.dashYear}년 ${window.dashMonth}월`;
    let sub = document.getElementById("dashSubTitleText");
    if (sub) sub.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약`;

    let days = new Date(window.dashYear, window.dashMonth, 0).getDate();
    for (let d = 1; d <= days; d++) {
      labels.push(`${d}일`);
      seaData.push(0);
      airData.push(0);
      barDetails.push({ "🚢 해상 (SEA)": 0, "✈️ 항공 (AIR)": 0 });
    }

    const process = (it, dIdx) => {
      let clean = String(it.bl || "").trim();
      if (clean && clean !== "미정") {
        let qty = parseInt(it.pal) || 0;
        totalQty += qty;
        if (it.isDone === true || String(it.isDone) === "true") doneQty += qty;

        let isAir = it.sType === "AIR";
        let typeLabel = isAir ? "✈️ 항공 (AIR)" : "🚢 해상 (SEA)";

        if (dIdx !== null) {
          if (isAir) airData[dIdx - 1] += qty;
          else seaData[dIdx - 1] += qty;
          barDetails[dIdx - 1][typeLabel] += qty;
        }
        if (compMap[typeLabel] !== undefined) compMap[typeLabel] += qty;
      }
    };

    if (window.dashCurrentData) {
      for (let d = 1; d <= days; d++) {
        if (window.dashCurrentData.monthData && window.dashCurrentData.monthData[d])
          window.dashCurrentData.monthData[d].forEach((it) => process(it, d));
      }
      if (includePending && window.dashCurrentData.pendingItems)
        window.dashCurrentData.pendingItems.forEach((it) => process(it, null));
    }
  } else {
    // 🚨 [연간 차트 뻗음 버그 완벽 해결]
    document.getElementById("dashTitleText").innerText = `${window.dashYearlyYear}년`;
    let sub = document.getElementById("dashSubTitleText");
    if (sub) sub.innerText = `${window.dashYearlyYear}년 연간 요약`;
    for (let m = 1; m <= 12; m++) {
      labels.push(`${m}월`);
      seaData.push(0);
      airData.push(0);
      barDetails.push({ "🚢 해상 (SEA)": 0, "✈️ 항공 (AIR)": 0 });
    }

    let yData = yearlyCache[window.dashYearlyYear];
    if (yData) {
      for (let i = 0; i < 12; i++) {
        let mData = yData.monthly[i] || {};
        let details = mData.details || {};

        // 객체에서 .pal 수량을 명확하게 꺼내옵니다!
        let mSea = details["🚢 해상 (SEA)"] ? details["🚢 해상 (SEA)"].pal : 0;
        let mAir = details["✈️ 항공 (AIR)"] ? details["✈️ 항공 (AIR)"].pal : 0;

        seaData[i] = mSea;
        airData[i] = mAir;
        totalQty += parseInt(mData.pal) || 0;

        barDetails[i]["🚢 해상 (SEA)"] = mSea;
        barDetails[i]["✈️ 항공 (AIR)"] = mAir;
      }
      let ySea = yData.comp["🚢 해상 (SEA)"] ? yData.comp["🚢 해상 (SEA)"].pal : 0;
      let yAir = yData.comp["✈️ 항공 (AIR)"] ? yData.comp["✈️ 항공 (AIR)"].pal : 0;
      compMap = { "🚢 해상 (SEA)": ySea, "✈️ 항공 (AIR)": yAir };
    }

    if (includePending && window.dashCurrentData && window.dashCurrentData.pendingItems) {
      window.dashCurrentData.pendingItems.forEach((it) => {
        let clean = String(it.bl || "").trim();
        if (clean && clean !== "미정") {
          let qty = parseInt(it.pal) || 0;
          totalQty += qty;
          let isAir = it.sType === "AIR";
          let typeLabel = isAir ? "✈️ 항공 (AIR)" : "🚢 해상 (SEA)";
          if (compMap[typeLabel] !== undefined) compMap[typeLabel] += qty;
        }
      });
    }
  }

  // 상단 카드 요약 (기존 유지)
  if (window.dashMode === "month") {
    let rate = totalQty > 0 ? Math.round((doneQty / totalQty) * 100) : 0;
    let now = new Date();
    let isCurrentMonth = window.dashYear === now.getFullYear() && window.dashMonth === now.getMonth() + 1;
    let divider = isCurrentMonth
      ? Math.max(1, now.getDate())
      : new Date(window.dashYear, window.dashMonth, 0).getDate();
    let avgDaily = doneQty > 0 ? (doneQty / divider).toFixed(1) : 0;
    document.getElementById("dashCardTitle1").innerText = "당월 총 예정 물량";
    document.getElementById("dashTotal").innerHTML =
      `${totalQty.toLocaleString()} <span style="font-size:0.5em; color:var(--text-sub);">${unitName}</span>`;
    document.getElementById("dashVolDetail").innerText = `완료: ${doneQty.toLocaleString()} (${rate}%)`;
    document.getElementById("dashVolDetail").style.color = rate >= 100 ? "#34c759" : rate > 50 ? "#0a84ff" : "#ff9f0a";
    document.getElementById("dashCardTitle2").innerText = "일일 평균 처리량";
    document.getElementById("dashAvg").innerHTML =
      `${avgDaily} <span style="font-size:0.5em; color:var(--text-sub);">${unitName}/일</span>`;
    document.getElementById("dashDaysDetail").innerText = `(월 누적: ${doneQty.toLocaleString()})`;
  } else {
    // 🚨 [핵심 패치] 해상/항공 물량이 1이라도 존재하는 월의 개수만 추출!
    let activeMonths = 0;
    for (let i = 0; i < 12; i++) {
      if (seaData[i] + airData[i] > 0) activeMonths++;
    }
    let divider = activeMonths > 0 ? activeMonths : 1; // 0으로 나누기 방지
    let avgMonthly = totalQty > 0 ? Math.round(totalQty / divider) : 0;
    let avgDaily = totalQty > 0 ? (totalQty / 365).toFixed(1) : 0;

    document.getElementById("dashCardTitle1").innerText = "연간 총 누적수량";
    document.getElementById("dashTotal").innerHTML =
      `${totalQty.toLocaleString()} <span style="font-size:0.5em; color:var(--text-sub);">${unitName}</span>`;
    document.getElementById("dashVolDetail").innerText = `(1년 전체 합산)`;
    document.getElementById("dashVolDetail").style.color = "#0a84ff";
    document.getElementById("dashCardTitle2").innerText = "월간 평균 처리량";
    document.getElementById("dashAvg").innerHTML =
      `${avgMonthly.toLocaleString()} <span style="font-size:0.5em; color:var(--text-sub);">${unitName}/월</span>`;
    document.getElementById("dashDaysDetail").innerText = `(${divider}개월 평균 / 일평균: 약 ${avgDaily})`;
  }
  // 상단 카드 정보 업데이트 (기존 코드와 동일...)

  // 💡 스와이프(Hover) 선택을 위한 전역 공유 변수 할당
  window.dashSeaData = seaData;
  window.dashAirData = airData;
  window.dashBarDetails = barDetails;

  // 💡 1. 막대 색깔 하이라이트 + [빈 데이터 스킵(스냅) 로직]
  window.lastHoveredBarIndex = -1;
  window.highlightBarOnly = function (idx) {
    if (idx === null || idx === undefined || idx < 0) {
      window.lastHoveredBarIndex = -1;

      // 🚨 [버그 수정 2] 리셋할 때도 배열(Array) 형태로 원래 색을 꽉 채워줘야 Chart.js가 꼬이지 않습니다!
      mainChartIns.data.datasets[0].backgroundColor = new Array(labels.length).fill("#26e2fd");
      mainChartIns.data.datasets[1].backgroundColor = new Array(labels.length).fill("#ff7eff");

      // 🚨 추가: 툴팁(말풍선) 잔상도 확실하게 지워버립니다.
      if (mainChartIns.tooltip) {
        mainChartIns.tooltip.setActiveElements([], { x: 0, y: 0 });
      }

      mainChartIns.update();
      return;
    }
    // ... (이하 기존 코드 유지) ...

    let validIndices = [];
    for (let i = 0; i < labels.length; i++) {
      if (window.dashSeaData[i] + window.dashAirData[i] > 0) validIndices.push(i);
    }
    if (validIndices.length === 0) return;

    let closestIdx = validIndices[0];
    let minDiff = Math.abs(idx - closestIdx);
    for (let i = 1; i < validIndices.length; i++) {
      let diff = Math.abs(idx - validIndices[i]);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = validIndices[i];
      }
    }
    idx = closestIdx;

    if (idx === window.lastHoveredBarIndex) return;
    window.lastHoveredBarIndex = idx;

    let dimColor = document.body.classList.contains("light-mode") ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.05)";
    let newSeaColors = new Array(labels.length).fill(dimColor);
    newSeaColors[idx] = "#26e2fd";
    let newAirColors = new Array(labels.length).fill(dimColor);
    newAirColors[idx] = "#ff7eff";

    mainChartIns.data.datasets[0].backgroundColor = newSeaColors;
    mainChartIns.data.datasets[1].backgroundColor = newAirColors;

    if (mainChartIns.tooltip) {
      mainChartIns.tooltip.setActiveElements(
        [
          { datasetIndex: 0, index: idx },
          { datasetIndex: 1, index: idx },
        ],
        { x: 0, y: 0 },
      );
    }
    mainChartIns.update();
  };

  // 💡 2. 손 뗐을 때 상세내역 스르륵 호출
  window.showDetailBox = function (idx) {
    let detailBox = document.getElementById("barDetailBox");
    if (idx === null || idx === undefined || idx < 0) return;

    let details = window.dashBarDetails[idx];
    let total = window.dashSeaData[idx] + window.dashAirData[idx];
    if (total === 0) {
      detailBox.style.display = "none";
      return;
    }

    let timeLabel = window.dashMode === "month" ? `${idx + 1}일` : `${idx + 1}월`;
    let html = `<div style="font-weight:900; margin-bottom:10px; color:var(--text-main);">📅 ${timeLabel} 입고 내역 <span style="color:#0a84ff; font-size:0.9em;">(총 ${total}P)</span></div>`;
    html += `<div style="display:flex; flex-wrap:wrap; gap:8px;">`;

    if (details["🚢 해상 (SEA)"] > 0) {
      html += `<div style="display:flex; align-items:center; gap:6px; background:#26e2fd; color:#111; padding:6px 12px; border-radius:8px; font-size:0.95em; box-shadow: 0 2px 6px rgba(1,221,251,0.4);">
                      <span style="font-weight:900;">🚢 해상</span><span style="font-weight:800; opacity:0.9;">${details["🚢 해상 (SEA)"]}P</span>
                  </div>`;
    }
    if (details["✈️ 항공 (AIR)"] > 0) {
      html += `<div style="display:flex; align-items:center; gap:6px; background:#ff7eff; color:#111; padding:6px 12px; border-radius:8px; font-size:0.95em; box-shadow: 0 2px 6px rgba(255,107,159,0.4);">
                      <span style="font-weight:900;">✈️ 항공</span><span style="font-weight:800; opacity:0.9;">${details["✈️ 항공 (AIR)"]}P</span>
                  </div>`;
    }
    html += `</div>`;
    detailBox.innerHTML = html;
    detailBox.style.display = "block";
    detailBox.animate(
      [
        { opacity: 0, transform: "translateY(-5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 250, fill: "forwards" },
    );
  };

  if (mainChartIns) mainChartIns.destroy();

  // 🚨 [버그 수정 1] 차트 생성 시점부터 단일 색상(String)이 아닌 배열(Array)로 꽉 채워줍니다.
  let seaBgColors = new Array(labels.length).fill("#26e2fd");
  let airBgColors = new Array(labels.length).fill("#ff7eff");

  mainChartIns = new Chart(document.getElementById("mainChart"), {
    type: "bar",
    // 아래 backgroundColor를 배열 변수로 교체했습니다.
    data: {
      labels: labels,
      datasets: [
        { label: `🚢 해상`, data: seaData, backgroundColor: seaBgColors, stack: "Stack 0", borderRadius: 4 },
        { label: `✈️ 항공`, data: airData, backgroundColor: airBgColors, stack: "Stack 0", borderRadius: 4 },
      ],
    },
    options: {
      /* ... 기존 옵션 그대로 유지 ... */
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false, axis: "x" },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false,
          callbacks: {
            title: (items) => (window.dashMode === "month" ? `${items[0].label} 입고량` : `${items[0].label} 입고량`),
            label: () => null,
            footer: (items) => `총 ${items.reduce((a, b) => a + b.parsed.y, 0)}P`,
          },
        },
      },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true } },
      events: [],
    },
  });

  // 🚨 [커스텀 터치 엔진] 스킵 현상 및 손 뗄 때 튀는 현상 완벽 해결!
  const mainCanvas = document.getElementById("mainChart");
  mainCanvas.style.touchAction = "pan-y";

  let lastProcessedX = -999;
  const triggerChartInteraction = (clientX, isForce = false) => {
    if (!mainChartIns) return;

    // 💡 [수정된 핵심 데드존 로직]
    // 8픽셀 미만의 미세한 떨림은 무시하되, lastProcessedX 기준점은 '갱신하지 않음'!!
    // 이렇게 해야 천천히 움직여서 누적 거리가 8px을 넘었을 때 정상적으로 옆 칸으로 넘어갑니다 (스킵 버그 해결)
    if (!isForce && Math.abs(clientX - lastProcessedX) < 8) return;

    lastProcessedX = clientX; // 👈 8픽셀 이상 움직였을 때만 비로소 기준점 갱신!

    const rect = mainCanvas.getBoundingClientRect();
    const chartArea = mainChartIns.chartArea;
    if (!chartArea) return;

    let xCoord = clientX - rect.left;
    let x = Math.max(chartArea.left, Math.min(xCoord, chartArea.right));
    let width = chartArea.right - chartArea.left;
    let percent = (x - chartArea.left) / width;

    let idx = Math.floor(percent * labels.length);
    idx = Math.min(Math.max(idx, 0), labels.length - 1);
    window.highlightBarOnly(idx);
  };

  mainCanvas.ontouchstart = (e) => {
    triggerChartInteraction(e.touches[0].clientX, true);
  };
  mainCanvas.ontouchmove = (e) => {
    triggerChartInteraction(e.touches[0].clientX, false);
  };
  mainCanvas.ontouchend = () => {
    if (window.lastHoveredBarIndex >= 0) window.showDetailBox(window.lastHoveredBarIndex);
    else document.getElementById("barDetailBox").style.display = "none";
  };

  mainCanvas.onmousemove = (e) => {
    triggerChartInteraction(e.clientX, false);
  };
  mainCanvas.onclick = (e) => {
    triggerChartInteraction(e.clientX, true);
    if (window.lastHoveredBarIndex >= 0) window.showDetailBox(window.lastHoveredBarIndex);
    else document.getElementById("barDetailBox").style.display = "none";
  };
  mainCanvas.onmouseleave = () => {
    window.highlightBarOnly(-1);
  };

  // (이후 파이 차트 로직 유지)

  // 🍩 파이 차트
  window.activePieIndex = null;
  let sLabels = [];
  let sData = [];
  let sColors = [];
  if (compMap["🚢 해상 (SEA)"] > 0) {
    sLabels.push("🚢 해상 (SEA)");
    sData.push(compMap["🚢 해상 (SEA)"]);
    sColors.push("#26e2fd");
  }
  if (compMap["✈️ 항공 (AIR)"] > 0) {
    sLabels.push("✈️ 항공 (AIR)");
    sData.push(compMap["✈️ 항공 (AIR)"]);
    sColors.push("#ff7eff");
  }

  window.highlightPieSlice = function (idx) {
    if (!shareChartIns) return;
    const dataset = shareChartIns.data.datasets[0];
    let slider = document.getElementById("pieSlider");
    if (idx === null || String(idx) === "-1") {
      window.activePieIndex = null;
      dataset.backgroundColor = [...dataset._originalColors];
      if (slider) slider.value = -1;
    } else {
      window.activePieIndex = parseInt(idx, 10);
      dataset.backgroundColor = dataset._originalColors.map((color, i) =>
        i === window.activePieIndex
          ? color
          : document.body.classList.contains("light-mode")
            ? "rgba(0,0,0,0.05)"
            : "rgba(255,255,255,0.05)",
      );
      if (slider) slider.value = window.activePieIndex;
    }
    shareChartIns.update();
  };

  if (shareChartIns) shareChartIns.destroy();
  shareChartIns = new Chart(document.getElementById("shareChart"), {
    type: "doughnut",
    data: {
      labels: sLabels,
      datasets: [
        {
          data: sData,
          backgroundColor: [...sColors],
          _originalColors: [...sColors],
          borderWidth: 2,
          borderColor: document.body.classList.contains("light-mode") ? "#fff" : "#2a2c30",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: "easeOutQuart", animateRotate: true, animateScale: true },
      cutout: "55%",
      layout: { padding: { left: 50, right: 50, top: 15, bottom: 15 } },
      // 💡 [디테일 4 수정] datalabels 옵션을 꺼서 조각 안의 하얀 글씨(퍼센트) 영구 제거
      plugins: { legend: { display: false }, tooltip: { enabled: false }, datalabels: { display: false } },
      onClick: (e, activeElements) => {
        if (!activeElements || activeElements.length === 0) window.highlightPieSlice(-1);
        else {
          const idx = activeElements[0].index;
          if (window.activePieIndex === idx) window.highlightPieSlice(-1);
          else window.highlightPieSlice(idx);
        }
      },
    },
  });
}

// =====================================================
// 🚨 [패치] 바탕화면(빈 공간) 클릭 시 막대/파이차트 하이라이트 동시 해제
// =====================================================
document.getElementById("dashboardModal").addEventListener("click", function (e) {
  // 모달 배경(검은 여백)을 눌러서 창을 닫는 동작은 방해하지 않음
  if (e.target === this) return;

  // 1. 막대차트 리셋 (막대나 상세정보 박스가 아닌 빈 곳을 터치했을 때)
  if (window.lastHoveredBarIndex !== -1 && typeof window.highlightBarOnly === "function") {
    if (e.target.tagName !== "CANVAS" && !e.target.closest("#barDetailBox")) {
      window.highlightBarOnly(-1);
      document.getElementById("barDetailBox").style.display = "none";
    }
  }

  // 2. 파이차트 리셋 (파이나 슬라이더가 아닌 빈 곳을 터치했을 때)
  if (window.activePieIndex !== null && typeof window.highlightPieSlice === "function") {
    if (e.target.tagName !== "CANVAS" && e.target.id !== "pieSlider" && !e.target.closest("#pieSliderWrapper")) {
      window.highlightPieSlice(-1);
    }
  }
});

// 🚀 [앱 초기화]
window.addEventListener("DOMContentLoaded", () => {
  syncBlToggleUI(); // 칩 표시 토글 스위치 초기 상태 반영
  // 저장된 session_token 복원
  window._sessionToken = localStorage.getItem("session_token") || sessionStorage.getItem("session_token") || null;
  // bio_pw → bio_token 마이그레이션 (구형 등록 정리)
  if (localStorage.getItem("bio_pw")) {
    localStorage.removeItem("bio_pw");
    localStorage.removeItem("bio_registered");
    localStorage.removeItem("bio_id");
  }
  // 👇 🚨 [자동로그인 & GUEST 사이트 접속 추적기] 여기에 삽입! 👇
  let isAdm = localStorage.getItem("isAdmin") === "true" || sessionStorage.getItem("isAdmin") === "true";
  let currentAdminId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id") || "GUEST";
  let accessType = isAdm ? "AUTO_LOGIN" : "GUEST";

  // 사용자 환경 분석 (모바일/PC, 카카오/네이버/크롬/사파리 완벽 판별)
  let ua = navigator.userAgent.toLowerCase();
  let device = /mobile|android|iphone|ipad|ipod/.test(ua) ? "Mobile" : "PC";
  let browser = "Unknown";
  if (ua.includes("whale")) browser = "Whale";
  else if (ua.includes("samsungbrowser")) browser = "Samsung Internet";
  else if (ua.includes("edg")) browser = "Edge";
  else if (ua.includes("kakaotalk") || ua.includes("kakao"))
    browser = "KakaoTalk"; // 카톡 인앱 브라우저
  else if (ua.includes("naver"))
    browser = "Naver App"; // 네이버 인앱 브라우저
  else if (ua.includes("chrome") && !ua.includes("edg")) browser = "Chrome";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";
  // 서버에 추적 로그 전송 (실패해도 앱 구동에 영향 안 주게 방어)
  apiCall({
    source: "vercel",
    action: "LOG_SITE_ACCESS",
    admin_id: currentAdminId,
    access_type: accessType,
    description: `기기: ${device} / 브라우저: ${browser}`,
  });
  // 👆 -------------------------------------------------------- 👆

  // 🚨 세션 스토리지까지 함께 체크하도록 OR(||) 조건 추가!
  if (localStorage.getItem("isAdmin") === "true" || sessionStorage.getItem("isAdmin") === "true") {
    window.isAdmin = true;
    isAdmin = true;

    // 초록색 관리자 버튼으로 변신! (이 4줄만 남기면 끝입니다)
    const btn = document.getElementById("adminBtn");
    if (btn) {
      btn.innerHTML = "🔓 관리자";
      btn.className = "admin-btn unlocked";
      btn.removeAttribute("style");
    }

    const actions = document.getElementById("adminActions");
    if (actions) actions.style.display = "flex";

    if (typeof updateFooterUI === "function") updateFooterUI();
    // 👇 🚨여기에 딱 꽂아주시면 됩니다!
    if (typeof checkMasterAuthButtonVisibility === "function") {
      checkMasterAuthButtonVisibility();
    }
  } else {
    window.isAdmin = false;
    isAdmin = false;
  }

  const savedTheme = localStorage.getItem("cal_theme") || "light";
  // ... (아래부터는 기존 코드 그대로 유지) ...
  const themeBtn = document.querySelector(".theme-toggle");
  if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    isDarkMode = false;
    if (themeBtn) themeBtn.innerText = "🌙";
  } else {
    document.body.classList.remove("light-mode");
    isDarkMode = true;
    if (themeBtn) themeBtn.innerText = "☀️";
  }
  const savedSize = localStorage.getItem("cal_fontSize") || "M";
  changeSize(savedSize);

  // 👇 🚨 여기에 추가해 주시면 됩니다! 🚨 👇
  if (!isShowHoliday) {
    const btnHoliday = document.getElementById("btnHolidayToggle");
    if (btnHoliday) {
      btnHoliday.innerHTML = "🏖️ OFF";
      btnHoliday.style.color = "var(--text-sub)";
    }
  }
  // 👆 ----------------------------------- 👆

  updateFooterUI();

  let now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth() + 1;
  let cacheKey = `cal_cache_${currentType}_${currentYear}_${currentMonth}`;

  let cachedData = localStorage.getItem(cacheKey);
  let isCacheValid = false;
  // 💡 [여기에 딱 한 줄 추가!] 앱 켜자마자 올해 1년 치 빨간날부터 장전!
  checkAndFetchHolidays(currentYear);
  if (cachedData) {
    try {
      let parsed = JSON.parse(cachedData);
      serverData = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      serverData.year = currentYear;
      serverData.month = currentMonth;
      serverData.firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
      serverData.daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      if (!isNaN(serverData.year)) isCacheValid = true;
    } catch (e) {
      console.error("캐시 파싱 에러", e);
    }
  }

  if (!isCacheValid) {
    let tempFirstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    let tempDays = new Date(currentYear, currentMonth, 0).getDate();
    serverData = {
      year: currentYear,
      month: currentMonth,
      firstDay: tempFirstDay,
      daysInMonth: tempDays,
      monthData: {},
      pendingItems: [],
    };
  }

  renderCalendar();
  let fetchStartTime = Date.now();

  // 💡 OCR 통신도 백그라운드로 안전하게 요청
  apiCall({ source: "vercel", domain: "system", action: "GET_OCR_LAST_TIME" }).then(function (res) {
    if (res === null) return;
    let timeStr = res && res.time ? res.time : typeof res === "string" ? res : "최근 처리내역 없음";
    const el = document.getElementById("ocrTimeText");
    if (el) el.innerText = timeStr;
    if (typeof renderPcLeftbar === "function") renderPcLeftbar(); // PC 메뉴 OCR시간 갱신
  });

  // 💡 입고 데이터 백그라운드 동기화
  apiGet({ type: currentType, year: currentYear, month: currentMonth }).then(function (newData) {
    if (newData === null) return;
    if (typeof lastLocalUpdateTime !== "undefined" && lastLocalUpdateTime > fetchStartTime) return;

    newData.year = currentYear;
    newData.month = currentMonth;
    newData.firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    newData.daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    localStorage.setItem(cacheKey, JSON.stringify(newData));
    if (serverData.year === currentYear && serverData.month === currentMonth) {
      serverData = newData;
      renderCalendar();
    }
  });
  // 💡 [최종 위치] AI FAB 관리자 권한 확인 및 노출
  if (typeof showAiFabIfAdmin === "function") {
    showAiFabIfAdmin();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("서비스 워커 등록 실패:", err));
  });
}

// =====================================================
// 🚀 [네이티브 앱 감성 V3] 모달 스와이프(내려 닫기) 통합 엔진
// =====================================================
let swipeModalVars = {
  activeBox: null,
  activeModal: null,
  startY: 0,
  currentY: 0,
  isDragging: false,
  startTime: 0,
};

// 🚀 페이지가 로드되면 독립적으로 네이티브 스와이프 엔진 즉시 가동!
window.addEventListener("DOMContentLoaded", initNativeBottomSheet);

// 💡 [개선] Face ID 실패/취소 시 수동 로그인 창으로 자연스럽게 안내 (Fallback)
async function handleBioLogin() {
  if (!window.PublicKeyCredential) {
    openLoginModal();
    return;
  }

  try {
    // 🚨 [핵심 패치] 로그인할 때도 똑같이 랜덤 챌린지를 생성해야 비트워든이 의심하지 않음
    const randomChallenge = new Uint8Array(32);
    window.crypto.getRandomValues(randomChallenge);

    const publicKey = {
      challenge: randomChallenge,
      rpId: window.location.hostname,
      userVerification: "required",
      timeout: 60000,
    };

    const assertion = await navigator.credentials.get({ publicKey });

    if (assertion) {
      const savedId = localStorage.getItem("bio_id");
      const savedToken = localStorage.getItem("bio_token");

      if (savedId && savedToken) {
        document.getElementById("adminLoginModal").style.display = "none";
        showToast("🔒 생체 인증 성공! 서버 확인 중...", 0);

        apiCall({ source: "vercel", action: "VERIFY_SESSION", session_token: savedToken }).then(function (res) {
          if (res === null || !res.success) {
            showToast("❌ 세션이 만료되었습니다. 다시 로그인하세요.", 2500);
            localStorage.removeItem("bio_registered");
            localStorage.removeItem("bio_id");
            localStorage.removeItem("bio_token");
            openLoginModal();
            return;
          }
          window.isAdmin = true;
          isAdmin = true;
          saveAuthData(res.admin_id, res.role, true, savedToken);

          const btn = document.getElementById("adminBtn");
          if (btn) {
            btn.innerHTML = "🔓 관리자";
            btn.className = "admin-btn unlocked";
            btn.removeAttribute("style");
          }

          const actions = document.getElementById("adminActions");
          if (actions) actions.style.display = "flex";
          const fab = document.getElementById("fabBtn");
          if (fab) fab.style.display = "flex";

          showToast(`✅ ${res.name} 관리자님 환영합니다!`, 2000);
          if (typeof renderCalendar === "function") renderCalendar();
          if (typeof updateFooterUI === "function") updateFooterUI();
          if (typeof showAiFabIfAdmin === "function") showAiFabIfAdmin();
        });
      }
    }
  } catch (err) {
    openLoginModal();
  }
}

// 📡 특정 관리자 접속 정보 팝업 엔진
function showAdminConnInfo(adminId, adminName) {
  const modal = document.getElementById("adminConnModal");
  const list = document.getElementById("adminConnList");
  document.getElementById("adminConnTitle").innerText = `[${adminName}] 접속 이력`;
  list.innerHTML =
    "<div style='text-align:center; padding:20px; color:var(--text-sub); font-weight:bold;'>접속망 트래킹 중... ⏳</div>";
  modal.style.display = "flex";

  apiCall({ source: "vercel", action: "GET_ADMIN_CONN_LOGS", data: { targetId: adminId } }).then(function (res) {
    if (res === null || !res.success || !res.logs || res.logs.length === 0) {
      list.innerHTML =
        "<div style='text-align:center; padding:20px; color:var(--text-sub);'>최근 기록이 없습니다.</div>";
      return;
    }
    let html = "";
    res.logs.forEach((log) => {
      let rawDate = log.created_at || "";
      let timeStr = rawDate.length >= 16 ? rawDate.substring(5, 16).replace("-", ".") : rawDate;
      let cleanDesc = log.description.replace("[접속성공] ", "");

      html += `
                  <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:8px; padding:10px; font-size:0.85em;">
                      <div style="color:#0a84ff; font-weight:900; margin-bottom:6px;">⏱️ ${timeStr}</div>
                      <div style="color:var(--text-main); line-height:1.4; word-break:keep-all;">${_descWithIpLink(cleanDesc)}</div>
                  </div>`;
    });
    list.innerHTML = html;
  });
}

// =====================================================
// 👑 시스템 관리 (Admin Operations Pipeline) 엔진
// =====================================================
// 제어실 오픈 시 모드에 따라 필터 글씨를 강제로 직관적으로 세팅해 주는 인터락
function openMasterDashboard() {
  let role = localStorage.getItem("admin_role") || "";
  let adminId = localStorage.getItem("admin_id") || "";

  const isMasterUser =
    adminId.toLowerCase() === "admin" ||
    adminId.toLowerCase() === "silverscent" ||
    role.toUpperCase().includes("SUPER") ||
    role.toUpperCase().includes("MASTER") ||
    role.toUpperCase().includes("SYSTEM");

  if (!isMasterUser) {
    showToast("🚨 접근 거부: 최상위 시스템 관리자 계정이 아닙니다.", 3000);
    return;
  }

  // 각 모드(입고/출고)에 맞게 명칭 변경
  setTimeout(() => {
    const nameOpt = document.getElementById("filterOptName");
    const dateOpt = document.getElementById("filterOptDate");
    if (nameOpt && dateOpt) {
      if (currentType === "out") {
        nameOpt.innerText = "🏢 거래처명 검색 (company)";
        dateOpt.innerText = "📅 출고일자 검색 (out_date)";
      } else {
        nameOpt.innerText = "📄 B/L 번호 검색 (bl_number)";
        dateOpt.innerText = "📅 입고일자 검색 (receive_date)";
      }
    }
  }, 100);

  document.getElementById("masterDashboardModal").style.transform = "translateX(-100%)";
  switchMasterTab("admin-mgr");
  refreshAdminList();
  loadOcrFilterWords(); // 👈 🚨 이 한 줄만 추가! 창 열 때 필터 단어를 긁어옵니다.
}

// 🚨 [접속 로그 전용 엔진]
let connLogCurrentPage = 1;

// 1. 계정 추가 실행

// 💡 5번 요구사항: 발급 창 부드러운 토글 제어 엔진

// 👤 2, 4번 요구사항: 활성/비활성 완벽 분리 및 구분선 렌더링 빌더

// 🛑 2번 요구사항: 비활성화 경고문구 정교화 및 전송 처리

// 🔒 6번 요구사항: 본인 비밀번호 실시간 변경 연동 엔진 (SHA-256 연동)

// ♻️ 계정 복구(활성화) 실행 함수

// 💥 계정 완전 삭제 실행 함수

// 🔑 비밀번호 초기화 실행 함수

// 🚨 [로그 엔진 상태 변수 및 페이지 이동 함수 추가]
let logCurrentPage = 1;

// 📜 3. 감사 로그 수집 및 서버 기반 검색 엔진 (페이지네이션 연동)

// 🚨 DB 페이지네이션 관리 상태 변수
let dbCurrentPage = 1;

// 검색어나 줄 수가 바뀔 때 무조건 1페이지로 리셋하고 검색하는 함수

// 페이지 이동(이전/다음) 트리거 함수

// 🚨 [정렬 엔진 상태 변수 및 헬퍼 함수]
let dbSortCol = "id";
let dbSortDir = "DESC";

// 🗄️ 고도화된 DB 제어실 렌더링 (전체 컬럼 + 페이지네이션 + 열 정렬 기능)

// 🟢 [DB제어실 전용] 1. 신규 행 강제 주입 엔진 (누락되어 새로 추가하는 부분)

// ✏️ 인라인 폼 데이터 취합 및 백엔드 전송

// ✏️ DB 로우 식별명 다이렉트 수정

// 💡 [보안/디버깅 강화] 마스터 권한 판별 인터락 (localStorage + sessionStorage 동시 검사)

// 🚨 [전역 변수] 원본 텍스트 보관용
let currentRawOcrString = "";

// 📄 Raw 값 보기 토글 함수
function toggleRawOcrView() {
  const container = document.getElementById("raw-ocr-textarea-container");
  const area = document.getElementById("rawOcrTextArea");
  if (!container || !area) return;

  if (container.style.display === "none") {
    area.value = currentRawOcrString || "가져온 Raw 데이터가 존재하지 않습니다.";
    container.style.display = "block";
  } else {
    container.style.display = "none";
  }
}

// 📋 RAW 텍스트 복사 실행 함수
function copyRawOcrText() {
  const area = document.getElementById("rawOcrTextArea");
  if (!area || !area.value || area.value === "가져온 Raw 데이터가 존재하지 않습니다.") {
    showToast("복사할 데이터가 없습니다.", 2000);
    return;
  }

  // 텍스트 복사 프로세스
  area.select();
  area.setSelectionRange(0, 99999); // 모바일 대응

  navigator.clipboard
    .writeText(area.value)
    .then(() => {
      showToast("📋 RAW 텍스트가 클립보드에 전체 복사되었습니다!", 2000);
    })
    .catch((err) => {
      // 구형 기기 등 navigator 나이 미지원 시 백업용 복사
      document.execCommand("copy");
      showToast("📋 텍스트가 복사되었습니다.", 2000);
    });
}

// 🖥️ PC 전용 밀집 모드 토글 — body.pc-dense 클래스만 켜고 끔(CSS가 PC+클래스일 때만 적용).
//    모바일/토글OFF 는 영향 없음. 선택은 localStorage 에 기억.
function ensurePcSidePanel() {
  if (document.getElementById("pcSidePanel")) return;
  const el = document.createElement("aside");
  el.id = "pcSidePanel";
  document.body.appendChild(el);
}

// 🖥️ PC 좌측 사이드바 (밀집모드 전용 웹앱형 네비)
function ensurePcLeftbar() {
  if (document.getElementById("pcLeftbar")) return;
  const el = document.createElement("aside");
  el.id = "pcLeftbar";
  document.body.appendChild(el);
}
function pcGoToday() {
  const now = new Date();
  const diff = (now.getFullYear() - parseInt(serverData.year)) * 12 + (now.getMonth() + 1 - parseInt(serverData.month));
  navMonth(diff);
}

// 🔍 PC 사이드바 일정 검색 (입고: B/L · 인보이스 포함검색)
let _pcSearchTimer = null;
function pcSearchInput() {
  if (_pcSearchTimer) clearTimeout(_pcSearchTimer);
  _pcSearchTimer = setTimeout(runPcSearch, 280); // 디바운스
}
function runPcSearch() {
  const inp = document.getElementById("pcSearchKw");
  const box = document.getElementById("pcSearchResults");
  if (!inp || !box) return;
  const kw = inp.value.trim();
  window._pcSearchKw = kw;
  if (kw.length < 2) {
    box.innerHTML = `<div class="pcsr-empty"><span class="pcsr-empty-ico">🔎</span><span>2글자 이상 입력하세요</span><span class="pcsr-empty-sub">B/L · 인보이스</span></div>`;
    window._pcSearchHtml = box.innerHTML;
    return;
  }
  box.innerHTML = `<div class="pcsr-empty"><span class="pcsr-empty-ico">⏳</span><span>검색 중…</span></div>`;
  apiCall({ source: "vercel", action: "SEARCH_SCHEDULES", type: "in", keyword: kw }).then((res) => {
    if (!res || !res.success || !Array.isArray(res.rows) || res.rows.length === 0) {
      box.innerHTML = `<div class="pcsr-empty"><span class="pcsr-empty-ico">📭</span><span>결과 없음</span><span class="pcsr-empty-sub">다른 검색어로 시도해 보세요</span></div>`;
      window._pcSearchHtml = box.innerHTML;
      return;
    }
    box.innerHTML =
      `<div class="pcsr-cnt">${res.rows.length}건</div>` +
      res.rows
        .map((r) => {
          const d = (r.date || "").slice(0, 10);
          const blRaw = r.bl || "";
          const invRaw = r.invoice || "";
          const isPreBL = blRaw.startsWith("발행전");
          const blDisplay = isPreBL ? "발행전" : _hlKw(blRaw, kw);
          const invLine = invRaw ? `<span class="pcsr-inv">INV: ${_hlKw(invRaw, kw)}</span>` : "";
          const metaLine = `<span class="pcsr-inv pcsr-inv-meta">${_esc(r.pal || 0)}P · ${d}</span>`;
          const done = r.status === "완료";
          const dot = done ? "#34c759" : "#0a84ff";
          return `<button class="pcsr-item" onclick="pcJumpTo('${d}','${_argq(blRaw)}')">
            <span class="pcsr-dot" style="background:${dot}"></span>
            <span class="pcsr-main"><span class="pcsr-big">B/L: ${blDisplay}</span>${invLine}${metaLine}</span>
          </button>`;
        })
        .join("");
    window._pcSearchHtml = box.innerHTML;
  });
}
// 검색 초기화: 입력어·결과·하이라이트 모두 비움
function pcSearchReset() {
  window._pcSearchKw = "";
  window._pcSearchHtml = "";
  window._pcSearchScroll = 0;
  window._pcHl = null;
  const inp = document.getElementById("pcSearchKw");
  const box = document.getElementById("pcSearchResults");
  if (inp) inp.value = "";
  if (box) box.innerHTML = "";
  if (typeof clearClickedHighlight === "function") clearClickedHighlight();
  if (inp) inp.focus();
}

// 검색결과 클릭 → 해당 월로 이동 후 그 일정 하이라이트
function pcJumpTo(dateStr, key) {
  if (!dateStr) return;
  const box = document.getElementById("pcSearchResults");
  if (box) window._pcSearchScroll = box.scrollTop; // 결과 스크롤 위치 기억
  const [y, m, day] = dateStr.split("-").map((v) => parseInt(v, 10));
  // 재렌더(캐시→서버 응답)에도 하이라이트가 유지되도록 일정 시간 동안 반복 적용
  window._pcHl = { y: y, m: m, day: day, key: key || "", expire: Date.now() + 4500, scrolled: false };
  goToAsync(y, m);
  if (window._pcHlTimer) clearInterval(window._pcHlTimer);
  window._pcHlTimer = setInterval(reapplyPcHl, 200);
  setTimeout(reapplyPcHl, 120);
}
function reapplyPcHl() {
  const h = window._pcHl;
  if (!h) {
    if (window._pcHlTimer) clearInterval(window._pcHlTimer);
    return;
  }
  if (Date.now() > h.expire) {
    if (typeof clearClickedHighlight === "function") clearClickedHighlight();
    document.querySelectorAll(".item-tag.pc-search-flash").forEach((n) => n.classList.remove("pc-search-flash"));
    window._pcHl = null;
    if (window._pcHlTimer) clearInterval(window._pcHlTimer);
    return;
  }
  if (parseInt(serverData.year, 10) !== h.y || parseInt(serverData.month, 10) !== h.m) return;
  const cells = document.querySelectorAll(`.item-tag[onclick*="handleItemClick(event, ${h.day},"]`);
  if (!cells || cells.length === 0) return;
  let target = cells[0];
  if (h.key) {
    cells.forEach((c) => {
      if ((c.getAttribute("onclick") || "").includes(h.key)) target = c;
    });
  }
  // 깜빡임 없이 잔잔한 선택 테두리만 유지(펄스 애니메이션 제거)
  if (!target.classList.contains("item-clicked")) {
    if (typeof clearClickedHighlight === "function") clearClickedHighlight();
    target.classList.add("item-clicked");
  }
  if (!h.scrolled) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    h.scrolled = true;
  }
}

// 🔍 FAB 일정 검색 (모바일 등 상단바 포화 → FAB 메뉴에서 검색). 결과 탭 시 기존 pcJumpTo 재사용.
function openFabSearch() {
  const m = document.getElementById("fabSearchModal");
  if (!m) return;
  m.style.display = "flex";
  const inp = document.getElementById("fabSearchKw");
  const box = document.getElementById("fabSearchResults");
  if (inp) inp.value = "";
  if (box)
    box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">🔎</span><span>2글자 이상 입력하세요</span><span class="fsr-empty-sub">B/L · 인보이스</span></div>`;
  requestAnimationFrame(() => { if (inp) inp.focus(); });
}
function closeFabSearch() {
  const m = document.getElementById("fabSearchModal");
  if (m) m.style.display = "none";
}
let _fabSearchTimer = null;
function fabSearchInput() {
  if (_fabSearchTimer) clearTimeout(_fabSearchTimer);
  _fabSearchTimer = setTimeout(runFabSearch, 280); // 디바운스
}
function _hlKw(raw, kw) {
  const safe = _esc(String(raw || ""));
  if (!kw) return safe;
  try {
    const pat = _esc(kw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(`(${pat})`, "gi"), '<span class="fsr-hl">$1</span>');
  } catch (e) {
    return safe;
  }
}
function runFabSearch() {
  const inp = document.getElementById("fabSearchKw");
  const box = document.getElementById("fabSearchResults");
  if (!inp || !box) return;
  const kw = inp.value.trim();
  if (kw.length < 2) {
    box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">🔎</span><span>2글자 이상 입력하세요</span><span class="fsr-empty-sub">B/L · 인보이스</span></div>`;
    return;
  }
  box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">⏳</span><span>검색 중…</span></div>`;
  apiCall({ source: "vercel", action: "SEARCH_SCHEDULES", type: "in", keyword: kw }).then((res) => {
    if (!res || !res.success || !Array.isArray(res.rows) || res.rows.length === 0) {
      box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">📭</span><span>결과 없음</span><span class="fsr-empty-sub">다른 검색어로 시도해 보세요</span></div>`;
      return;
    }
    box.innerHTML =
      `<div class="fsr-cnt">${res.rows.length}건</div>` +
      res.rows
        .map((r) => {
          const d = (r.date || "").slice(0, 10);
          const blRaw = r.bl || "";
          const invRaw = r.invoice || "";
          const isPreBL = blRaw.startsWith("발행전");
          const blDisplay = isPreBL ? "발행전" : _hlKw(blRaw, kw);
          const invLine = invRaw ? `<span class="fsr-big" style="color:var(--text-sub)">INV: ${_hlKw(invRaw, kw)}</span>` : "";
          const done = r.status === "완료";
          const dot = done ? "#34c759" : "#0a84ff";
          return `<button class="fsr-item" onclick="closeFabSearch(); pcJumpTo('${d}','${_argq(blRaw)}')">
            <span class="fsr-dot" style="background:${dot}"></span>
            <span class="fsr-main"><span class="fsr-big">B/L: ${blDisplay}</span>${invLine}</span>
            <span class="fsr-meta">${_esc(r.pal || 0)}P · ${d}</span>
          </button>`;
        })
        .join("");
  });
}

// ⌨️ 키보드 단축키 (PC): ←/→ 달 이동, T 오늘, Esc 모달 닫기
if (!window._pcKeysBound) {
  window._pcKeysBound = true;
  document.addEventListener("keydown", function (e) {
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const openModal = Array.from(document.querySelectorAll(".overlay-modal")).find(
      (m) => m.style.display && m.style.display !== "none",
    );
    if (e.key === "Escape") {
      if (openModal) {
        openModal.style.display = "none";
        if (typeof _editState !== "undefined") _editState = null;
        if (typeof clearClickedHighlight === "function") clearClickedHighlight();
        e.preventDefault();
      }
      return;
    }
    if (openModal) return; // 모달 열려있으면 달 이동 막기
    if (e.key === "ArrowLeft") {
      navMonth(-1);
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      navMonth(1);
      e.preventDefault();
    } else if (e.key === "t" || e.key === "T") {
      pcGoToday();
      e.preventDefault();
    }
  });
}

// 🖥️ 책갈피 탭 / 딤 생성 + 접기 토글
function ensurePcChrome() {
  if (!document.getElementById("pcLeftTab")) {
    const t = document.createElement("button");
    t.id = "pcLeftTab";
    t.innerHTML = "▤ ›";
    t.title = "메뉴 열기";
    t.onclick = togglePcLeft;
    document.body.appendChild(t);
  }
  if (!document.getElementById("pcRightTab")) {
    const t = document.createElement("button");
    t.id = "pcRightTab";
    t.innerHTML = "‹ 📊";
    t.title = "요약 패널 열기";
    t.onclick = togglePcRight;
    document.body.appendChild(t);
  }
  if (!document.getElementById("pcOverlayDim")) {
    const d = document.createElement("div");
    d.id = "pcOverlayDim";
    d.onclick = closePcOverlays;
    document.body.appendChild(d);
  }
  // 접힘 상태에서도 달 이동 가능한 미니 네비
  if (!document.getElementById("pcMiniNav")) {
    const n = document.createElement("div");
    n.id = "pcMiniNav";
    n.innerHTML = `<button onclick="navMonth(-1)" aria-label="이전 달">‹</button><span id="pcMiniNavLabel" onclick="openPicker()"></span><button onclick="navMonth(1)" aria-label="다음 달">›</button>`;
    document.body.appendChild(n);
  }
  // 칩 hover 정보 툴팁
  ensurePcTip();
}
// 🖥️ hover 툴팁 (PC모드 전용) — 칩의 data-tip 내용을 마우스 근처에 표시
function ensurePcTip() {
  if (document.getElementById("pcTip")) return;
  const t = document.createElement("div");
  t.id = "pcTip";
  document.body.appendChild(t);
  document.addEventListener("mouseover", (e) => {
    if (!document.body.classList.contains("pc-dense")) return;
    const tag = e.target.closest && e.target.closest(".item-tag[data-tip], .pcp-pend-item[data-tip]");
    if (!tag) return;
    t.innerHTML = _pcTipHtml(tag.getAttribute("data-tip") || "");
    t.style.display = "block";
  });
  document.addEventListener("mousemove", (e) => {
    if (t.style.display !== "block") return;
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14;
    let y = e.clientY + 16;
    let flipX = false,
      flipY = false;
    if (x + r.width > window.innerWidth - 8) {
      x = e.clientX - r.width - 14;
      flipX = true;
    }
    if (y + r.height > window.innerHeight - 8) {
      y = e.clientY - r.height - 16;
      flipY = true;
    }
    t.classList.toggle("tip-fx", flipX); // 좌측으로 뒤집힘
    t.classList.toggle("tip-fy", flipY); // 위로 뒤집힘
    t.style.left = x + "px";
    t.style.top = y + "px";
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".item-tag[data-tip], .pcp-pend-item[data-tip]")) t.style.display = "none";
  });
}
// data-tip(여러 줄) → 제목 + 라벨/값 정렬 HTML
function _pcTipHtml(tip) {
  const lines = String(tip || "")
    .split("\n")
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return "";
  let html = `<div class="pctip-title">${_esc(lines[0])}</div>`;
  for (let i = 1; i < lines.length; i++) {
    const ci = lines[i].indexOf(": ");
    if (ci > 0) {
      html += `<div class="pctip-row"><span class="pctip-k">${_esc(lines[i].slice(0, ci))}</span><span class="pctip-v">${_esc(lines[i].slice(ci + 2))}</span></div>`;
    } else {
      html += `<div class="pctip-row"><span class="pctip-v">${_esc(lines[i])}</span></div>`;
    }
  }
  return html;
}
// 좌측 임계 창폭(입고, 우측 닫힘 기준). 우측은 패널폭(336) 만큼 더 넓어야 열림
const PC_DOCK_MIN = 802;
const PC_RIGHT_EXTRA = 336;
// 사용자가 수동으로 접어둔(collapsed) 패널은 창을 키워도 자동으로 열지 않음.
// 열어둔(open)·기본(null) 상태일 때만 창 폭에 따라 자동 여닫음.
function applyPcAutoCollapse() {
  if (!document.body.classList.contains("pc-dense")) return;
  let rightIntent = null,
    leftIntent = null;
  try {
    rightIntent = localStorage.getItem("pc_right");
    leftIntent = localStorage.getItem("pc_left");
  } catch (e) {}
  const rightNarrow = window.innerWidth < PC_DOCK_MIN + PC_RIGHT_EXTRA; // 우측 먼저 닫힘
  const leftNarrow = window.innerWidth < PC_DOCK_MIN; // 더 좁아지면 좌측도 닫힘
  if (rightIntent === "collapsed") {
    document.body.classList.add("pc-right-collapsed"); // 수동 접음 유지
  } else {
    document.body.classList.toggle("pc-right-collapsed", rightNarrow);
  }
  if (leftIntent === "collapsed") {
    document.body.classList.add("pc-left-collapsed"); // 수동 접음 유지
  } else {
    document.body.classList.toggle("pc-left-collapsed", leftNarrow);
  }
}
function initPcPanels() {
  ensurePcChrome();
  applyPcAutoCollapse();
  if (!window._pcResizeBound) {
    window._pcResizeBound = true;
    window.addEventListener("resize", applyPcAutoCollapse);
  }
}
function renderPcLeftbar() {
  if (!document.body.classList.contains("pc-dense")) return;
  ensurePcLeftbar();
  const bar = document.getElementById("pcLeftbar");
  if (!bar) return;
  const ym = `${serverData.year}.${String(serverData.month).padStart(2, "0")}`;
  const mn = document.getElementById("pcMiniNavLabel");
  if (mn) mn.textContent = ym; // 접힘 미니네비 라벨
  const on = (id) => {
    const e = document.getElementById(id);
    return e && e.classList.contains("active") ? "pclb-on" : "";
  };
  const holidayOn = typeof isShowHoliday !== "undefined" && isShowHoliday;
  const admin = typeof isAdmin !== "undefined" && isAdmin;
  const dark = typeof isDarkMode !== "undefined" && isDarkMode;
  bar.innerHTML = `
    <div class="pclb-brand">
      <img src="/apple-touch-icon.png" class="pclb-logo" alt="">
      <div class="pclb-title">입고캘린더</div>
      <button class="pc-collapse-btn" onclick="togglePcLeft()" title="메뉴 접기" style="margin-left:auto;">‹</button>
    </div>
    <div class="pclb-month">
      <button class="pclb-nav" onclick="navMonth(-1)" aria-label="이전 달">‹</button>
      <button class="pclb-ym" onclick="openPicker()">${ym}</button>
      <button class="pclb-nav" onclick="navMonth(1)" aria-label="다음 달">›</button>
    </div>
    <button class="pclb-item" onclick="pcGoToday()">📅 오늘로 이동</button>

    <div class="pclb-sec pclb-sec-row">일정 검색<button type="button" class="pclb-search-reset" onclick="pcSearchReset()">↺ 초기화</button></div>
    <div class="pclb-search">
      <div class="pclb-searchbox">
        <span class="pclb-searchicon">🔍</span>
        <input id="pcSearchKw" class="pclb-search-input" type="text" placeholder="B/L · 인보이스"
          oninput="pcSearchInput()" onkeydown="if(event.key==='Enter')runPcSearch()" autocomplete="off" />
      </div>
      <div id="pcSearchResults" class="pclb-search-results" onscroll="window._pcSearchScroll=this.scrollTop"></div>
    </div>

    <div class="pclb-sec">보기</div>
    <div class="pclb-seg">
      <button class="pclb-seg-btn ${on("btnS")}" onclick="changeSize('S'); renderPcLeftbar()">A-</button>
      <button class="pclb-seg-btn ${on("btnM")}" onclick="changeSize('M'); renderPcLeftbar()">A</button>
      <button class="pclb-seg-btn ${on("btnL")}" onclick="changeSize('L'); renderPcLeftbar()">A+</button>
    </div>
    <div class="pclb-row2">
      <button class="pclb-item pclb-r2-holiday ${holidayOn ? "pclb-on" : ""}" onclick="toggleHoliday(); renderPcLeftbar()">
        <span class="pclb-r2-icon">🏖️</span>
        <span class="pclb-r2-txt">${holidayOn ? "ON" : "OFF"}</span>
      </button>
      <button class="pclb-item pclb-r2-theme ${dark ? "pclb-dark" : "pclb-light"}" onclick="toggleTheme(); renderPcLeftbar()">
        <span class="pclb-r2-icon">${dark ? "🌙" : "☀️"}</span>
        <span class="pclb-r2-txt">${dark ? "Dark" : "Light"}</span>
      </button>
    </div>
    <div class="pclb-toggle-row">
      <button
        type="button"
        class="bl-toggle ${blDisplayMode === "invoice" ? "on" : ""}"
        onclick="toggleBlDisplayMode()"
        title="B/L ↔ 인보이스 전환"
        aria-label="B/L 인보이스 표시 전환"
      >
        <span class="bl-toggle-label off">B/L</span>
        <span class="bl-toggle-track"><span class="bl-toggle-knob"></span></span>
        <span class="bl-toggle-label on">INV</span>
      </button>
    </div>

    <div class="pclb-sec">기능</div>
    ${admin ? `<button class="pclb-item pclb-add-btn" onclick="openAddForm()">✏️ 신규 등록</button>` : ""}
    ${admin ? `<button class="pclb-item pclb-ai-btn" onclick="openAiQuery()">🤖 AI 질의</button>` : ""}
    <button class="pclb-item" onclick="openDashboard()">📊 통계 대시보드</button>
    <button class="pclb-item" onclick="showLastOcrImage()">🖼️ OCR</button>
    <button class="pclb-item" onclick="toggleMultiMode()">☑️ 다중 선택</button>
    <button class="pclb-item" onclick="navMonth(0)">🔄 새로고침</button>

    <div class="pclb-sec">계정 / 설정</div>
    <button class="pclb-item ${admin ? "pclb-on" : ""}" onclick="toggleAdmin(); setTimeout(renderPcLeftbar, 60)">${admin ? "🔓 관리자 모드" : "🔒 관리자 로그인"}</button>

    <div class="pclb-info">
      <div>🖼️ OCR <b>${_esc((document.getElementById("ocrTimeText")?.innerText || "-").trim())}</b></div>
      <div>🔄 동기화 <b>${_esc((document.getElementById("lastSyncTime")?.innerText || "-").trim())}</b></div>
    </div>
    <div class="pclb-legend"><span><i style="background:#26e2fd"></i>🚢 해상</span><span><i style="background:#ff7eff"></i>✈️ 항공</span></div>
    <button class="pclb-off" onclick="togglePcDense()">🖥️ PC모드 끄기</button>
  `;
  // 사이드바 재렌더 시 진행 중인 검색어/결과 복원 (월 점프해도 목록 유지)
  if (window._pcSearchKw) {
    const inp = document.getElementById("pcSearchKw");
    const box = document.getElementById("pcSearchResults");
    if (inp) inp.value = window._pcSearchKw;
    if (box && window._pcSearchHtml) {
      box.innerHTML = window._pcSearchHtml;
      box.scrollTop = window._pcSearchScroll || 0; // 결과 스크롤 위치 복원
    }
  }
}

function togglePcDense() {
  const on = document.body.classList.toggle("pc-dense");
  try {
    localStorage.setItem("pc_dense", on ? "on" : "off");
  } catch (e) {}
  const btn = document.getElementById("pcDenseToggle");
  if (btn) {
    btn.innerHTML = on ? "🖥️ PC모드 ON" : "🖥️ PC모드";
    btn.classList.toggle("active", on);
  }
  if (on) {
    ensurePcSidePanel();
    ensurePcLeftbar();
    initPcPanels();
    renderPcSidePanel();
    renderPcLeftbar();
  }
}

// 🚀 [해결책] 페이지 로드 시 백그라운드에서 OCR 데이터를 미리 가져오는 자동 호출 수신부
document.addEventListener("DOMContentLoaded", function () {
  // 저장된 PC 밀집 모드 선호 복원 (기본 OFF — 기존 사용자 영향 없음)
  try {
    ensurePcSidePanel();
    ensurePcLeftbar();
    ensurePcChrome();
    if (localStorage.getItem("pc_dense") === "on") {
      document.body.classList.add("pc-dense");
      const btn = document.getElementById("pcDenseToggle");
      if (btn) {
        btn.innerHTML = "🖥️ PC모드 ON";
        btn.classList.add("active");
      }
      initPcPanels();
      renderPcSidePanel();
      renderPcLeftbar();
      renderCalendar();
    }
  } catch (e) {}

  setTimeout(function () {
    apiCall({ source: "vercel", domain: "system", action: "GET_LAST_OCR_DATA" }).then(function (data) {
      if (data && data.rawData) currentRawOcrString = data.rawData;
    });
  }, 1000); // 안전하게 1초 뒤 백그라운드 자동 실행
});

// 💡 UI가 새로고침되거나 로그아웃되어도 상시 작동하도록 document 전역 위임 패턴 적용
document.addEventListener("click", function (event) {
  // 수정 (정확히 lock-btn 요소이거나, 잠김 버튼 자체를 클릭했을 때만)
  if (event.target.id === "lock-btn" || event.target.closest("#lock-btn")) {
    event.preventDefault();
    const token = localStorage.getItem("accessToken");

    // 🔒 로그아웃 상태(토큰 없음)일 때 무반응으로 끝나지 않고 페이지를 새로고침하여 로그인 유도
    if (!token) {
      console.warn("로그아웃 상태에서 잠김 클릭됨 -> 초기화");
      window.location.reload();
      return;
    }
  }
});

// 👇 🚨 [여기에 추가하세요!] 필터 제어용 자바스크립트
let globalOcrFilters = [];

// 👆 ----------------------------------------------------
