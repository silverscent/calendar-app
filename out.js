// ====================================================================
// 🚀 [Vercel 독립 생명유지장치] 구글 서버가 몰래 주던 변수들을 직접 생성!
// ====================================================================
let currentType = "out"; // 🔵 출고 달력이므로 무조건 'out'
let isAdmin = false;
let adminToken = null;
let todayDateObj = new Date();
let lastLocalUpdateTime = 0;
let isDarkMode = false;

// 🚨 [추가된 변수] 색상 관리용 빈 상자들!
let companyColors = {};
let customColors = {};
// 🚨 TDZ 방지: compInfoDB 를 최상단에서 미리 초기화 (아래 사용처보다 먼저 선언)
let compInfoDB = JSON.parse(localStorage.getItem("COMP_INFO_DB") || "{}");

let serverData = {
  year: todayDateObj.getFullYear(),
  month: todayDateObj.getMonth() + 1,
  firstDay: new Date(todayDateObj.getFullYear(), todayDateObj.getMonth(), 1).getDay(),
  daysInMonth: new Date(todayDateObj.getFullYear(), todayDateObj.getMonth() + 1, 0).getDate(),
  monthData: {},
  pendingItems: [],
};
window.yearlyHolidays = {};

// 💡 [추가] 공휴일 이름 표시 ON/OFF 상태 (기본값 ON)
let isShowHoliday = localStorage.getItem("cal_show_holiday") !== "false";

// 💡 [추가] 공휴일 토글 실행 함수

// (폴리필 -> common-core.js 로 분리됨)

// 🏢 업체명 관련 해시 맵 (관리자님의 '새로운 마스터 명칭' 기준!)
const fixedCompanies = [
  "(주)메디뱅크",
  "백년가게국제의료기", // (이전 대화에서 이게 찐 풀네임이라고 하셔서 유지했습니다!)
  "드림케어메디칼",
  "링크더랩",
  "(주)메디맥 2층",
  "(주)메디맥 3층",
  "메디칼써프라이",
  "서호메디코",
  "세람메디칼",
  "엠코리아토탈서비스",
  "위드비아",
  "제니스엠지",
  "지엔씨메딕",
  "하이메드",
  "스마트엠케어",
];

const compShortMap = {
  "(주)메디맥 2층": "메2",
  "(주)메디맥 3층": "메3",
  "(주)메디뱅크": "메뱅",
  메디칼써프라이: "메써",
  서호메디코: "서호",
  엠코리아토탈서비스: "엠코",
  백년가게국제의료기: "국제",
  드림케어메디칼: "드림",
  지엔씨메딕: "지엔",
  링크더랩: "링랩",
  위드비아: "위비",
  하이메드: "하메",
  스마트엠케어: "스엠",
  제니스엠지: "제니",
  세람메디칼: "세람",
};

const compFullMap = {
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

// 💡 [지능형 약어 변환기]
function getShortName(name) {
  if (!name) return "";
  let fullName = getFullName(name); // 무조건 새 이름으로 세탁한 뒤 시작

  // 1. CRM에 등록된 약어가 있다면 최우선
  if (compInfoDB[fullName] && compInfoDB[fullName].shortName) return compInfoDB[fullName].shortName;
  // 2. 하드코딩 맵 사용
  if (compShortMap[fullName]) return compShortMap[fullName];
  return fullName.substring(0, 2);
}

// 💡 [지능형 마스터 이름 추출기]
function getFullName(name) {
  if (!name) return "";
  let input = String(name).trim();

  // 1순위: CRM DB 검색
  if (typeof compInfoDB === "object" && compInfoDB !== null && compInfoDB[input]) return input;

  // 2순위: CRM 약어 검색
  try {
    if (typeof compInfoDB === "object" && compInfoDB !== null) {
      for (let masterName in compInfoDB) {
        if (compInfoDB[masterName] && compInfoDB[masterName].shortName === input) return masterName;
      }
    }
  } catch (e) {}

  // 3순위: 하드코딩 맵 검색 (🌟 여기서 과거 DB의 "제니스"가 "제니스엠지"로 바뀜!)
  if (typeof compFullMap !== "undefined" && compFullMap[input]) {
    let legacyFullName = compFullMap[input];
    if (typeof compInfoDB === "object" && compInfoDB !== null && compInfoDB[legacyFullName]) return legacyFullName;
    return legacyFullName;
  }

  return input;
}

// 🎨 [최적화 25색 팔레트] 확실하게 구분되는 쨍한 원색 + 뚜렷한 파스텔 조합!
const presetPalette = [
  // 🎯 비비드 15
  { bg: "#991122", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 0 다크버건디
  { bg: "#FF6600", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 1 오렌지
  { bg: "#FFCC00", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 2 골드
  { bg: "#0099AA", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 3 딥시안
  { bg: "#00BB44", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 4 그린
  { bg: "#005577", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 5 딥틸네이비
  { bg: "#00AAEE", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 6 시안블루
  { bg: "#1166FF", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 7 블루
  { bg: "#6600FF", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 8 바이올렛
  { bg: "#AA00CC", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 9 퍼플
  { bg: "#556600", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 10 딥올리브
  { bg: "#FF1155", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 11 핫핑크
  { bg: "#003399", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 12 네이비
  { bg: "#007744", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 13 포레스트그린
  { bg: "#882200", cMain: "#fff", cSub: "rgba(255,255,255,0.9)", txtShadow: "0 1px 2px rgba(0,0,0,0.3)" }, // 14 다크브라운

  // 🌸 파스텔 10
  { bg: "#FFB0B0", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 15 파스텔레드
  { bg: "#FFD4A0", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 16 파스텔오렌지
  { bg: "#AACCBB", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 17 뮤트민트세이지
  { bg: "#CCFF77", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 18 파스텔라임
  { bg: "#88FFD4", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 19 파스텔민트
  { bg: "#88DDFF", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 20 파스텔블루
  { bg: "#DDBBCC", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 21 더스티로즈
  { bg: "#CC99FF", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 22 파스텔퍼플
  { bg: "#B8C6FF", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 23 파스텔라벤더
  { bg: "#FF99CC", cMain: "#111", cSub: "rgba(0,0,0,0.7)", txtShadow: "none" }, // 24 파스텔핑크
];
// 💡 [패치 1] 색상 무단 변경 버그 완벽 차단! 순수 100% 해시 영구 고정 알고리즘
function getCompanyColor(companyName) {
  if (!companyName) return presetPalette[0];
  let stdName = getFullName(companyName);

  // 1. 관리자가 '셔플'로 수동 저장해둔 색상이 있으면 무조건 1순위 적용
  if (customColors && customColors[stdName] !== undefined && presetPalette[customColors[stdName]]) {
    companyColors[stdName] = presetPalette[customColors[stdName]];
    return presetPalette[customColors[stdName]];
  }
  if (companyColors[stdName]) return companyColors[stdName];

  // 2. 수동 지정이 없으면 해시 기반 자동 배정 — 이미 customColors로 수동 지정된 인덱스는 건너뜀
  let hash = 0;
  for (let i = 0; i < stdName.length; i++) hash = stdName.charCodeAt(i) + ((hash << 5) - hash);
  let baseIdx = Math.abs(hash) % presetPalette.length;

  // customColors(수동) + companyColors(해시 캐시) 모두 피함
  const usedIdxs = new Set(Object.values(customColors || {}));
  Object.values(companyColors).forEach((colorObj) => {
    const idx = presetPalette.findIndex((p) => p.bg === colorObj.bg);
    if (idx !== -1) usedIdxs.add(idx);
  });
  let colorIdx = baseIdx;
  for (let i = 0; i < presetPalette.length; i++) {
    let candidate = (baseIdx + i) % presetPalette.length;
    if (!usedIdxs.has(candidate)) { colorIdx = candidate; break; }
  }

  companyColors[stdName] = presetPalette[colorIdx];
  return presetPalette[colorIdx];
}

// 💡 [셔플 패치] 화면의 TASK는 무시하고 "진짜 일반 업체"가 쓰는 색상만 차단!
function shuffleColorInModal(compName, idx) {
  let stdName = getFullName(compName);
  let originalIdx = customColors[stdName] !== undefined ? customColors[stdName] : -1;
  let originalBg =
    originalIdx !== -1 && presetPalette[originalIdx] ? presetPalette[originalIdx].bg : getCompanyColor(stdName).bg;
  let currentPreviewBg = tempEditColorObj ? tempEditColorObj.bg : originalBg;

  // 1. 진짜 일반 업체만 수집
  let activeComps = new Set();
  const addActiveComp = (it) => {
    let c = String(it.company || it.bl || "").trim();
    let clean = c.replace(/\[TASK\]/gi, "").trim();
    let isTask =
      c.toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));
    // 🚨 TASK가 아니면 진짜 업체로 인정!
    if (clean && !isTask) activeComps.add(getFullName(clean));
  };

  for (let d = 1; d <= 31; d++) {
    if (serverData.monthData[d]) serverData.monthData[d].forEach(addActiveComp);
  }
  if (serverData.pendingItems) serverData.pendingItems.forEach(addActiveComp);

  // 2. 다른 업체들이 쓰고 있는 배경색 차단 목록 생성
  let usedBgs = new Set();
  // 현재 달력에 있는 업체 색상
  activeComps.forEach((c) => {
    if (c !== stdName) {
      let colorObj = getCompanyColor(c);
      if (colorObj) usedBgs.add(colorObj.bg);
    }
  });
  // 이번 달에 없더라도 수동 지정된 색상은 모두 차단
  if (customColors) {
    for (let name in customColors) {
      if (name !== stdName && customColors[name] !== undefined && presetPalette[customColors[name]]) {
        usedBgs.add(presetPalette[customColors[name]].bg);
      }
    }
  }

  // 3. 차단 목록에 없고, 방금 보여준 색도 아닌 '진짜 잉여 색상'만 후보로 올림
  let available = [];
  for (let i = 0; i < presetPalette.length; i++) {
    if (!usedBgs.has(presetPalette[i].bg) && presetPalette[i].bg !== currentPreviewBg) {
      available.push(i);
    }
  }

  // 혹시라도 자리가 꽉 찼다면 현재 띄워진 색만 빼고 전부 개방
  if (available.length === 0) {
    for (let i = 0; i < presetPalette.length; i++) {
      if (presetPalette[i].bg !== currentPreviewBg) available.push(i);
    }
  }

  let newIdx = available[Math.floor(Math.random() * available.length)];
  tempEditColorIdx = newIdx;
  tempEditColorObj = presetPalette[newIdx];

  document.getElementById(`edit-${idx}-color-preview`).style.display = "flex";
  document.getElementById(`old-color-box-${idx}`).style.background = originalBg;
  document.getElementById(`new-color-box-${idx}`).style.background = tempEditColorObj.bg;
}

// 💡 [순서 동기화 핵심 패치] 출고 전용 뼈대에 맞춰 최적화
function getScheduleSig(dataObj) {
  if (!dataObj) return "";
  const norm = (v) => {
    let s = v == null || v === "" ? "" : String(v).trim();
    return s === "0" || s === "" ? "" : s;
  };
  const cleanStr = (s) =>
    String(s || "")
      .replace(/\[TASK\]/gi, "")
      .replace(/\s+/g, "")
      .toUpperCase();
  let sigs = [];

  if (dataObj.pendingItems) {
    dataObj.pendingItems.forEach((it, idx) =>
      sigs.push(`P_${idx}_${cleanStr(it.company)}_${norm(it.pal)}_${norm(it.box)}_${cleanStr(it.etc)}_${it.isDone}`),
    );
  }
  if (dataObj.monthData) {
    let days = Object.keys(dataObj.monthData)
      .map(Number)
      .sort((a, b) => a - b);
    for (let d of days) {
      if (dataObj.monthData[d]) {
        dataObj.monthData[d].forEach((it, idx) =>
          sigs.push(
            `D${d}_${idx}_${cleanStr(it.company)}_${norm(it.pal)}_${norm(it.box)}_${cleanStr(it.etc)}_${it.isDone}`,
          ),
        );
      }
    }
  }
  return sigs.join("||");
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
  if (
    (modal && modal.style.display === "flex") ||
    (addModal && addModal.style.display === "flex") ||
    (ocrModal && ocrModal.style.display === "flex")
  )
    return;

  let fetchStartTime = Date.now();

  // 🚨 [핵심 1] 심부름 보내기 직전의 '연/월'과 '달력 번호표'를 박제해둡니다!
  const reqYear = serverData.year;
  const reqMonth = serverData.month;
  const reqNavId = window.currentNavId;

  // 💡 [패치 4] 백그라운드 동기화 때 색상 정보도 최우선으로 가져와서 칠하기!
  apiCall({ source: "vercel", action: "GET_GLOBAL_COLORS" }).then((c) => {
    if (c !== null) {
      customColors = c;
      localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(c));
      renderCalendar();
    }
  });

  apiGet({ type: currentType, year: reqYear, month: reqMonth }).then((res) => {
    if (res === null) return;
    if (reqYear !== serverData.year || reqMonth !== serverData.month || reqNavId !== window.currentNavId) return;
    if (typeof lastLocalUpdateTime !== "undefined" && lastLocalUpdateTime > fetchStartTime) return;

    res.year = reqYear;
    res.month = reqMonth;
    res.firstDay = new Date(reqYear, reqMonth - 1, 1).getDay();
    res.daysInMonth = new Date(reqYear, reqMonth, 0).getDate();

    if (typeof preserveCustomOrder === "function") res = preserveCustomOrder(res);

    let isScheduleChanged = getScheduleSig(serverData) !== getScheduleSig(res);

    if (isScheduleChanged) {
      serverData = res;
      localStorage.setItem(`cal_cache_${currentType}_${reqYear}_${reqMonth}`, JSON.stringify(res));
      renderCalendar();
      showToast("🔄 새로운 스케줄이 업데이트되었습니다.", 2000);

      apiGet({ action: "yearlyStats", type: currentType, year: reqYear }).then((yRes) => {
        if (yRes && yRes.year) {
          yearlyCache[yRes.year] = yRes;
          localStorage.setItem(`yearly_stats_cache_${currentType}_${yRes.year}`, JSON.stringify(yRes));
          if (document.getElementById("dashboardModal").style.display === "flex" && window.dashMode === "year") {
            renderDashCharts();
          }
        }
      });
    }
    updateSyncTime();
    syncCrmDataBackground();
  });
}

// 기존 등록해둔 인터벌(1분)과 visibilitychange 이벤트는 그대로 두시면 됩니다!
// setInterval(silentBackgroundSync, 60000);
// document.addEventListener("visibilitychange", ...

// 🕒 [1. 정기 폴링] 앱을 켜두고 가만히 있어도 1분(60000ms)마다 몰래 동기화
// 수정
setInterval(() => {
  if (!window.isDragging && document.visibilityState === "visible") silentBackgroundSync();
}, 60000);

// 👁️ [2. 화면 복귀 감지 (Visibility API)]
// 스마트폰 화면을 껐다 켜거나, 카톡/유튜브를 보다가 다시 달력 앱으로 돌아오는 '그 순간' 즉시 동기화!
// 수정 — 드래그 중이면 sync 건너뛰기
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !window.isDragging) silentBackgroundSync();
});

// 🚀 [앱 초기화] 오염된 캐시 무시 + 강제 뼈대 교정 완결판
window.addEventListener("DOMContentLoaded", () => {
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

  // 🚨 [버그 3 수정] 앱 켜자마자 내 폰(로컬)에 저장된 색상을 먼저 장전해서 번쩍임(Flash) 방지!
  try {
    let savedColors = localStorage.getItem("GLOBAL_COMPANY_COLORS");
    if (savedColors) customColors = JSON.parse(savedColors);
  } catch (e) {}

  const savedTheme = localStorage.getItem("cal_theme") || "light";
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

      // 🚨 [초기화 백신] 서랍 안의 쓰레기 뼈대를 즉시 정상 교정!
      serverData.year = currentYear;
      serverData.month = currentMonth;
      serverData.firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
      serverData.daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

      if (!isNaN(serverData.year)) isCacheValid = true;

      // 🚨 [핵심 패치 4] 앱을 켤 때 캐시에서 꺼낸 데이터도 무조건 순서표대로 정렬!
      if (typeof preserveCustomOrder === "function") {
        serverData = preserveCustomOrder(serverData);
      }
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
  showToast("🔄 백그라운드 동기화 중...", 0);

  // CRM → 색상 → 달력 순차 로딩 (중첩 콜백 → async/await)
  (async () => {
    const dbData = await apiCall({ source: "vercel", action: "GET_COMP_INFO_DB" });
    if (dbData) {
      compInfoDB = dbData;
      localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
    }

    const colors = await apiCall({ source: "vercel", action: "GET_GLOBAL_COLORS" });
    if (colors) {
      customColors = colors;
      localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(colors));
      // ghost 키 정리: ① 옛 이름 매핑 불일치 ② CRM에 없는 업체 → 관리자만 DB 반영
      const ghostKeys = Object.keys(customColors).filter(
        (k) => getFullName(k) !== k || !compInfoDB[getFullName(k)]
      );
      if (ghostKeys.length > 0 && isAdmin) {
        ghostKeys.forEach((k) => { delete customColors[k]; });
        localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
        apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", deleteNames: ghostKeys });
      }
      // customColors 미지정 업체 자동 고정 — 수동 지정과 동일하게 DB에 저장 (관리자만)
      if (isAdmin) {
        const newAssignments = {};
        Object.keys(compInfoDB).forEach((compName) => {
          if (customColors[compName] !== undefined) return;
          const colorObj = getCompanyColor(compName); // companyColors 캐시에도 등록됨
          const idx = presetPalette.findIndex((p) => p.bg === colorObj.bg);
          if (idx !== -1) { customColors[compName] = idx; newAssignments[compName] = idx; }
        });
        if (Object.keys(newAssignments).length > 0) {
          localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
          apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", saveAll: newAssignments });
        }
      }
    }

    let newData = await apiGet({ type: currentType, year: currentYear, month: currentMonth });
    if (!newData) return;
    if (typeof lastLocalUpdateTime !== "undefined" && lastLocalUpdateTime > fetchStartTime) return;

    newData.year = currentYear;
    newData.month = currentMonth;
    newData.firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    newData.daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    if (typeof preserveCustomOrder === "function") newData = preserveCustomOrder(newData);
    localStorage.setItem(cacheKey, JSON.stringify(newData));
    if (serverData.year === currentYear && serverData.month === currentMonth) {
      serverData = newData;
      renderCalendar();
    }
  })();
  // 💡 [최종 위치] AI FAB 관리자 권한 확인 및 노출
  if (typeof showAiFabIfAdmin === "function") {
    showAiFabIfAdmin();
  }
});

// 💡 [새로 추가됨] 네온 로딩 & 게이지 스위치
let activeRequests = 0;

// 💡 [수정됨] 토스트 킬러 (로딩/완료 알림 무시, 에러만 표시)


function updateFooterUI() {
  const footer = document.getElementById("infoFooter");
  if (footer) {
    footer.innerText = isAdmin
      ? "👆 날짜 터치: 상세내역 및 수정 / 꾹 누르기: 이동 (빈칸: 신규등록)"
      : "👆 날짜 터치: 상세내역 확인";
  }
}

function toggleEndDate(prefix, isTask) {
  const group = document.getElementById(`${prefix}-end-date-group`);
  const guide = document.getElementById(`${prefix}-end-date-guide`);
  const labelExtra = document.getElementById(`${prefix}-date-label-extra`);
  const shuffleBtn = document.getElementById(`${prefix}-shuffle-btn`);
  const colorPreview = document.getElementById(`${prefix}-color-preview`);

  if (shuffleBtn) shuffleBtn.style.display = isTask ? "none" : "block";
  if (colorPreview && isTask) colorPreview.style.display = "none";

  if (group) group.style.display = isTask ? "flex" : "none";
  if (guide) guide.style.display = isTask ? "block" : "none";
  if (labelExtra) labelExtra.style.display = isTask ? "inline" : "none";

  if (!isTask) {
    let endInput = document.getElementById(`${prefix}-end-date`);
    if (endInput) endInput.value = "";
  }
}

// 🚀 [순서 동기화 완결판] 과거의 고집(로컬 캐시)을 버리고, 무조건 서버가 내려준 '순서표(sortIdx)'에 절대 복종!
function preserveCustomOrder(newData) {
  // 🚨 [DB 매칭 패치] TiDB에서 온 데이터(sort_idx, isDone(0/1))를 프론트엔드 규격에 맞게 1초 만에 자동 변환!
  const normalizeData = (it) => {
    if (it.sort_idx !== undefined) it.sortIdx = Number(it.sort_idx);
    if (String(it.isDone) === "1" || String(it.isDone).toLowerCase() === "true") it.isDone = true;
    else if (String(it.isDone) === "0" || String(it.isDone).toLowerCase() === "false" || it.isDone === null)
      it.isDone = false;
  };

  // 미정(대기) 리스트 뼈대 맞춤
  if (newData.pendingItems) {
    newData.pendingItems.forEach(normalizeData);
  }

  for (let d = 1; d <= newData.daysInMonth; d++) {
    if (newData.monthData[d]) {
      // 각 날짜별 일정 뼈대 맞춤
      newData.monthData[d].forEach(normalizeData);

      newData.monthData[d].sort((a, b) => {
        // 서버가 부여한 순서표(sortIdx)를 읽어서 정렬
        let aIdx = a.sortIdx !== undefined && a.sortIdx !== null ? Number(a.sortIdx) : 999;
        let bIdx = b.sortIdx !== undefined && b.sortIdx !== null ? Number(b.sortIdx) : 999;

        if (aIdx !== bIdx) return aIdx - bIdx;

        // 방금 추가되어 순서표가 없는(999) 신규 일정은 뚱뚱한 애(출고)를 위로
        let aSlim = checkIsSlim(a, d);
        let bSlim = checkIsSlim(b, d);
        if (aSlim !== bSlim) return aSlim ? 1 : -1;
        return 0;
      });
    }
  }
  return newData;
}
// 💡 [최종 패치] 수량 0과 빈칸을 동일하게 취급하여 억울한 간트 찢어짐 완벽 방어!
const getMatchKey = (item) => {
  let clean = String(item.company || "").replace(/\[TASK\]/gi, "").trim();
  let isTask =
    String(item.company || "").toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));

  // "0"이나 빈칸, null을 모두 완벽히 동일한 "" 으로 정규화
  let p = item.pal === "0" || !item.pal ? "" : String(item.pal).trim();
  let b = item.box === "0" || !item.box ? "" : String(item.box).trim();

  // TASK 바: 수량이 날짜별로 달라져도 같은 작업이면 연결 유지 (pal/box 제외)
  if (isTask) return `T_${getFullName(clean)}`;
  return `O_${getFullName(clean)}_${p}_${b}`;
};

// 💡 [패치] 하루짜리 작업(TASK)은 슬림하게 안 만들고 뚱뚱한 박스로 처리하도록 day 정보를 받아서 스캔합니다.
const checkIsSlim = (it, day) => {
  let clean = it.company.replace(/\[TASK\]/gi, "").trim();
  let isTask =
    it.company.toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));
  if (!isTask) return false; // 출고 항목은 뚱뚱하게

  let hasPrev =
    serverData.monthData[day - 1] && serverData.monthData[day - 1].some((p) => getMatchKey(p) === getMatchKey(it));
  let hasNext =
    serverData.monthData[day + 1] && serverData.monthData[day + 1].some((n) => getMatchKey(n) === getMatchKey(it));
  if (!hasPrev && !hasNext) return false; // 🚨 하루짜리 작업은 뚱뚱하게!

  return true; // 며칠 이어지는 간트차트 작업만 슬림하게!
};

function computeGanttSlots() {
  // 🚀 [무적의 통합 엔진] 이전 렌더링 찌꺼기를 완벽히 지우고, 사용자의 배열 순서를 절대 존중!
  serverData.customOrderFlags = serverData.customOrderFlags || {};
  let slotAllocation = {};
  for (let d = 1; d <= serverData.daysInMonth; d++) slotAllocation[d] = [];

  let globalItems = [];
  let gIdCounter = 1;

  // 📂 접힌 날: 일반 칩은 슬롯을 차지하지 않음(간트 막대만 슬롯 배정) → 막대는 이웃 칸과 같은 높이에 정렬
  const foldedDays = {};
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    foldedDays[d] = _foldable(serverData.monthData[d], d) && !window._foldOpen[_foldKey(d)] && _foldKey(d) !== window._foldDrag;
  }

  // 🚨 [핵심 패치 3] 이전 렌더링 때 발급된 번호표 찌꺼기 완벽 초기화! (이것 때문에 순서 이동이 안 먹혔음)
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (serverData.monthData[d]) {
      serverData.monthData[d].forEach((item) => {
        item._ganttId = null;
        item._visualSlot = undefined;
      });
    }
  }

  // ① 일정 그룹화 및 고유 ID 부여
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (!serverData.monthData[d]) continue;

    serverData.monthData[d].forEach((item) => {
      if (checkIsSlim(item, d)) {
        if (!item._ganttId) {
          let key = getMatchKey(item);
          item._ganttId = gIdCounter++;
          let eDay = d;
          for (let n = d + 1; n <= serverData.daysInMonth; n++) {
            let nextItem =
              serverData.monthData[n] && serverData.monthData[n].find((x) => getMatchKey(x) === key && !x._ganttId);
            if (nextItem) {
              nextItem._ganttId = item._ganttId;
              eDay = n;
            } else break;
          }
          globalItems.push({ isGantt: true, id: item._ganttId, start: d, end: eDay, key: key });
        }
      } else {
        item._ganttId = gIdCounter++;
        if (foldedDays[d]) return; // 접힌 날의 일반 칩: 슬롯 없음(_visualSlot 미지정)
        globalItems.push({ isGantt: false, id: item._ganttId, start: d, end: d, refItem: item });
      }
    });
  }

  // ② 렌더링 우선순위 결정 (무조건 사용자가 배열해둔 상하 순서를 우선!)
  globalItems.sort((a, b) => {
    let overlapStart = Math.max(a.start, b.start);
    let overlapEnd = Math.min(a.end, b.end);

    if (overlapStart <= overlapEnd) {
      let dayArr = serverData.monthData[overlapStart];
      let idxA = dayArr.findIndex((x) => x._ganttId === a.id);
      let idxB = dayArr.findIndex((x) => x._ganttId === b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    }
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  // ③ 빈칸 테트리스 (우선순위가 높은 놈부터 맨 위부터 꽂아 넣음)
  globalItems.forEach((g) => {
    let slot = 0;
    while (true) {
      let isFree = true;
      for (let d = g.start; d <= g.end; d++) {
        if (slotAllocation[d][slot]) {
          isFree = false;
          break;
        }
      }
      if (isFree) break;
      slot++;
    }
    for (let d = g.start; d <= g.end; d++) {
      slotAllocation[d][slot] = true;
      let it = serverData.monthData[d].find((x) => x._ganttId === g.id);
      if (it) it._visualSlot = slot;
    }
  });

  // ④ 최종 화면 동기화
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (!serverData.monthData[d]) continue;
    // 접힌 날은 슬롯 없는 칩이 섞여 있어 비교가 일관되지 않으므로 배열 순서를 건드리지 않음
    if (!foldedDays[d])
      serverData.monthData[d].sort((a, b) => {
        if (a._visualSlot !== undefined && b._visualSlot !== undefined) return a._visualSlot - b._visualSlot;
        return 0;
      });
    serverData.monthData[d].forEach((item, idx) => {
      item._rawIdx = idx;
    });
  }

  // 🚀 [2] 달력 그리기 (수정된 HTML 렌더링)
  let weekSlotHeights = [];
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (!serverData.monthData[d]) continue;
    let w = Math.floor((serverData.firstDay + d - 1) / 7);
    if (!weekSlotHeights[w]) weekSlotHeights[w] = {};
    serverData.monthData[d].forEach((item) => {
      let s = item._visualSlot;
      if (s !== undefined) {
        let h = checkIsSlim(item, d) ? 26 : 46;
        if (!weekSlotHeights[w][s] || weekSlotHeights[w][s] < h) weekSlotHeights[w][s] = h;
      }
    });
  }

  // 🚨 [출고 지능형 가변 높이 엔진 V4] - 초밀착 정렬형
  let weekHeights = {};
  let savedSize = localStorage.getItem("cal_fontSize") || "M";
  let charsPerLine = savedSize === "L" ? 4 : 5;

  for (let d = 1; d <= serverData.daysInMonth; d++) {
    let wIdx = Math.floor((serverData.firstDay + d - 1) / 7);
    if (!weekHeights[wIdx]) weekHeights[wIdx] = "auto";

    let dYmd = _ymd(serverData.year, serverData.month, d);
    let hName = window.yearlyHolidays ? window.yearlyHolidays[dYmd] : null;
    let hasSched = serverData.monthData[d] && serverData.monthData[d].length > 0;

    // 🛠️ 수정 후 (isShowHoliday 조건 추가)
    if (hName && hasSched && isShowHoliday) {
      let linesNeeded = Math.ceil(hName.length / charsPerLine);
      // 💡 [수치 조정] 기존 1.2/0.95에서 -> 0.9/0.72로 대폭 축소하여 빈 공간 제거
      let calcH = (0.9 + linesNeeded * 0.72).toFixed(2) + "em";

      if (weekHeights[wIdx] === "auto" || parseFloat(weekHeights[wIdx]) < parseFloat(calcH)) {
        weekHeights[wIdx] = calcH;
      }
    }
  }

  return { weekSlotHeights, weekHeights, foldedDays };
}

function renderPending() {
  if (serverData.pendingItems && serverData.pendingItems.length > 0) {
    document.getElementById("pendingSection").style.display = "block";
    document.getElementById("pendingCount").innerText = `(${serverData.pendingItems.length}건)`;
    let pListHtml = "";
    serverData.pendingItems.forEach((item, idx) => {
      let meaningfulEtc = item.etc
        ? item.etc
            .replace(
              /\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고일자동수정|출고완료|작업완료|TASK)\]/gi,
              "",
            )
            .trim()
        : "";
      let etcTag = meaningfulEtc !== "" ? `<div class="pending-etc">${_esc(meaningfulEtc)}</div>` : "";
      let isItemDone = item.isDone === true || String(item.isDone) === "true";
      let cleanComp = String(item.company || "").replace(/\[TASK\]/gi, "").trim();
      let bindPending = `onmousedown="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="handleItemClick(event, 'pending', ${idx}, '${_argq(item.company)}', ${isItemDone})"`;
      let checkIcon = isItemDone ? '<span style="font-size:0.9em; margin-right:4px;">✅</span>' : "";
      let pCount = parseInt(item.pal) || 0;
      let bCount = parseInt(item.box) || 0;
      let qtyText = "";
      if (pCount > 0) qtyText = `📦 ${pCount}P`;
      else if (bCount > 0) qtyText = `📦 ${bCount}B`;
      let volHtml = qtyText ? `<div class="pending-vol">${qtyText}</div>` : `<div class="pending-vol"></div>`;
      let colorObj = getCompanyColor(cleanComp);
      let circleHtml = `<div style="width:12px; height:12px; border-radius:50%; background:${colorObj.bg}; margin-right:8px; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>`;
      pListHtml += `<div class="pending-item" id="main-pending-${idx}" ${bindPending}><div style="display:flex; align-items:center; width:100%; pointer-events:none;">${circleHtml}<div class="pending-comp">${checkIcon}${_esc(getFullName(cleanComp))}</div>${volHtml}${etcTag}</div></div>`;
    });
    document.getElementById("pendingList").innerHTML = pListHtml;
  } else {
    document.getElementById("pendingSection").style.display = "none";
  }
}

// =====================================================================
// 📂 칩 많은 날 접기(폴딩) — 하루 FOLD_MIN 건 이상이면 한 덩어리로 요약, 누르면 칸 안에서 펼침
//   · 펼침 상태는 window._foldOpen["년-월-일"] 에 보관(재렌더/동기화에도 유지) · 다중선택 중에는 항상 펼침
// =====================================================================
const FOLD_MIN = 4;
window._foldOpen = window._foldOpen || {};
function _foldKey(day) {
  return `${serverData.year}-${serverData.month}-${day}`;
}
function toggleFold(day, ev) {
  if (ev) ev.stopPropagation(); // 날짜 칸 클릭(상세 모달)로 번지지 않게
  if (isLongPress) {
    setTimeout(() => { isLongPress = false; }, 100); // handleCellClick과 동일: 플래그가 남아 다음 탭이 먹히는 것 방지
    return;
  }
  const k = _foldKey(day);
  window._foldOpen[k] = !window._foldOpen[k];
  renderCalendar();
}
function _multiOn() {
  try { return !!isMultiMode; } catch (e) { return false; } // isMultiMode는 파일 뒤쪽 let 선언 → 초기 TDZ 방어
}
// 접기 대상(간트 막대가 아닌 일반 칩) 개수가 FOLD_MIN 이상인 날 = 접기 가능한 날
function _foldFat(dayData, day) {
  return (dayData || []).filter((it) => !checkIsSlim(it, day));
}
function _pcFoldOpenAll() {
  // PC모드 전용 전역 설정: 펼침 ON이면 모든 달/날짜를 항상 펼침(접기 기능 비활성), OFF면 접기 대상은 모두 접힘
  return document.body.classList.contains("pc-dense") && localStorage.getItem("cal_pc_fold_open") === "on";
}
function togglePcFold() {
  const on = !_pcFoldOpenAll();
  try { localStorage.setItem("cal_pc_fold_open", on ? "on" : "off"); } catch (e) {}
  window._foldOpen = {}; // 개별로 펼쳐둔 날짜 상태 초기화 → 설정이 그대로 모든 날짜에 적용
  renderCalendar();
}
function _foldable(dayData, day) {
  return !!dayData && !_multiOn() && !_pcFoldOpenAll() && _foldFat(dayData, day).length >= FOLD_MIN;
}
function _foldEligibleDays() {
  const r = [];
  for (let d = 1; d <= serverData.daysInMonth; d++) if (_foldable(serverData.monthData[d], d)) r.push(d);
  return r;
}
function foldAnyFolded() {
  return _foldEligibleDays().some((d) => !window._foldOpen[_foldKey(d)]);
}
function toggleFoldAll() {
  const days = _foldEligibleDays();
  if (!days.length) return;
  const open = foldAnyFolded(); // 하나라도 접혀 있으면 전부 펼치고, 전부 펼쳐져 있으면 전부 접음
  days.forEach((d) => (window._foldOpen[_foldKey(d)] = open));
  renderCalendar();
}
function updateFoldAllBtn() {
  const b = document.getElementById("foldAllBtn");
  if (!b) return;
  const days = _foldEligibleDays();
  if (!days.length) { b.style.display = "none"; return; }
  b.style.display = "flex";
  const anyFolded = foldAnyFolded();
  b.textContent = anyFolded ? "📂" : "📁";
  const t = anyFolded ? "접힌 날짜 모두 펼치기" : "모두 접기";
  b.title = t;
  b.setAttribute("aria-label", t);
}
// =====================================================================
// 📂 드래그 중 접힌 날 위에 0.22초 머물면 임시로 펼치고, 벗어나면(0.15초) 다시 접음
//   · window._foldDrag = 임시 펼침 날짜 키(저장 안 됨, 접기 버튼 없음) · 드롭/취소/오류 시 endDrag 래퍼가 반드시 해제
//   · 재렌더로 DOM이 바뀌어도 '들고 있는 원본 칩' 노드는 새 DOM 자리에 되돌려 놓음(터치 이벤트가 끊기지 않게)
// =====================================================================
window._foldDrag = null;
let _foldDragT = null,
  _foldDragWant = undefined;
function _foldDragCellKey(cell) {
  if (!cell) return null;
  const el = cell.querySelector(".date-num");
  const d = el ? parseInt(el.textContent, 10) : NaN;
  return isNaN(d) ? null : _foldKey(d);
}
function _foldDragHover(cell) {
  const curKey = _foldDragCellKey(cell);
  const foldedHere = !!(cell && cell.querySelector(".fold-box"));
  // 임시로 펼쳐 둔 칸 안에 있는 동안은 유지, 접힌 칸 위면 그 칸이 목표, 그 외(다른 칸·빈 곳)는 접기
  const want = window._foldDrag && curKey === window._foldDrag ? window._foldDrag : foldedHere ? curKey : null;
  if (want === _foldDragWant) return;
  _foldDragWant = want;
  clearTimeout(_foldDragT);
  if (want === window._foldDrag) return;
  _foldDragT = setTimeout(() => _foldDragApply(want), want ? 220 : 150);
}
function _foldDragApply(want) {
  if (!isDragging || !dragData) return;
  const day = dragData.day;
  const arr = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  if (!arr) return;
  if (!dragData._item) dragData._item = arr[dragData.idx];
  const item = dragData._item;
  if (!item) return;
  const keep = pressTarget && pressTarget.isConnected ? pressTarget : null;
  window._foldDrag = want;
  renderCalendar();
  lastDropTarget = null;
  _lastInsertPos = null;
  const arr2 = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  const ni = arr2 ? arr2.indexOf(item) : -1;
  if (ni === -1) {
    // 재렌더 중 데이터가 바뀌어 원본을 못 찾음 → 안전하게 드래그 취소
    window._foldDrag = null;
    isDragging = false;
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    document.querySelectorAll(".ghost-clone-element").forEach((el) => el.remove());
    return;
  }
  dragData.idx = ni;
  let fresh = null;
  if (day === "pending") fresh = document.getElementById("main-pending-" + ni);
  else {
    const c = [...document.querySelectorAll(".day-cell:not(.empty)")].find(
      (x) => parseInt((x.querySelector(".date-num") || {}).textContent, 10) === day,
    );
    fresh = c && c.querySelector(`.item-tag[data-raw-idx="${ni}"]`);
  }
  if (keep && fresh && fresh !== keep) {
    fresh.replaceWith(keep);
    pressTarget = keep;
  } else if (fresh) pressTarget = fresh;
  if (pressTarget) pressTarget.style.opacity = "0.3";
  _foldDragWant = want;
  if (typeof window._dragLX === "number") updateGhostPosition(window._dragLX, window._dragLY); // 새 배치 기준으로 다시 판정
}

// 📂 접힌 날이 펼쳐지는 순간 칩들이 촤라락 팝업 (프리뷰7과 동일: 0.26초, 칩당 35ms 간격)
//   · renderCalendar가 grid 전체를 다시 그리므로, 이전 렌더와 비교해 '새로 펼쳐진 날'에만 .fold-pop 부여 (월 이동·다중선택·일반 재렌더는 무모션)
let _foldPrevExp = null,
  _foldPrevYM = "";
function _foldAnimate(grid) {
  const ym = `${serverData.year}-${serverData.month}`;
  if (_multiOn() || _pcFoldOpenAll()) {
    _foldPrevExp = null; // 접기가 꺼진 동안은 기준 초기화(끝난 뒤 한꺼번에 튀어나오는 모션 방지)
    return;
  }
  const now = new Set();
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    const k = _foldKey(d);
    if (_foldable(serverData.monthData[d], d) && (window._foldOpen[k] || k === window._foldDrag)) now.add(d);
  }
  const prev = _foldPrevYM === ym ? _foldPrevExp : null;
  _foldPrevExp = now;
  _foldPrevYM = ym;
  if (!prev) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cells = grid.querySelectorAll(".day-cell:not(.empty)");
  now.forEach((d) => {
    if (prev.has(d) || !cells[d - 1]) return;
    let i = 0;
    cells[d - 1].querySelectorAll(".item-tag:not(.item-tag-slim), .fold-collapse").forEach((el) => {
      if (el.style.opacity === "0" || el.classList.contains("ghost-clone-element")) return;
      el.classList.add("fold-pop");
      el.style.animationDelay = Math.min(i++, 12) * 35 + "ms";
    });
  });
}

function _foldPillsHtml(dayData, day) {
  // dayData = 접힌 일반 칩들(간트 막대 제외)
  const MAX = 8;
  const isDoneIt = (it) => it.isDone === true || String(it.isDone) === "true";
  const total = dayData.length;
  const doneN = dayData.filter(isDoneIt).length;
  const show = total > MAX ? dayData.slice(0, MAX - 1) : dayData;
  const more = total - show.length;
  let tip = `${serverData.month}/${day} · ${total}건`;
  const pills = show
    .map((it) => {
      const clean = String(it.company || "").replace(/\[TASK\]/gi, "").trim();
      const c = getCompanyColor(clean);
      const nm = _esc(getShortName(clean));
      return isDoneIt(it)
        ? `<i class="fold-pl" style="background:${c.bg}; color:${c.cMain}; text-shadow:${c.txtShadow};">${nm}${_shipDotHtml(it.shipType)}</i>`
        : `<i class="fold-pl off" style="box-shadow: inset 0 0 0 1.8px ${c.bg}, 0 1px 2px rgba(0,0,0,0.2);">${nm}${_shipDotHtml(it.shipType)}</i>`;
    })
    .join("");
  dayData.forEach((it) => {
    const clean = String(it.company || "").replace(/\[TASK\]/gi, "").trim();
    const p = parseInt(it.pal) || 0;
    const b = parseInt(it.box) || 0;
    tip += `\n${getShortName(clean)}: ${p > 0 ? p + "P" : b > 0 ? b + "B" : "-"} ${isDoneIt(it) ? "✅" : "대기"}`;
  });
  const left = total - doneN;
  const stat = left
    ? `<span class="fold-stat warn">남음 ${left}</span>`
    : `<span class="fold-stat ok">완료 ✓</span>`;
  return `<div class="fold-box" data-tip="${_esc(tip)}" onclick="toggleFold(${day}, event)"><div class="fold-pills">${pills}${more > 0 ? `<i class="fold-pl more">+${more}</i>` : ""}</div>${stat}</div>`;
}

// 📂 창 너비가 바뀌면(PC 창 조절·기기 회전) 접힘 덩어리의 줄바꿈 높이가 달라지므로, 간트 사이에 끼운 덩어리가 있을 때만 다시 그림
// (키보드 등 높이만 바뀌는 resize는 무시 → 입력 중 재렌더 없음)
let _foldRsT = null,
  _foldRsW = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === _foldRsW) return;
  _foldRsW = window.innerWidth;
  clearTimeout(_foldRsT);
  _foldRsT = setTimeout(() => {
    if (document.querySelector(".fold-slot")) renderCalendar();
  }, 250);
});

function renderCalendar() {
  companyColors = {}; // 렌더마다 초기화 → 삭제된 업체 색 즉시 해제
  // 📂 접기 대상이 아니게 된 날(3건 이하로 줄어듦)의 '펼침' 기록은 지움 → 나중에 다시 4건 이상이 되면 정상적으로 접힘
  //    (다중선택·PC 펼침ON 중에는 일시적으로 접기가 꺼진 것이므로 기록 유지)
  if (!_multiOn() && !_pcFoldOpenAll()) {
    for (let d = 1; d <= serverData.daysInMonth; d++) {
      const k = _foldKey(d);
      if (window._foldOpen[k] && _foldFat(serverData.monthData[d], d).length < FOLD_MIN) delete window._foldOpen[k];
    }
  }
  const { weekSlotHeights, weekHeights, foldedDays } = computeGanttSlots();

  // 🎨 색 사전 배정: 접기/펼치기와 무관하게 같은 순서로 색을 확정(미등록 업체 색이 접을 때마다 바뀌는 것 방지)
  for (let d = 1; d <= serverData.daysInMonth; d++) {
    const arr = serverData.monthData[d];
    if (!arr || !arr.length) continue;
    arr
      .map((it) => String(it.company || "").replace(/\[TASK\]/gi, "").trim())
      .filter(Boolean)
      .sort()
      .forEach((nm) => getCompanyColor(nm));
  }

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

    let isToday = isThisMonthView && day === todayDayNumber;
    let cellClass = isToday ? "day-cell today-cell" : "day-cell";

    let currentYmd = _ymd(serverData.year, serverData.month, day);

    // 🚨 [수정] 이름이 있는지 확인해서 true/false 결정
    let holidayName = window.yearlyHolidays ? window.yearlyHolidays[currentYmd] : null;
    let isHoliday = !!holidayName;
    let redStyle = dayOfWeek === 0 || isHoliday ? "color: #ff3b30 !important; font-weight: bold;" : "";

    let dayData = serverData.monthData[day];
    let prevDayData = serverData.monthData[day - 1];
    let nextDayData = serverData.monthData[day + 1];

    let w = Math.floor((serverData.firstDay + day - 1) / 7);
    let currentHeaderHeight = weekHeights[w];

    if (isHoliday && (!dayData || dayData.length === 0)) {
      currentHeaderHeight = "auto";
    }

    let bindCell = `onmousedown="startPress(event, 'cell', ${day})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="startPress(event, 'cell', ${day})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="handleCellClick(event, ${day})"`;

    let cellHtml = `<div class="${cellClass}" ${bindCell}>`;

    // 🚨 [최종 밀착 구조] line-height를 1.0으로 고정하고 여백(gap)을 0으로 설정
    cellHtml += `<div style="height: ${currentHeaderHeight}; width: 100%; min-width: 0; display:flex; flex-direction:column; align-items:flex-start; line-height: 1.0; margin-bottom: 0px; overflow: hidden; justify-content: flex-start; gap: 0px;">`;

    // 날짜 숫자 줄 간격 타이트하게 조정
    cellHtml += `<div class="${dateClass}" style="${redStyle}; margin-bottom: 0px; margin-left: 2px; line-height: 1.0; height: 1em;">${day}</div>`;

    if (isHoliday && typeof holidayName === "string" && isShowHoliday) {
      // margin-top: 1px만 주어 날짜와 최소한의 구분만 하고 막대와 바짝 붙임
      cellHtml += `<span style="color:#ff3b30; font-size:0.65em; font-weight:800; letter-spacing:-0.5px; margin-top:1px; margin-left:2px; display:block; width:calc(100% - 4px); white-space:normal; word-break:break-all; overflow-wrap:break-word; line-height:1.0;">${holidayName}</span>`;
    }
    cellHtml += `</div>`; // 헤더 구역 끝

    // (💡 참고: 기존에 여기에 있던 let w = Math.floor... 줄은 위로 올렸으므로 삭제하시면 됩니다!)

    const _foldOn = _foldable(dayData, day);
    const _foldIsOpen = _foldOn && !!window._foldOpen[_foldKey(day)];
    const _foldIsClosed = !!foldedDays[day];
    if (dayData && dayData.length > 0) {
      let maxSlot = -1;
      dayData.forEach((item) => {
        if (item._visualSlot !== undefined && item._visualSlot > maxSlot) maxSlot = item._visualSlot;
      });

      let renderArray = new Array(maxSlot + 1).fill(null);
      dayData.forEach((item) => {
        if (item._visualSlot !== undefined) renderArray[item._visualSlot] = item;
      });

      const _slotH = (s) => {
        let h = weekSlotHeights[w] && weekSlotHeights[w][s] ? weekSlotHeights[w][s] : 46;
        // 🖥️ PC모드: 슬롯 높이 슬림(주 전체 균일 축소 → 간트 정렬 유지). 최소 30 보장
        if (document.body.classList.contains("pc-dense")) h = Math.max(30, Math.round(h * 0.66));
        return h;
      };
      // 📂 접힌 날: 막대 사이의 '빈 슬롯 구간' 중 가장 큰 곳에 접힘 덩어리를 끼워 넣음(없거나 작으면 막대 아래)
      let _foldRun = null; // {start, end, h}
      if (_foldIsClosed) {
        let cur = null;
        for (let s = 0; s <= maxSlot; s++) {
          if (!renderArray[s]) {
            if (!cur) cur = { start: s, end: s, h: 0 };
            cur.end = s;
            cur.h += _slotH(s) + 1 + (cur.h > 0 ? 3 : 0); // 칸 flex gap(3px)까지 합산: 슬롯 k개를 한 덩어리로 바꿔도 아래 막대 위치가 그대로
          } else if (cur) {
            if (!_foldRun || cur.h > _foldRun.h) _foldRun = cur;
            cur = null;
          }
        }
        if (cur && (!_foldRun || cur.h > _foldRun.h)) _foldRun = cur;
        if (_foldRun && _foldRun.h < 30) _foldRun = null;
      }
      let _foldPlaced = false;

      for (let s = 0; s <= maxSlot; s++) {
        let item = renderArray[s];
        let sHeight = _slotH(s);

        if (!item) {
          if (_foldRun && s >= _foldRun.start && s <= _foldRun.end) {
            if (s === _foldRun.start) {
              cellHtml += `<div class="fold-slot" style="height:${_foldRun.h}px;">${_foldPillsHtml(_foldFat(dayData, day), day)}</div>`;
              _foldPlaced = true;
            }
            continue;
          }
          cellHtml += `<div class="item-tag" style="opacity:0; pointer-events:none; border:none; background:transparent; box-shadow:none; height:${sHeight}px; min-height:${sHeight}px; margin-bottom:1px; padding:0;"></div>`;
          continue;
        }

        let originalIdx = item._rawIdx;
        let isItemDone = item.isDone === true || String(item.isDone) === "true";
        let cleanCompany = item.company.replace(/\[TASK\]/gi, "").trim();
        let isTaskMode =
          item.company.toUpperCase().startsWith("[TASK]") ||
          /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(cleanCompany));

        let colorObj = getCompanyColor(cleanCompany);
        let shortName = getShortName(cleanCompany);

        let pCount = parseInt(item.pal) || 0;
        let bCount = parseInt(item.box) || 0;
        let qtyText = "";
        if (pCount > 0) qtyText = `${pCount}P`;
        else if (bCount > 0) qtyText = `${bCount}B`;

        let iconHtml = isItemDone ? `<span class="done-icon">✅</span>` : "";
        let tagClass = `item-tag`;
        if (checkIsSlim(item, day)) tagClass += " item-tag-slim";
        if (isItemDone) tagClass += " done-mark";

        let bgStyle = "";
        let innerHtml = "";

        // 🚨 [버그 픽스] null === null 현상 완벽 방어! (ID가 존재할 때만 이어짐 판별)
        let hasPrev = item._ganttId && prevDayData && prevDayData.some((p) => p._ganttId === item._ganttId);
        let hasNext = item._ganttId && nextDayData && nextDayData.some((n) => n._ganttId === item._ganttId);
        let isSingleDayActual = !hasPrev && !hasNext;

        if (isTaskMode && !isSingleDayActual) {
          tagClass += " item-tag-task";
          tagClass = tagClass.replace("done-mark", "");
          let isLinkedLeft = hasPrev && dayOfWeek !== 0;
          let isLinkedRight = hasNext && dayOfWeek !== 6;
          let isEdgeLeft = hasPrev && dayOfWeek === 0;
          let isEdgeRight = hasNext && dayOfWeek === 6;
          let isBlockStart = !isLinkedLeft;
          let colspan = 1;

          if (isBlockStart && (isLinkedRight || isEdgeRight)) {
            let checkDay = day + 1;
            let checkDayOfWeek = dayOfWeek + 1;
            while (checkDay <= serverData.daysInMonth && checkDayOfWeek < 7) {
              let nData = serverData.monthData[checkDay];
              let hasSameTask = nData && nData.some((n) => n._ganttId === item._ganttId);
              if (hasSameTask) {
                colspan++;
                checkDay++;
                checkDayOfWeek++;
              } else break;
            }
          }

          if (isLinkedLeft) tagClass += " linked-left";
          if (isLinkedRight) tagClass += " linked-right";
          if (isEdgeLeft) tagClass += " edge-left";
          if (isEdgeRight) tagClass += " edge-right";

          let vH = 26;
          let mb = sHeight - vH + 1;
          bgStyle = `z-index: ${100 - day}; height:${vH}px !important; min-height:${vH}px !important; margin-bottom:${mb}px !important; box-sizing:border-box;`;
          if (isLinkedLeft || isEdgeLeft) bgStyle += ` border-left: none !important; padding-left: 6px !important;`;

          let taskDoneHtml = isItemDone ? `<div class="task-done-border"></div>` : "";
          if (isBlockStart) {
            let letters = cleanCompany
              .split("")
              .map((l) => `<span>${_esc(l)}</span>`)
              .join("");
            let displayQty =
              qtyText !== "" ? `<span style="font-size:0.8em; margin-left:5px;">(${qtyText})</span>` : "";
            let spanWidth = `calc(${colspan * 100}% + ${(colspan - 1) * 9}px)`;
            innerHtml = `<div class="task-span-text" style="width: ${spanWidth};">${letters}${displayQty}</div><span style="opacity:0;">-</span>${taskDoneHtml}`;
          } else {
            innerHtml = `<span style="opacity:0;">-</span>${taskDoneHtml}`;
          }
        } else {
          if (isTaskMode) tagClass += " item-tag-task";

          // 💡 1. #222222 대신 '소프트 미드나잇' 반투명 컬러 적용!
          bgStyle = `background: ${isTaskMode ? "rgba(33, 37, 41, 0.3)" : colorObj.bg}; height:${sHeight}px; min-height:${sHeight}px; box-sizing:border-box;`;

          // 💡 2. 겉 테두리(border)도 너무 튀지 않게 투명하게 힘을 뺌
          if (isTaskMode && !document.body.classList.contains("light-mode")) {
            bgStyle += ` border: 1px solid rgba(255,255,255,0.15) !important; border-left: 4px solid #FFD60A !important;`;
          } else if (isTaskMode) {
            bgStyle += ` border: 1px solid rgba(0,0,0,0.1) !important; border-left: 4px solid #FFD60A !important;`;
          }

          let txtStyle = `color: ${isTaskMode ? "#fff" : colorObj.cMain} !important; text-shadow: ${isTaskMode ? "none" : colorObj.txtShadow} !important;`;
          let subStyle = `color: ${isTaskMode ? "#fff" : colorObj.cSub} !important;`;
          let subHtml =
            qtyText !== "" || isItemDone
              ? `<span class="pal-sub" style="${subStyle}">${iconHtml}${qtyText}</span>`
              : "";
          innerHtml = `<div style="width:100%; text-align:center; position:relative; z-index:2;"><span class="comp-name" style="${txtStyle}">${_esc(shortName)}</span></div>${subHtml}`;
          if (!isTaskMode && _shipKey(item.shipType)) { // 택배 표시: 칩 오른쪽 위 모서리 작은 표식
            innerHtml += _shipBadgeHtml(item.shipType);
            tagClass += " has-ship";
          }
        }

        let bindItem = `onmousedown="event.stopPropagation(); startPress(event, 'item', ${day}, ${originalIdx})" onmouseup="cancelPress()" onmouseleave="cancelPress()" ontouchstart="event.stopPropagation(); startPress(event, 'item', ${day}, ${originalIdx})" ontouchend="cancelPress()" ontouchmove="cancelPress()" oncontextmenu="event.preventDefault();" onclick="event.stopPropagation(); handleItemClick(event, ${day}, ${originalIdx}, '${_argq(item.company)}', ${isItemDone})"`;

        // hover 툴팁 내용(PC모드): 1줄=제목, 이후 "라벨: 값"
        let _etc = (item.etc || "").replace(/\[[^\]]*\]/g, "").trim();
        let _pal = parseInt(item.pal) || 0;
        let _box = parseInt(item.box) || 0;
        let _tip = `${cleanCompany}`;
        if (!isTaskMode && _shipKey(item.shipType)) _tip += ` · ${_shipLabel(_shipKey(item.shipType))}`;
        if (_pal) _tip += `\n팔레트: ${_pal} P`;
        if (_box) _tip += `\n박스: ${_box} B`;
        if (!_pal && !_box) _tip += `\n수량: -`;
        if (_etc) _tip += `\n비고: ${_etc}`;
        _tip += `\n상태: ${isItemDone ? "✅ " + (isTaskMode ? "작업완료" : "출고완료") : isTaskMode ? "작업대기" : "출고대기"}`;

        // 🚨 핵심: 드래그가 먹히도록 data-raw-idx 강제 추가!
        cellHtml += `<div class="${tagClass}" data-raw-idx="${originalIdx}" data-tip="${_esc(_tip)}" style="${bgStyle}" ${bindItem}>${innerHtml}</div>`;
      }
      // 접힌 날: 간트 막대(위 루프에서 제 슬롯 높이대로 그려짐) 아래에 일반 칩 요약 덩어리
      if (_foldIsClosed && !_foldPlaced) cellHtml += _foldPillsHtml(_foldFat(dayData, day), day);
      if (_foldIsOpen) cellHtml += `<div class="fold-collapse" onclick="toggleFold(${day}, event)">접기 ▴</div>`;
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
  // 📂 빈 슬롯 구간에 끼워 넣은 접힘 덩어리가 구간보다 크면(막대 정렬을 밀어버리므로) 막대 아래로 옮김
  grid.querySelectorAll(".fold-slot").forEach((sl) => {
    const bx = sl.firstElementChild;
    if (bx && bx.offsetHeight > sl.offsetHeight + 0.5) sl.parentElement.appendChild(bx);
  });
  _foldAnimate(grid);

  // ... (나머지 대기열 그리는 부분은 기존과 완벽히 동일합니다!)
  renderPending();
  if (isAdmin) {
    if (!isMultiMode) document.getElementById("fabBtn").style.display = "flex";
  }
  updateSyncTime();
  updateFoldAllBtn();
  // 🚨 [추가] 달력을 다 그리고 나면, 하단 통계 수치도 실시간으로 업데이트!
  updateStatsSummary();
  renderPcSidePanel(); // PC모드 우측 패널
  renderPcLeftbar(); // PC모드 좌측 사이드바
  // 콜드스타트 부트 로더 제거 (첫 렌더 완료)
  const _bl = document.getElementById("bootLoader");
  if (_bl) _bl.classList.add("hide");
  // 검색 점프 하이라이트: 재렌더 직후 즉시 재적용(깜빡임 없이 유지)
  if (window._pcHl) reapplyPcHl();
}

// =====================================================================
// 🖥️ PC 모드 (출고) — body.pc-dense + 마우스 미디어에서만. 모바일/토글OFF 불변
// =====================================================================
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
  if (typeof navMonth === "function") navMonth(0); // 슬롯 슬림/복원 즉시 반영 위해 재렌더
}
function ensurePcSidePanel() {
  if (document.getElementById("pcSidePanel")) return;
  const el = document.createElement("aside");
  el.id = "pcSidePanel";
  document.body.appendChild(el);
}
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

// 🔍 PC 사이드바 일정 검색 (출고: 업체명 포함검색 + 작업기간 선택)
let _pcSearchTimer = null;
function pcSearchInput() {
  if (_pcSearchTimer) clearTimeout(_pcSearchTimer);
  _pcSearchTimer = setTimeout(runPcSearch, 280);
}
// 작업기간 달력버튼: 버튼 전체를 누르면 달력 팝업
function pcOpenDate(id) {
  const inp = document.getElementById(id);
  if (!inp) return;
  try {
    inp.showPicker();
  } catch (_) {
    inp.focus();
    inp.click();
  }
}
// 작업기간 달력버튼: 선택 시 라벨에 M/D 표시 + 검색
function onPcDate() {
  syncPcDateCaps();
  runPcSearch();
}
function syncPcDateCaps() {
  const fmt = (v, def) => {
    if (!v) return { t: def, set: false };
    const p = v.split("-");
    return { t: `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`, set: true };
  };
  const s = document.getElementById("pcSearchStart");
  const e = document.getElementById("pcSearchEnd");
  const cs = document.getElementById("capStart");
  const ce = document.getElementById("capEnd");
  if (s && cs) {
    const r = fmt(s.value, "부터");
    cs.textContent = r.t;
    cs.classList.toggle("set", r.set);
  }
  if (e && ce) {
    const r = fmt(e.value, "까지");
    ce.textContent = r.t;
    ce.classList.toggle("set", r.set);
  }
}
function runPcSearch() {
  const inp = document.getElementById("pcSearchKw");
  const box = document.getElementById("pcSearchResults");
  if (!inp || !box) return;
  const kw = inp.value.trim();
  const sd = (document.getElementById("pcSearchStart")?.value || "").trim();
  const ed = (document.getElementById("pcSearchEnd")?.value || "").trim();
  window._pcSearchKw = kw;
  window._pcSearchSd = sd;
  window._pcSearchEd = ed;
  // 검색어가 있을 때만 검색 (기간만으로는 결과 출력 안 함 — 기간은 보조 필터)
  if (kw.length < 1) {
    box.innerHTML = `<div class="pcsr-empty"><span class="pcsr-empty-ico">🔎</span><span>업체·작업·출고지시번호를 입력하세요</span>${sd || ed ? `<span class="pcsr-empty-sub">기간은 보조 필터</span>` : ""}</div>`;
    window._pcSearchHtml = box.innerHTML;
    return;
  }
  // 약어(CRM 단축명)로도 검색되도록 매칭되는 정식 업체명 확장
  let companies = [];
  if (kw && typeof compInfoDB === "object" && compInfoDB) {
    for (const mName in compInfoDB) {
      const sn = (compInfoDB[mName] && compInfoDB[mName].shortName) || "";
      if (sn && sn.includes(kw)) companies.push(mName);
    }
  }
  box.innerHTML = `<div class="pcsr-empty"><span class="pcsr-empty-ico">⏳</span><span>검색 중…</span></div>`;
  apiCall({
    source: "vercel",
    action: "SEARCH_SCHEDULES",
    type: "out",
    keyword: kw,
    startDate: sd,
    endDate: ed,
    companies: companies,
  }).then((res) => {
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
          const raw = r.company || "-";
          const isTask = raw.startsWith("[TASK]");
          const compRaw = raw.replace(/^\[TASK\]/, "").trim() || "-";
          const comp = _hlKw(compRaw, kw);
          const done = r.isDone === true || String(r.isDone) === "1" || String(r.isDone) === "true";
          const dot = isTask ? "#af52de" : done ? "#34c759" : "#ff9f0a";
          const pal = parseInt(r.pal) || 0;
          const bx = parseInt(r.box) || 0;
          const sub = (isTask ? "작업" : `${pal}P · ${bx}B`) + (r.ord_hit ? ` · 🔖${_esc(String(r.ord_hit).split(",")[0])}` : "");
          return `<button class="pcsr-item" onclick="pcJumpTo('${d}','${_argq(raw)}')">
              <span class="pcsr-dot" style="background:${dot}"></span>
              <span class="pcsr-main"><span class="pcsr-big" style="font-weight:700">${isTask ? "🛠 " : ""}${comp}</span><span class="pcsr-inv">${sub}</span></span>
              <span class="pcsr-meta">${d || "미정"}</span>
            </button>`;
        })
        .join("");
    window._pcSearchHtml = box.innerHTML;
  });
}
// 검색 초기화: 입력어·작업기간·결과·하이라이트 모두 비움
function pcSearchReset() {
  window._pcSearchKw = "";
  window._pcSearchSd = "";
  window._pcSearchEd = "";
  window._pcSearchHtml = "";
  window._pcSearchScroll = 0;
  window._pcHl = null;
  const inp = document.getElementById("pcSearchKw");
  const box = document.getElementById("pcSearchResults");
  const s = document.getElementById("pcSearchStart");
  const e = document.getElementById("pcSearchEnd");
  if (inp) inp.value = "";
  if (s) s.value = "";
  if (e) e.value = "";
  if (box) box.innerHTML = "";
  syncPcDateCaps();
  if (typeof clearClickedHighlight === "function") clearClickedHighlight();
  if (inp) inp.focus();
}

function pcJumpTo(dateStr, key) {
  if (!dateStr) {
    // 미정/대기 건 — 대기 목록 열고 해당 업체 강조 (key=원본 company, [TASK] 포함)
    const pend = serverData.pendingItems || [];
    let pIdx = key ? pend.findIndex((it) => String(it.company || "") === key) : -1;
    if (typeof showModal === "function") showModal("pending", pIdx >= 0 ? pIdx : null);
    return;
  }
  const box = document.getElementById("pcSearchResults");
  if (box) window._pcSearchScroll = box.scrollTop; // 결과 스크롤 위치 기억
  const [y, m, day] = dateStr.split("-").map((v) => parseInt(v, 10));
  // 재렌더(캐시→서버 응답)에도 하이라이트가 유지되도록 일정 시간 동안 반복 적용
  window._pcHl = { y: y, m: m, day: day, key: key || "", expire: Date.now() + 4500, scrolled: false };
  window._foldOpen = window._foldOpen || {};
  window._foldOpen[`${y}-${m}-${day}`] = true; // 검색 결과 날짜는 접혀 있어도 펼쳐서 강조
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
    box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">🔎</span><span>업체·작업·출고지시번호를 입력하세요</span></div>`;
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
  if (kw.length < 1) {
    box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">🔎</span><span>업체·작업·출고지시번호를 입력하세요</span></div>`;
    return;
  }
  // 약어(CRM 단축명)로도 검색되도록 매칭되는 정식 업체명 확장
  let companies = [];
  if (typeof compInfoDB === "object" && compInfoDB) {
    for (const mName in compInfoDB) {
      const sn = (compInfoDB[mName] && compInfoDB[mName].shortName) || "";
      if (sn && sn.includes(kw)) companies.push(mName);
    }
  }
  box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">⏳</span><span>검색 중…</span></div>`;
  apiCall({ source: "vercel", action: "SEARCH_SCHEDULES", type: "out", keyword: kw, companies: companies }).then(
    (res) => {
      if (!res || !res.success || !Array.isArray(res.rows) || res.rows.length === 0) {
        box.innerHTML = `<div class="fsr-empty"><span class="fsr-empty-ico">📭</span><span>결과 없음</span><span class="fsr-empty-sub">다른 검색어로 시도해 보세요</span></div>`;
        return;
      }
      box.innerHTML =
        `<div class="fsr-cnt">${res.rows.length}건</div>` +
        res.rows
          .map((r) => {
            const d = (r.date || "").slice(0, 10);
            const raw = r.company || "-";
            const isTask = raw.startsWith("[TASK]");
            const compRaw = raw.replace(/^\[TASK\]/, "").trim() || "-";
            const comp = _hlKw(compRaw, kw);
            const done = r.isDone === true || String(r.isDone) === "1" || String(r.isDone) === "true";
            const dot = isTask ? "#af52de" : done ? "#34c759" : "#ff9f0a";
            const pal = parseInt(r.pal) || 0;
            const bx = parseInt(r.box) || 0;
            const sub = (isTask ? "작업" : `${pal}P · ${bx}B`) + (r.ord_hit ? ` · 🔖${_esc(String(r.ord_hit).split(",")[0])}` : "");
            return `<button class="fsr-item" onclick="closeFabSearch(); pcJumpTo('${d}','${_argq(raw)}')">
              <span class="fsr-dot" style="background:${dot}"></span>
              <span class="fsr-main"><span class="fsr-big" style="font-weight:700">${isTask ? "🛠 " : ""}${comp}</span><span class="fsr-sub">${sub}</span></span>
              <span class="fsr-meta">${d || "미정"}</span>
            </button>`;
          })
          .join("");
    },
  );
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
// 🖥️ 책갈피 탭 / 딤 + 접기 토글
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
  if (!document.getElementById("pcMiniNav")) {
    const n = document.createElement("div");
    n.id = "pcMiniNav";
    n.innerHTML = `<button onclick="navMonth(-1)" aria-label="이전 달">‹</button><span id="pcMiniNavLabel" onclick="openPicker()"></span><button onclick="navMonth(1)" aria-label="다음 달">›</button>`;
    document.body.appendChild(n);
  }
  ensurePcTip();
}
// 🖥️ hover 툴팁 (PC모드 전용)
function ensurePcTip() {
  if (document.getElementById("pcTip")) return;
  const t = document.createElement("div");
  t.id = "pcTip";
  document.body.appendChild(t);
  document.addEventListener("mouseover", (e) => {
    if (!document.body.classList.contains("pc-dense")) return;
    const tag = e.target.closest && e.target.closest(".item-tag[data-tip], .fold-box[data-tip], .pcp-pend-item[data-tip]");
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
    t.classList.toggle("tip-fx", flipX);
    t.classList.toggle("tip-fy", flipY);
    t.style.left = x + "px";
    t.style.top = y + "px";
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(".item-tag[data-tip], .fold-box[data-tip], .pcp-pend-item[data-tip]")) t.style.display = "none";
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
// 좌측 임계 창폭(출고, 우측 닫힘 기준). 우측은 패널폭(336) 만큼 더 넓어야 열림
const PC_DOCK_MIN = 819;
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
function renderPcSidePanel() {
  if (!document.body.classList.contains("pc-dense")) return;
  ensurePcSidePanel();
  const panel = document.getElementById("pcSidePanel");
  if (!panel) return;
  let totalPal = 0,
    totalBox = 0,
    totalCnt = 0,
    doneCnt = 0;
  const md = serverData.monthData || {};
  Object.keys(md).forEach((d) =>
    (md[d] || []).forEach((it) => {
      totalCnt++;
      totalPal += parseInt(it.pal || 0) || 0;
      totalBox += parseInt(it.box || 0) || 0;
      if (it.isDone === true || String(it.isDone) === "true") doneCnt++;
    }),
  );
  const waitCnt = totalCnt - doneCnt;
  const pend = serverData.pendingItems || [];

  // 📊 미니 통계보드 지표 (serverData만 사용). 출고는 작업(TASK)/출고 비율 포함
  const now = new Date();
  const isCurMonth =
    parseInt(serverData.year) === now.getFullYear() && parseInt(serverData.month) === now.getMonth() + 1;
  const dim = new Date(parseInt(serverData.year), parseInt(serverData.month), 0).getDate();
  let todayCnt = 0,
    weekCnt = 0,
    notDonePal = 0,
    peakDay = 0,
    peakPal = 0,
    taskCnt = 0,
    shipCnt = 0;
  const wkStart = now.getDate() - now.getDay(); // 한 주 시작 = 일요일
  const wkEnd = wkStart + 6;
  for (let d = 1; d <= dim; d++) {
    const arr = md[d] || [];
    if (!arr.length) continue;
    let dayPal = 0;
    arr.forEach((it) => {
      const p = parseInt(it.pal || 0) || 0;
      dayPal += p;
      if (!(it.isDone === true || String(it.isDone) === "true")) notDonePal += p;
      if (String(it.company || "").startsWith("[TASK]")) taskCnt++;
      else shipCnt++;
    });
    if (dayPal > peakPal) {
      peakPal = dayPal;
      peakDay = d;
    }
    if (isCurMonth && d === now.getDate()) todayCnt = arr.length;
    if (isCurMonth && d >= wkStart && d <= wkEnd) weekCnt += arr.length;
  }
  const shipPct = taskCnt + shipCnt ? Math.round((shipCnt / (taskCnt + shipCnt)) * 100) : 0;
  const miniBoard = `
    <div class="pcp-card">
      <div class="pcp-title">📊 미니 통계</div>
      <div class="pcp-tiles">
        <div class="pcp-tile"><span class="pcp-tile-v">${isCurMonth ? todayCnt : "–"}</span><span class="pcp-tile-l">오늘 출고</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${isCurMonth ? weekCnt : "–"}</span><span class="pcp-tile-l">이번주</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${waitCnt}</span><span class="pcp-tile-l">미완료 일정</span></div>
        <div class="pcp-tile"><span class="pcp-tile-v">${peakDay ? peakDay + "일" : "–"}</span><span class="pcp-tile-l">최다일 ${peakDay ? peakPal + "P" : ""}</span></div>
      </div>
      <div class="pcp-ratio">
        <div class="pcp-ratio-bar"><span style="width:${shipPct}%"></span></div>
        <div class="pcp-ratio-lbl"><span>📦 출고 ${shipCnt}</span><span>🛠 작업 ${taskCnt}</span></div>
      </div>
    </div>`;

  let html = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
      <button class="pc-collapse-btn" onclick="togglePcRight()" title="패널 접기">›</button>
    </div>
    <div class="pcp-card">
      <div class="pcp-title">📊 ${serverData.year}.${String(serverData.month).padStart(2, "0")} 요약</div>
      <div class="pcp-donut" style="background: conic-gradient(#34c759 0% ${totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0}%, var(--btn-bg) ${totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0}% 100%);">
        <div class="pcp-donut-hole"><b>${totalCnt ? Math.round((doneCnt / totalCnt) * 100) : 0}%</b><span>완료</span></div>
      </div>
      <div class="pcp-stat-row"><span>총 팔레트</span><b>${totalPal} P</b></div>
      <div class="pcp-stat-row"><span>총 박스</span><b>${totalBox} B</b></div>
      <div class="pcp-stat-row"><span>총 건수</span><b>${totalCnt}건</b></div>
      <div class="pcp-stat-row"><span>✅ 완료 / ⏳ 대기</span><b>${doneCnt} / ${waitCnt}</b></div>
      <div style="margin-top:10px;"><button class="pcp-btn" onclick="openDashboard()">📊 전체 통계 보기</button></div>
    </div>
    ${miniBoard}
    <div class="pcp-card">
      <div class="pcp-title">⏳ 출고 대기 / 미정 (${pend.length}건)</div>`;
  if (pend.length === 0) {
    html += `<div class="pcp-empty"><span class="pcp-empty-ico">✅</span><span>대기 중인 건이 없습니다</span></div>`;
  } else {
    pend.forEach((it, idx) => {
      const cleanComp = String(it.company || "").replace(/\[TASK\]/gi, "").trim();
      const isTask = /\[TASK\]/i.test(it.company || "");
      const isItemDone = it.isDone === true || String(it.isDone) === "true";
      const pal = parseInt(it.pal || 0), box = parseInt(it.box || 0);
      const colorObj = getCompanyColor(cleanComp);
      const rawEtc = String(it.etc || "");
      const meaningfulEtc = rawEtc.replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고일자동수정|출고완료|작업완료|TASK)\]/gi, "").trim();

      // 툴팁 내용
      let tip = getFullName(cleanComp);
      if (pal) tip += `\n팔레트: ${pal} P`;
      if (box) tip += `\n박스: ${box} B`;
      if (!pal && !box) tip += `\n수량: -`;
      if (meaningfulEtc) tip += `\n비고: ${meaningfulEtc}`;
      tip += `\n상태: ${isItemDone ? "✅ 출고완료" : isTask ? "⏳ 작업대기" : "⏳ 출고대기(미정)"}`;

      const qtyBadge = (pal || box)
        ? `<span style="font-size:0.8em; font-weight:800; color:var(--text-sub); background:var(--btn-bg,rgba(128,128,128,0.12)); border-radius:5px; padding:1px 6px; flex-shrink:0; pointer-events:none;">${pal ? pal + "P" : box + "B"}</span>`
        : "";
      const taskBadge = isTask
        ? `<span style="font-size:0.72em; background:rgba(90,200,250,0.12); color:#5ac8fa; border:1px solid rgba(90,200,250,0.25); border-radius:4px; padding:1px 5px; font-weight:700; flex-shrink:0; pointer-events:none;">작업</span>`
        : "";
      const statusDot = isItemDone
        ? `<span style="font-size:0.8em; color:#34c759; flex-shrink:0; pointer-events:none;">✅</span>`
        : "";

      html += `<div class="pcp-pend-item" style="cursor:grab;" data-tip="${_esc(tip)}"
        onmousedown="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" onmouseup="cancelPress()" onmouseleave="cancelPress()"
        ontouchstart="event.stopPropagation(); startPress(event, 'item', 'pending', ${idx})" ontouchend="cancelPress()" ontouchmove="cancelPress()"
        oncontextmenu="event.preventDefault();"
        onclick="handleItemClick(event, 'pending', ${idx}, '${_argq(it.company)}', ${isItemDone})">
        <div style="display:flex; align-items:center; gap:6px; width:100%; pointer-events:none;">
          <span style="color:var(--text-sub); font-size:0.85em; flex-shrink:0; opacity:0.45; letter-spacing:-1px; pointer-events:none;">⠿</span>
          <div style="width:9px; height:9px; border-radius:50%; background:${colorObj.bg}; flex-shrink:0; box-shadow:0 1px 3px rgba(0,0,0,0.15); pointer-events:none;"></div>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; pointer-events:none;">${_esc(getFullName(cleanComp))}</span>
          ${taskBadge}${statusDot}${qtyBadge}
        </div>
        ${meaningfulEtc ? `<div style="font-size:0.78em; color:var(--text-sub); margin-top:3px; padding-left:21px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none;">${_esc(meaningfulEtc)}</div>` : ""}
      </div>`;
    });
  }
  html += `</div>`;
  panel.innerHTML = html;
}
function renderPcLeftbar() {
  if (!document.body.classList.contains("pc-dense")) return;
  ensurePcLeftbar();
  const bar = document.getElementById("pcLeftbar");
  if (!bar) return;
  // 재빌드 전 검색 입력창 상태 보존 — innerHTML 교체로 포커스가 날아가는 문제 방지
  const _prevKw  = document.getElementById("pcSearchKw")?.value ?? "";
  const _focused = document.activeElement?.id === "pcSearchKw";
  const _selS    = _focused ? (document.getElementById("pcSearchKw")?.selectionStart ?? null) : null;
  const _selE    = _focused ? (document.getElementById("pcSearchKw")?.selectionEnd   ?? null) : null;
  const ym = `${serverData.year}.${String(serverData.month).padStart(2, "0")}`;
  const mn = document.getElementById("pcMiniNavLabel");
  if (mn) mn.textContent = ym;
  const on = (id) => {
    const e = document.getElementById(id);
    return e && e.classList.contains("active") ? "pclb-on" : "";
  };
  const holidayOn = typeof isShowHoliday !== "undefined" && isShowHoliday;
  const pcFoldOpen = _pcFoldOpenAll();
  const admin = typeof isAdmin !== "undefined" && isAdmin;
  const dark = typeof isDarkMode !== "undefined" && isDarkMode;
  bar.innerHTML = `
    <div class="pclb-brand">
      <img src="/apple-touch-icon.png" class="pclb-logo" alt="">
      <div class="pclb-title">출고캘린더</div>
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
        <input id="pcSearchKw" class="pclb-search-input" type="text" placeholder="업체 · 작업"
          oninput="pcSearchInput()" onkeydown="if(event.key==='Enter')runPcSearch()" autocomplete="off" />
      </div>
      <div class="pclb-daterow">
        <button type="button" class="pclb-datebtn" onclick="pcOpenDate('pcSearchStart')"><span class="pclb-datecap" id="capStart">부터</span><span class="pclb-dateico">📅</span><input id="pcSearchStart" type="date" tabindex="-1" onchange="onPcDate()" /></button>
        <button type="button" class="pclb-datebtn" onclick="pcOpenDate('pcSearchEnd')"><span class="pclb-datecap" id="capEnd">까지</span><span class="pclb-dateico">📅</span><input id="pcSearchEnd" type="date" tabindex="-1" onchange="onPcDate()" /></button>
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

    <button class="pclb-item ${pcFoldOpen ? "pclb-on" : ""}" onclick="togglePcFold()" title="ON: 모든 달 항상 펼침 / OFF: 모두 접힘">${pcFoldOpen ? "📂" : "📁"} 일정 펼침 ${pcFoldOpen ? "ON" : "OFF"}</button>

    <div class="pclb-sec">기능</div>
    ${admin ? `<button class="pclb-item pclb-add-btn" onclick="openAddForm()">✏️ 신규 등록</button>` : ""}
    ${admin ? `<button class="pclb-item pclb-ai-btn" onclick="openAiQuery()">🤖 AI 질의</button>` : ""}
    <button class="pclb-item" onclick="openDashboard()">📊 통계 대시보드</button>
    <button class="pclb-item" onclick="openCompListModal()">🏢 거래처 정보</button>
    <button class="pclb-item" id="pcMultiBtn" onclick="toggleMultiMode()">☑️ 다중 선택</button>
    <button class="pclb-item" onclick="navMonth(0)">🔄 새로고침</button>

    <div class="pclb-sec">계정 / 설정</div>
    <button class="pclb-item ${admin ? "pclb-on" : ""}" onclick="toggleAdmin(); setTimeout(renderPcLeftbar, 60)">${admin ? "🔓 관리자 모드" : "🔒 관리자 로그인"}</button>

    <div class="pclb-info" style="margin-top:auto;">
      <div>🔄 동기화 <b>${_esc((document.getElementById("lastSyncTime")?.innerText || "-").replace("최근 ", "").trim())}</b></div>
    </div>
    <button class="pclb-off" onclick="togglePcDense()">🖥️ PC모드 끄기</button>
  `;
  // 사이드바 재렌더 시 진행 중인 검색어/기간/결과 복원 (월 점프해도 목록 유지)
  if (window._pcSearchKw || window._pcSearchSd || window._pcSearchEd || _prevKw) {
    const inp = document.getElementById("pcSearchKw");
    const si = document.getElementById("pcSearchStart");
    const ei = document.getElementById("pcSearchEnd");
    const box = document.getElementById("pcSearchResults");
    // _prevKw 우선: innerHTML 교체 직전에 직접 캡처한 값 (아직 window._pcSearchKw에 반영 안 된 경우 포함)
    if (inp) inp.value = _prevKw || window._pcSearchKw || "";
    if (si && window._pcSearchSd) si.value = window._pcSearchSd;
    if (ei && window._pcSearchEd) ei.value = window._pcSearchEd;
    if (box && window._pcSearchHtml) {
      box.innerHTML = window._pcSearchHtml;
      box.scrollTop = window._pcSearchScroll || 0; // 결과 스크롤 위치 복원
    }
    // 포커스·커서 위치 복원 — 재빌드로 인한 포커스 소실 방지
    if (_focused && inp) {
      inp.focus();
      if (_selS !== null) try { inp.setSelectionRange(_selS, _selE); } catch (_) {}
    }
  }
  syncPcDateCaps(); // 작업기간 달력버튼 라벨 동기화
  // 좌측바 재빌드 후 다중선택 버튼 상태 복원
  const _pcMultiBtn = document.getElementById("pcMultiBtn");
  if (_pcMultiBtn && isMultiMode) {
    _pcMultiBtn.innerText = "❌ 다중선택 취소";
    _pcMultiBtn.style.color = "#ff3b30";
    _pcMultiBtn.style.fontWeight = "900";
  }
}
// 저장된 PC모드 선호 복원 (기본 OFF — 기존 사용자 영향 없음)
window.addEventListener("DOMContentLoaded", function () {
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
});

// 💡 [미니 CRM] 데이터 조용히 백그라운드 동기화하는 함수
function syncCrmDataBackground() {
  apiCall({ source: "vercel", action: "GET_COMP_INFO_DB" }).then(function (dbData) {
    if (dbData) {
      compInfoDB = dbData;
      localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
    }
    if (typeof migrateFixedCompanies === "function") migrateFixedCompanies(); // 서버 최신 데이터 기준 1회 seed
    renderCalendar();
  });
}

// 🚀 [달력 이동 로직] 문자열 결합 버그 차단 & 순수 숫자 계산 강제
function navMonth(offset) {
  let currentY = parseInt(serverData.year, 10);
  let currentM = parseInt(serverData.month, 10);

  // 💡 [치유 로직] 혹시라도 캐시가 완전히 망가져서 숫자가 아니면(NaN) 강제로 이번 달로 초기화!
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

let tempPickerYear = serverData.year; // 💡 관리자님 원래 코드 그대로 유지!

function openPicker() {
  // 💡 팝업을 열 때 무조건 현재 달력의 '숫자' 연도를 기준으로 엽니다.
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

    // 🚀 버튼 누르는 즉시 팝업창 닫고 이동!
    gridHtml += `<button class="month-btn ${isCurrent}" onclick="document.getElementById('monthPickerModal').style.display='none'; goToAsync(${tempPickerYear}, ${i})">${i}월</button>`;
  }
  document.getElementById("pickerMonthGrid").innerHTML = gridHtml;
}

function goToAsync(year, month) {
  // 💡 [미니 CRM 패치] 달력을 이동하거나 새로고침(0)할 때 CRM 최신 데이터도 몰래 가져옵니다!
  syncCrmDataBackground();
  const toastEl = document.getElementById("toast");
  if (toastEl) toastEl.classList.remove("show");
  if (window.toastTimer) clearTimeout(window.toastTimer);

  let safeYear = parseInt(year, 10);
  let safeMonth = parseInt(month, 10);

  checkAndFetchHolidays(safeYear);

  // 💡 [패치] 달력을 넘기기 전에 현재 가지고 있는 '미정(대기)' 최신 목록을 배낭에 챙깁니다!
  let globalPending = serverData.pendingItems || [];

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

      // 🚨 [핵심 패치 3] 달력을 넘길 때 꺼내오는 캐시 데이터도 순서표대로 정렬!
      if (typeof preserveCustomOrder === "function") {
        serverData = preserveCustomOrder(serverData);
      }
    } catch (e) {}
  }

  if (!isCacheValid) {
    let tempFirstDay = new Date(safeYear, safeMonth - 1, 1).getDay();
    let tempDays = new Date(safeYear, safeMonth, 0).getDate();
    serverData = { year: safeYear, month: safeMonth, firstDay: tempFirstDay, daysInMonth: tempDays, monthData: {} };
  }

  // 💡 [패치] 새로 연 달력에 아까 챙겨둔 '미정(대기)' 목록을 그대로 덮어씌워서 깜빡임 방지!
  serverData.pendingItems = globalPending;

  // 💡 [패치 4] 수동 동기화/달력 넘길 때 색상도 즉시 불러오기!
  apiCall({ source: "vercel", action: "GET_GLOBAL_COLORS" }).then((c) => {
    if (c !== null) {
      customColors = c;
      localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(c));
      renderCalendar();
    }
  });

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

    if (typeof preserveCustomOrder === "function") res = preserveCustomOrder(res);

    let isScheduleChanged = getScheduleSig(serverData) !== getScheduleSig(res);
    if (isScheduleChanged) {
      serverData = res;
      localStorage.setItem(cacheKey, JSON.stringify(res));
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
          window.dashYearlyYear === res.year
        ) {
          renderDashCharts();
        }
      }
    });
  }, 1500);
}

// 🚀 [제자리 수정 패치] 날짜가 바뀌지 않으면 삭제/추가를 생략하고 '제자리'에서 데이터만 교체!
// ───────── 🚚 배송 구분 (용차 = 기본 / 용마택배 / CJ택배) ─────────
//  일정(item)에 shipType: "" (용차, 값 없음) | "용마" | "CJ" 로 붙어 다닌다. 서버 outbound.ship_type 과 같은 값.
function _shipKey(v) {
  const t = String(v == null ? "" : v).replace(/\s+/g, "").toLowerCase();
  if (/용마|yongma/.test(t)) return "용마";
  if (/^cj|씨제이|대한통운/.test(t)) return "CJ";
  return "";
}
function _shipLabel(k) {
  return k === "용마" ? "용마택배" : k === "CJ" ? "CJ택배" : "용차";
}
const _SHIP_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.6 12 3.2l8.5 4.4v8.8L12 20.8l-8.5-4.4z M3.5 7.6 12 12l8.5-4.4 M12 12v8.8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
function _shipBadgeHtml(k) {
  k = _shipKey(k);
  if (!k) return "";
  return `<span class="ship-badge ship-${k === "CJ" ? "cj" : "ym"}" aria-label="${_shipLabel(k)}">${_SHIP_SVG}</span>`;
}
function _shipPillHtml(k) {
  k = _shipKey(k);
  if (!k) return "";
  return `<span class="ship-pill ship-${k === "CJ" ? "cj" : "ym"}">${_SHIP_SVG}${_shipLabel(k)}</span>`;
}
function _shipDotHtml(k) {
  k = _shipKey(k);
  return k ? `<u class="ship-dot ship-${k === "CJ" ? "cj" : "ym"}"></u>` : "";
}
function _shipSelectHtml(id, cur, cls) {
  const c = _shipKey(cur);
  const op = (v, t) => `<option value="${v}"${c === v ? " selected" : ""}>${t}</option>`;
  return `<select id="${id}" class="${cls || "edit-input"}" style="width:100%;box-sizing:border-box">${op("", "🚚 용차 (기본)")}${op("용마", "📦 용마택배")}${op("CJ", "📦 CJ택배")}</select>`;
}
(function _shipInjectCss() {
  if (document.getElementById("shipCss")) return;
  const st = document.createElement("style");
  st.id = "shipCss";
  st.textContent = `
    .item-tag.has-ship{position:relative}
    .ship-badge{position:absolute;top:0;right:0;width:19px;height:19px;clip-path:polygon(0 0,100% 0,100% 100%);color:#fff;z-index:3;pointer-events:none;display:block}
    .ship-badge svg{position:absolute;top:2px;right:2px;width:9px;height:9px;display:block;filter:drop-shadow(0 0 1px rgba(0,0,0,.35))}
    .item-tag-slim .ship-badge{display:none}
    .ship-ym{background:linear-gradient(135deg,#ffb340,#ff8a00)}
    .ship-cj{background:linear-gradient(135deg,#ff5e7e,#e5174a)}
    .ship-pill{display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 8px 2px 6px;border-radius:999px;font-size:.78em;font-weight:900;color:#fff;letter-spacing:-.2px;vertical-align:middle}
    .ship-pill svg{width:12px;height:12px;display:block}
    .ship-dot{display:inline-block;width:5px;height:5px;border-radius:50%;margin-left:2px;vertical-align:middle;text-decoration:none;box-shadow:0 0 0 1px rgba(255,255,255,.85)}
  `;
  document.head.appendChild(st);
})();

function updateLocalState(action, payload, idx) {
  const safeStr = (v) => (v == null || v === "" ? "" : String(v).trim());
  const norm = (v) => {
    let s = safeStr(v);
    return s === "0" || s === "" ? "" : s;
  };

  const parseDay = (dateStr) => {
    if (!dateStr || String(dateStr) === "미정" || String(dateStr).trim() === "") return "pending";
    let parts = String(dateStr).split("-");
    if (parts.length < 3) return "pending";
    let [y, m, d] = parts;
    if (parseInt(y, 10) !== serverData.year || parseInt(m, 10) !== serverData.month) return "hidden";
    return parseInt(d, 10);
  };

  let oldDay = parseDay(payload.oldDate);
  let newDay = parseDay(payload.newDate);
  // 출고지시번호(화면 즉시 반영용): 수정창에서 바꾼 값(orderSlots) 또는 새 일정 등록 때 적은 값(orderNos)
  const _slotOrds = payload.orderSlots ? _ordSlotsToList(payload.orderSlots) : action === "ADD" && payload.orderNos ? _ordSlotsToList({ 0: payload.orderNos }) : null;
  let _removedOrds = null;
  let _removedShip = "";

  // 📂 새 일정이 들어가거나 다른 날로 옮겨진 날은 접혀 있어도 펼쳐서 결과가 바로 보이게
  const _nc = String(payload.newComp || payload.oldComp || "");
  const _newIsTask =
    /^\[TASK\]/i.test(_nc) || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(_nc.replace(/\[TASK\]/gi, "").trim()));
  if (
    (action === "ADD" || action === "EDIT") &&
    !_newIsTask && // 간트 막대(작업)는 접기 개수에 안 들어가므로 펼치지 않음
    typeof newDay === "number" &&
    (action !== "EDIT" || oldDay !== newDay)
  ) {
    window._foldOpen[_foldKey(newDay)] = true;
  }

  // 🚨 [핵심 픽스] 날짜를 바꾸지 않은 단순 수정(색상, 메모 등)은 제자리에서 수정! (밑으로 떨어지지 않음)
  let isSimpleEdit =
    action === "EDIT" &&
    oldDay === newDay &&
    oldDay !== "hidden" &&
    (!payload.newEndDate || payload.newEndDate === payload.newDate || payload.newEndDate === "미정") &&
    (!payload.oldBlockStart ||
      payload.oldBlockStart === "null" ||
      payload.oldBlockStart === "미정" ||
      payload.oldBlockStart === payload.oldDate);

  if (isSimpleEdit) {
    let targetArr = oldDay === "pending" ? serverData.pendingItems : serverData.monthData[oldDay];
    if (targetArr && idx !== null && targetArr[idx]) {
      targetArr[idx].company = payload.newComp || payload.oldComp;
      // ?? (nullish coalescing) 사용: "0" 같은 falsy 값도 올바르게 반영
      targetArr[idx].pal = payload.newPal ?? payload.oldPal;
      targetArr[idx].box = payload.newBox ?? payload.oldBox;
      targetArr[idx].etc = payload.newEtc;
      if (payload.newShip !== undefined) { // 수정창에서 배송 구분을 보낸 경우에만 반영
        if (_shipKey(payload.newShip)) targetArr[idx].shipType = _shipKey(payload.newShip);
        else delete targetArr[idx].shipType;
      }
      if (_slotOrds) targetArr[idx].ords = _slotOrds;
      // isDone 상태 및 기존 배열의 순서는 완벽히 유지됨
      
    }
  } else {
    // 1. 삭제 및 날짜 이동 시 (기존 지우기 로직)
    const _oldDoneMap = {}; // 블록 각 날짜의 기존 isDone 캡처
    const _oldEtcMap  = {}; // 블록 각 날짜의 기존 etc 캡처 (비고 미변경 시 복원)
    const _oldPalMap  = {}; // 블록 각 날짜의 기존 pal 캡처 (수량 미변경 시 복원)
    const _oldBoxMap  = {}; // 블록 각 날짜의 기존 box 캡처
    let _isTaskBlock = false;
    if (action === "EDIT" || action === "DELETE") {
      if (payload.oldBlockStart && payload.oldBlockStart !== "null" && payload.oldBlockStart !== "미정") {
        let sD = new Date(payload.oldBlockStart).getDate();
        let eD =
          payload.oldBlockEnd && payload.oldBlockEnd !== "null" && payload.oldBlockEnd !== ""
            ? new Date(payload.oldBlockEnd).getDate()
            : sD;
        // TASK 블록: pal/box/isDone 달라도 company명 기준으로 제거
        _isTaskBlock = (payload.oldComp || "").toUpperCase().startsWith("[TASK]") ||
          /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName((payload.oldComp || "").replace(/\[TASK\]/gi, "").trim()));
        const _taskKey = _isTaskBlock ? getMatchKey({ company: payload.oldComp, pal: "", box: "" }) : null;
        for (let d = sD; d <= eD; d++) {
          let targetArr = serverData.monthData[d];
          if (targetArr) {
            let matchIdx = _isTaskBlock
              ? targetArr.findIndex((it) => getMatchKey(it) === _taskKey)
              : targetArr.findIndex(
                  (it) =>
                    it.company === payload.oldComp &&
                    norm(it.pal) === norm(payload.oldPal) &&
                    norm(it.box) === norm(payload.oldBox) &&
                    (it.isDone === true || String(it.isDone) === "true") ===
                      (payload.oldDone === true || String(payload.oldDone) === "true"),
                );
            if (matchIdx !== -1) {
              // 제거 전 isDone/pal/box/etc 캡처 — 추가 단계에서 복원용
              const _captured = targetArr[matchIdx];
              _oldDoneMap[d] = _captured.isDone === true || String(_captured.isDone) === "true";
              _oldEtcMap[d]  = _captured.etc || "";
              _oldPalMap[d]  = _captured.pal || "0";
              _oldBoxMap[d]  = _captured.box || "0";
              targetArr.splice(matchIdx, 1);
            }
          }
        }
      } else {
        let targetArr = oldDay === "pending" ? serverData.pendingItems : serverData.monthData[oldDay];
        if (targetArr && idx !== null && targetArr[idx]) { _removedOrds = targetArr[idx].ords || null; _removedShip = targetArr[idx].shipType || ""; targetArr.splice(idx, 1); }
      }
    }

    // 2. 날짜 이동, 신규 추가일 때 (맨 끝에 붙이기)
    if (action === "ADD" || action === "EDIT") {
      const newItem = {
        company: payload.newComp || payload.oldComp,
        pal: payload.newPal || payload.oldPal,
        box: payload.newBox || payload.oldBox,
        etc: payload.newEtc,
        isDone: action === "EDIT" ? payload.oldDone : false,
        startDate: payload.newDate,
        ...((_slotOrds || _removedOrds) ? { ords: _slotOrds || _removedOrds } : {}),
        // 배송 구분: 새로 등록하면 고른 값, 수정(날짜 이동 등)이면 고른 값 또는 원래 값을 그대로 이어감
        ...(() => { const k = _shipKey(action === "ADD" ? payload.shipType : payload.newShip !== undefined ? payload.newShip : _removedShip); return k ? { shipType: k } : {}; })(),
      };
      let startD = parseDay(payload.newDate);
      let endD =
        payload.newEndDate && payload.newEndDate !== "미정" && payload.newEndDate !== ""
          ? parseDay(payload.newEndDate)
          : startD;

      if (startD === "pending") {
        serverData.pendingItems.push(newItem);
      } else if (startD !== "hidden") {
        let actualEnd = endD === "hidden" || endD === "pending" ? startD : endD;
        for (let d = startD; d <= actualEnd; d++) {
          if (!serverData.monthData[d]) serverData.monthData[d] = [];
          // TASK 블록: 기존 날짜는 캡처된 isDone/pal/box/etc 복원, 새 날짜는 기본값
          const _isExisting = _oldDoneMap.hasOwnProperty(d);
          const _palChanged = norm(payload.newPal) !== norm(payload.oldPal);
          const _boxChanged = norm(payload.newBox) !== norm(payload.oldBox);
          const _etcRaw     = (payload.newEtc||"").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
          const _etcOldRaw  = (payload.oldEtc||"").replace(/\[[\d/]+[^)]*추가\]/g,"").trim();
          const _etcChanged = _etcRaw !== _etcOldRaw;
          serverData.monthData[d].push({
            ...newItem,
            isDone: _isTaskBlock ? (_isExisting ? _oldDoneMap[d] : false) : newItem.isDone,
            pal:    (_isTaskBlock && _isExisting && !_palChanged) ? _oldPalMap[d] : newItem.pal,
            box:    (_isTaskBlock && _isExisting && !_boxChanged) ? _oldBoxMap[d] : newItem.box,
            etc:    (_isTaskBlock && _isExisting && !_etcChanged) ? _oldEtcMap[d] : (newItem.etc || ""),
          });
        }
      }
    }
  }

  // 3. 기타 완료 상태/수량 추가 반영
  if (action === "DONE" || action === "UNDO_DONE" || action === "ADD_QTY") {
    let arr = oldDay === "pending" ? serverData.pendingItems : serverData.monthData[oldDay];
    if (arr && arr[idx]) {
      if (action === "DONE") arr[idx].isDone = true;
      if (action === "UNDO_DONE") arr[idx].isDone = false;
      if (action === "ADD_QTY") {
        arr[idx].pal = (parseInt(arr[idx].pal) || 0) + (parseInt(payload.addPal) || 0);
        arr[idx].box = (parseInt(arr[idx].box) || 0) + (parseInt(payload.addBox) || 0);
        let histDate = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
        let histStr = `[${histDate} ${payload.addPal ? payload.addPal + "P" : ""}${payload.addPal && payload.addBox ? " " : ""}${payload.addBox ? payload.addBox + "B" : ""} 추가]`;
        arr[idx].etc = arr[idx].etc ? arr[idx].etc + " " + histStr : histStr;
      }
    }
  }

  // ... 기존 로직 ...
  lastLocalUpdateTime = Date.now();
  localStorage.setItem(`cal_cache_${currentType}_${serverData.year}_${serverData.month}`, JSON.stringify(serverData));

  // 👇 💡 복잡한 코드 싹 지우고 이 딱 1줄만 넣습니다!
  triggerStealthYearlySync(serverData.year);
} // <-- 함수 끝나는 부분

function updateMultiLocalState(action, items) {
  const norm = (v) => {
    let s = String(v != null ? v : "").trim();
    return s === "0" || s === "" ? "" : s;
  };

  items.forEach((target) => {
    let day = target.dateStr === "미정" ? "pending" : parseInt(target.dateStr.split("-")[2], 10);
    let arr = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
    if (!arr) return;

    let idx = arr.findIndex((i) => {
      return (
        i.company === target.comp &&
        norm(i.pal) === norm(target.pal) &&
        norm(i.box) === norm(target.box) &&
        (i.isDone === true || String(i.isDone) === "true") ===
          (target.isDone === true || String(target.isDone) === "true")
      );
    });

    if (idx !== -1) {
      if (action === "MULTI_DELETE") arr.splice(idx, 1);
      else if (action === "MULTI_DONE") arr[idx].isDone = true;
      else if (action === "MULTI_UNDO_DONE") arr[idx].isDone = false;
    }
  });
  // ... 기존 로직 ...
  lastLocalUpdateTime = Date.now();
  localStorage.setItem(`cal_cache_${currentType}_${serverData.year}_${serverData.month}`, JSON.stringify(serverData));

  // 👇 💡 여기도 똑같이 이 딱 1줄만 넣습니다!
  triggerStealthYearlySync(serverData.year);
} // <-- 함수 끝나는 부분

function attachAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let oldDrop = document.getElementById(inputId + "-drop");
  if (oldDrop) oldDrop.remove();
  const drop = document.createElement("div");
  drop.id = inputId + "-drop";
  drop.className = "custom-dropdown";
  drop.style.display = "none";
  input.parentNode.insertBefore(drop, input.nextSibling);
  const cleanStr = (s) => s.replace(/[\(\)주]/g, "");
  const shortOf = (c) => (compInfoDB[c] && compInfoDB[c].shortName ? String(compInfoDB[c].shortName).trim() : "");
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // 정규식 특수문자 이스케이프
  function renderList(filterText) {
    // CRM(compInfoDB) 업체 목록 (하드코딩 제거 → DB 단일 소스). 정식명 + 약어(shortName) 둘 다 검색
    let combinedComps = Object.keys(compInfoDB);
    let filtered = [...combinedComps];

    if (filterText) {
      filtered = filtered.filter((c) => c.includes(filterText) || shortOf(c).includes(filterText));
      filtered.sort((a, b) => {
        // 정식명 매칭을 약어 매칭보다 우선, 같은 그룹 내에선 매칭 위치 빠른 순
        let ia = a.includes(filterText) ? a.indexOf(filterText) : 1000 + (shortOf(a).indexOf(filterText) + 1 || 999);
        let ib = b.includes(filterText) ? b.indexOf(filterText) : 1000 + (shortOf(b).indexOf(filterText) + 1 || 999);
        if (ia !== ib) return ia - ib;
        return cleanStr(a).localeCompare(cleanStr(b));
      });
    } else {
      filtered.sort((a, b) => cleanStr(a).localeCompare(cleanStr(b)));
    }
    if (filtered.length === 0) {
      drop.style.display = "none";
      return;
    }
    const reF = filterText ? new RegExp(`(${escRe(filterText)})`, "gi") : null;
    const hl = (t) => (reF && t ? t.replace(reF, "<strong style='color:#0a84ff;'>$1</strong>") : t);
    let html = "";
    filtered.forEach((c) => {
      const sn = shortOf(c);
      const snTag = sn ? ` <span style="color:#888; font-size:0.85em;">${hl(sn)}</span>` : "";
      html += `<div class="drop-item" data-val="${_esc(c)}" onmousedown="document.getElementById('${inputId}').value=this.dataset.val; document.getElementById('${inputId}-drop').style.display='none';">${hl(c)}${snTag}</div>`;
    });
    drop.innerHTML = html;
    drop.style.display = "block";
  }
  input.addEventListener("focus", () => renderList(input.value.trim()));
  input.addEventListener("click", () => renderList(input.value.trim()));
  input.addEventListener("input", () => renderList(input.value.trim()));
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (drop) drop.style.display = "none";
    }, 200);
  });
}

// =====================================================
// 🔒 [통합 인증 및 세션 제어 엔진]
// =====================================================

// 🚨 1. 인증 데이터 통합 저장/삭제 헬퍼 (localStorage vs sessionStorage 자동 분배)

// 🚨 2. 자동 로그인 토글 스위치
// (handleAutoLoginToggle → common-ui.js 로 통합됨)

// 🚨 3. 앱 종료 시 자동로그인 OFF 상태면 권한 파기
window.addEventListener("beforeunload", () => {
  if (localStorage.getItem("auto_login") === "false") {
    saveAuthData(null, null, false);
  }
});

// 🚨 4. 앱 실행 시 초기화 로직 (sessionStorage까지 검사하도록 수정 완료)
if (localStorage.getItem("isAdmin") === "true" || sessionStorage.getItem("isAdmin") === "true") {
  window.isAdmin = true;
  isAdmin = true;

  const actions = document.getElementById("adminActions");
  if (actions) actions.style.display = "flex";
  const fab = document.getElementById("fabBtn");
  if (fab) fab.style.display = "flex";

  const btn = document.getElementById("adminBtn");
  if (btn) {
    btn.innerHTML = "🔓 관리자";
    btn.className = "admin-btn unlocked";
    btn.removeAttribute("style");
  }
  if (typeof checkMasterAuthButtonVisibility === "function") checkMasterAuthButtonVisibility();
} else {
  window.isAdmin = false;
  isAdmin = false;
}

// 🚨 5. 수동 로그인 모달창 띄우기

// 🚨 6. 권한에 따른 프로필 모달 및 생체인증 토글 함수

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

// 🚨 8. 로그아웃 (서버에 로그아웃 기록 전송 추가)

let isMultiMode = false;
let selectedItems = [];
function toggleMultiMode() {
  isMultiMode = !isMultiMode;
  selectedItems = [];
  document.querySelectorAll(".item-tag, .pending-item").forEach((el) => el.classList.remove("multi-selected"));
  const btn = document.getElementById("multiBtn");
  const bar = document.getElementById("multiActionBar");
  const fab = document.getElementById("fabBtn");
  const pcBtn = document.getElementById("pcMultiBtn");
  if (isMultiMode) {
    if (btn) { btn.innerText = "❌ 취소"; btn.classList.add("active"); }
    if (pcBtn) { pcBtn.innerText = "❌ 다중선택 취소"; pcBtn.style.color = "#ff3b30"; pcBtn.style.fontWeight = "900"; }
    bar.style.display = "flex";
    document.getElementById("selCount").innerText = "0";
    if (fab) fab.style.display = "none";
  } else {
    if (btn) { btn.innerText = "☑️ 다중 선택"; btn.classList.remove("active"); }
    if (pcBtn) { pcBtn.innerText = "☑️ 다중 선택"; pcBtn.style.color = ""; pcBtn.style.fontWeight = ""; }
    bar.style.display = "none";
    if (isAdmin && fab) fab.style.display = "flex";
  }
  renderCalendar(); // 다중선택 켜고 끌 때 접힌 날짜를 펼치거나 다시 접기
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
  if (isDragging) return; // 🚨 [추가] 중복 터치로 인한 유령 생성 방지
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

    // 🚨 [추가] 드래그 시작 전, 화면 구석에 숨어있을지 모를 모든 유령(Ghost) 삭제
    document.querySelectorAll(".ghost-clone-element").forEach((el) => el.remove());

    if (type === "cell") {
      openAddFormWithDate(day);
    } else if (type === "item") {
      isDragging = true;
      dragData = { day: day, idx: idx };
      let rect = pressTarget.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;

      dragGhost = pressTarget.cloneNode(true);
      dragGhost.classList.add("ghost-clone-element"); // 식별표 부착
      pressTarget.style.opacity = "0.3";

      if (day === "pending") {
        dragGhost.className = "item-tag ghost-clone-element";
        let cleanComp = String(serverData.pendingItems[idx].company || "")
          .replace(/\[TASK\]/gi, "")
          .trim();
        let shortName = getShortName(cleanComp);
        let colorObj = getCompanyColor(cleanComp);
        dragGhost.style.background = colorObj.bg;
        dragGhost.style.color = colorObj.cMain;
        dragGhost.innerHTML = shortName;

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
      dragGhost.style.transform = `translate3d(${clientX - dragOffsetX}px, ${clientY - dragOffsetY}px, 0) scale(1.05)`;
    }
  }, 400);
}

function updateGhostPosition(x, y) {
  if (!dragGhost) return;
  window._dragLX = x;
  window._dragLY = y;

  // 🚨 픽셀 단위 직접 주입으로 입고 달력 먹통 현상 완벽 해결!
  dragGhost.style.left = x - dragOffsetX + "px";
  dragGhost.style.top = y - dragOffsetY + "px";
  dragGhost.style.transform = "scale(1.05)"; // 크기만 살짝 키움

  if (!dragReq) {
    dragReq = requestAnimationFrame(() => {
      let dropElement = document.elementFromPoint(x, y);
      let targetCell = dropElement ? dropElement.closest(".day-cell:not(.empty)") : null;
      _foldDragHover(targetCell); // 접힌 날 위에 머물면 임시 펼침
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
      // (단, 마지막 아이템보다 아래에 있을 땐 sticky 무시하고 맨끝 처리)
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

      // 들어갈 위치(desired) 결정
      let desiredTarget = null,
        desiredPos = null;
      if (targetCell) {
        if (belowAll) {
          // 🟢 마지막 아이템(맨 밑 간트 등)보다 아래에 있으면 무조건 맨 끝에 삽입
          desiredTarget = lastItem;
          desiredPos = "bottom";
        } else if (targetItem) {
          let rect = targetItem.getBoundingClientRect();
          let ratio = (y - rect.top) / rect.height;
          // 중앙 0.4~0.6 구간은 기존 결정 유지(히스테리시스) → 경계 떨림 차단
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

      // 상태가 동일하면 DOM 안 건드림 (깜빡임 차단)
      if (desiredTarget === lastDropTarget && desiredPos === _lastInsertPos) {
        dragReq = null;
        return;
      }

      // 바뀐 경우에만 클리어 후 재적용
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

// 📂 드래그 종료 래퍼: 임시 펼침을 항상 해제(드롭 위치 판정은 펼쳐진 상태 기준으로 먼저 끝난 뒤 접음)
async function endDrag(e) {
  const hadTemp = !!window._foldDrag;
  clearTimeout(_foldDragT);
  _foldDragWant = undefined;
  try {
    return await _endDragCore(e);
  } finally {
    if (hadTemp || window._foldDrag) {
      window._foldDrag = null;
      renderCalendar();
    }
  }
}

async function _endDragCore(e) {
  if (!isDragging) return;
  isDragging = false;
  if (dragReq) {
    cancelAnimationFrame(dragReq);
    dragReq = null;
  }

  let x = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  let y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

  // 🚨 [버그 2 수정] 손을 뗄 때 무조건 모든 유령(Ghost) 요소 완전 파괴!
  document.querySelectorAll(".ghost-clone-element").forEach((el) => el.remove());
  if (dragGhost) {
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
  // (이후 아래 로직은 기존과 동일합니다)

  let dropElement = document.elementFromPoint(x, y);
  let targetCell = dropElement ? dropElement.closest(".day-cell") : null;
  let isOutsideCalendar =
    !dropElement || (!dropElement.closest(".calendar-container") && !dropElement.closest(".overlay-modal"));
  let targetPending = dropElement ? dropElement.closest(".pending-container") : null;

  // 드래그 중 백그라운드 싱크로 serverData 교체 시 크래시 방지
  const _dragDayArr = dragData.day === "pending" ? null : serverData.monthData[dragData.day];
  if (dragData.day !== "pending" && (!_dragDayArr || _dragDayArr[dragData.idx] === undefined)) {
    isDragging = false; dragData = {}; if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    return;
  }
  let item = dragData.day === "pending" ? serverData.pendingItems[dragData.idx] : _dragDayArr[dragData.idx];
  let oldDateStr =
    dragData.day === "pending"
      ? "미정"
      : _ymd(serverData.year, serverData.month, dragData.day);

  if (targetCell && !targetCell.classList.contains("empty")) {
    const _dateNumEl = targetCell.querySelector(".date-num");
    if (!_dateNumEl) return;
    let newDay = parseInt(_dateNumEl.innerText.trim());

    // 💡 [간트 & 하루일정 순서 변경 완벽 작동 로직]
    if (newDay === dragData.day && dragData.day !== "pending") {
      let arr = serverData.monthData[dragData.day];
      let targetIdx;
      if (currentDropTarget && currentDropTarget.classList.contains("item-tag")) {
        targetIdx = parseInt(currentDropTarget.getAttribute("data-raw-idx"));
      } else {
        // 같은 날 빈 공간(맨 아래 간트 밑 등)에 드롭 → 맨 끝으로 이동
        targetIdx = arr.length - 1;
        isTopInsert = false;
      }
      if (!isNaN(targetIdx) && arr) {
        let movedItem = arr[dragData.idx];
        let targetItem = arr[targetIdx];

        // 지문 추출기 (이름과 정규화된 수량)
        const mk = (it) => {
          let p = it.pal === "0" || !it.pal ? "" : String(it.pal).trim();
          let b = it.box === "0" || !it.box ? "" : String(it.box).trim();
          return `${it.company.replace(/\[TASK\]/gi, "").trim()}_${p}_${b}`;
        };
        let movedKey = mk(movedItem);
        let targetKey = mk(targetItem);

        arr.splice(dragData.idx, 1);
        if (targetIdx > dragData.idx) targetIdx--;
        let insertIdx = isTopInsert ? targetIdx : targetIdx + 1;
        arr.splice(insertIdx, 0, movedItem);

        serverData.customOrderFlags = serverData.customOrderFlags || {};
        serverData.customOrderFlags[dragData.day] = true;

        // 🚨 [킬러 로직] 얇은 간트차트의 순서를 바꿨다면, 겹치는 모든 날짜의 배열 순서도 텔레파시로 똑같이 바꿈!
        for (let d = 1; d <= serverData.daysInMonth; d++) {
          if (d === dragData.day || !serverData.monthData[d]) continue;
          let mIdx = serverData.monthData[d].findIndex((x) => mk(x) === movedKey);
          let tIdx = serverData.monthData[d].findIndex((x) => mk(x) === targetKey);

          if (mIdx !== -1 && tIdx !== -1) {
            let mItem = serverData.monthData[d].splice(mIdx, 1)[0];
            tIdx = serverData.monthData[d].findIndex((x) => mk(x) === targetKey);
            let iIdx = isTopInsert ? tIdx : tIdx + 1;
            serverData.monthData[d].splice(iIdx, 0, mItem);
          }
        }

        localStorage.setItem(
          `cal_cache_${currentType}_${serverData.year}_${serverData.month}`,
          JSON.stringify(serverData),
        );
        renderCalendar();

        // 🚀 [추가됨] 폰에서 순서를 바꾼 즉시! 서버(DB)로 새로운 순서표를 배열 형태로 전송!
        let orderPayload = { dailyOrders: {} };
        let dStr =
          dragData.day === "pending"
            ? "미정"
            : _ymd(serverData.year, serverData.month, dragData.day);
        orderPayload.dailyOrders[dStr] = [];

        let targetArr = dragData.day === "pending" ? serverData.pendingItems : serverData.monthData[dragData.day];

        targetArr.forEach((it, i) => {
          it.sortIdx = i; // 🚨 [핵심 패치 1] 내 폰 로컬 순서 즉시 갱신

          // 이름이나 수량이 겹쳐도 절대 헷갈리지 않게 고유 id를 담아서 배열로 보냅니다!
          orderPayload.dailyOrders[dStr].push({
            id: it.id || null,
            company: it.company,
            pal: it.pal === "0" || !it.pal ? "" : String(it.pal).trim(),
            box: it.box === "0" || !it.box ? "" : String(it.box).trim(),
            sortIdx: i,
          });
        });

        // 🚨 [핵심 패치 2] 순서표를 각인시킨 직후 로컬 캐시에 즉시 저장! (새로고침 대비)
        localStorage.setItem(
          `cal_cache_${currentType}_${serverData.year}_${serverData.month}`,
          JSON.stringify(serverData),
        );

        apiCall({
          source: "vercel",
          domain: "out",
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
  // ❌ 지워버림: if(isProcessing) return; isProcessing = true;

  // 💡 [핵심 버그 수정] 수량이 0일 때 빈칸("")으로 변환되어 서버 매칭이 실패하는 JS 버그 완벽 방어
  const safeStr = (val) => (val === "" || val == null ? "" : String(val).trim());
  let currentIsDone = item.isDone === true || String(item.isDone).toLowerCase() === "true";

  let payload = {
    action: "EDIT",
    id: item.id || null, // 🚨 id 우선 매칭 (같은 날 동일 업체·수량 2건 오이동 방지)
    oldComp: item.company,
    oldDate: oldDateStr,
    oldDone: currentIsDone,
    oldPal: safeStr(item.pal), // 수정됨!
    oldBox: safeStr(item.box), // 수정됨!
    newComp: item.company,
    newDate: newDateStr,
    newPal: safeStr(item.pal), // 수정됨!
    newBox: safeStr(item.box), // 수정됨!
    newEtc: item.etc,
  };

  updateLocalState("EDIT", payload, idx);
  renderCalendar();
  // 💡 토스트 메시지도 거슬리지 않게 삭제하거나 짧게 둡니다.

  apiCall({
    source: "vercel",
    domain: "out",
    action: "EDIT",
    data: payload,
    token: adminToken,
    admin_id: localStorage.getItem("admin_id"),
  }).then((res) => {
    if (res === null) {
      setTimeout(() => goToAsync(serverData.year, serverData.month), 2500);
      return;
    }
    if (!res.success) {
      showToast("❌ 이동 실패! 원본 데이터와 불일치합니다. 복구합니다.", 2500);
      setTimeout(() => goToAsync(serverData.year, serverData.month), 2500);
    }
  });
}

function handleItemClick(e, day, idx, comp, isDone) {
  if (isMultiMode) {
    const el = e.currentTarget;
    let dateStr =
      day === "pending"
        ? "미정"
        : _ymd(serverData.year, serverData.month, day);
    let isItemDone = isDone === true || String(isDone) === "true";
    let itemKey = `${comp}_${dateStr}_${isItemDone}_${idx}`;
    let item = day === "pending" ? serverData.pendingItems[idx] : serverData.monthData[day][idx];
    const safeStr = (val) => (val === "" || val == null ? "" : String(val).trim());
    let existingIdx = selectedItems.findIndex((i) => i.key === itemKey);
    if (existingIdx > -1) {
      selectedItems.splice(existingIdx, 1);
      el.classList.remove("multi-selected");
    } else {
      selectedItems.push({
        key: itemKey,
        id: item?.id || null,
        comp: comp,
        dateStr: dateStr,
        isDone: isItemDone,
        pal: safeStr(item.pal),
        box: safeStr(item.box),
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

function openAddFormWithDate(day) {
  openAddForm();
  // 길게 눌러 모달이 뜬 직후 손가락 밑 글자가 선택되는 것 방지 (CSS user-select + 혹시 선택됐다면 즉시 해제)
  const _clearSel = () => {
    try {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e) {}
  };
  _clearSel();
  setTimeout(_clearSel, 350);
  let dateStr = _ymd(serverData.year, serverData.month, day);

  document.getElementById("add-date").value = dateStr;

  // 🍎 iOS 네이티브 date 피커는 '나중에 JS로 바꾼 min'을 회색처리에 반영 안 함(생성 시점 min만 읽음).
  //    → min을 박은 '새 노드로 교체'해서 iOS가 시작일 이전을 회색 비활성화하도록 강제.
  let endOld = document.getElementById("add-end-date");
  let endNew = endOld.cloneNode(true);
  endNew.value = "";
  endNew.setAttribute("min", dateStr);
  endNew.min = dateStr;
  endOld.parentNode.replaceChild(endNew, endOld);

  endNew.onfocus = function () {
    if (!this.value && this.min) this.value = this.min;
  };
  // 🚨 [아이폰 철통 방어벽] 그래도 이전 날짜를 골랐을 때 강제 복구!
  endNew.onchange = function () {
    if (this.value && this.min && this.value < this.min) {
      showToast("⚠️ 종료일은 시작일보다 빠를 수 없습니다.", 2000);
      this.value = this.min;
    }
  };

  setTimeout(() => document.getElementById("add-comp").focus(), 200);
}

// 수량 음수 방지: 빈값은 유지, 숫자는 0 이상으로 클램프
function clampQty(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? "" : String(Math.max(0, n));
}
// 화면에 이미 불러온 달력에서 '같은 날·같은 업체의 완료 전 일정' 찾기 (다른 달이라 모르면 null → 서버가 한 번 더 막아 줌)
function _addLiveSame(comp, dateStr) {
  const norm = (x) => String(x == null ? "" : x).trim();
  let arr;
  if (!dateStr || dateStr === "미정") arr = serverData.pendingItems;
  else {
    const p = String(dateStr).split("-").map((n) => parseInt(n, 10));
    if (p.length < 3 || p[0] !== serverData.year || p[1] !== serverData.month) return null;
    arr = serverData.monthData[p[2]];
  }
  return (arr || []).filter((it) => norm(it.company) === norm(comp) && !(it.isDone === true || String(it.isDone) === "true"));
}

// 수정 저장이 'EDIT_BLOCK'(같은 업체·같은 날짜 전부를 한꺼번에 고치는 방식)을 타야 하는 경우인지.
//  기간이 있는 작업(TASK)만 해당. 일반 출고 일정은 같은 날 같은 업체가 여러 건일 수 있어(따로 추가·피킹지 등록) 반드시 그 일정의 id 로만 수정한다.
function _editNeedsBlockPath(oldComp, oldBlockStart, oldBlockEnd, isTaskNow, itemId) {
  if (!oldBlockStart || oldBlockStart === "null" || oldBlockStart === "미정") return false;
  if (!itemId) return true; // id 를 모르면 예전 방식 유지
  const nm = String(oldComp || "");
  const wasTask = /^\[TASK\]/i.test(nm) || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(nm.replace(/\[TASK\]/gi, "").trim()));
  const ranged = !!(oldBlockEnd && oldBlockEnd !== "null" && oldBlockEnd !== oldBlockStart);
  return !!(isTaskNow || wasTask || ranged);
}

async function submitCMS(
  action,
  oldComp = null,
  oldDate = null,
  idx = null,
  isDone = false,
  oldBlockStart = null,
  oldBlockEnd = null,
) {
  if (action === "EDIT" || action === "DELETE") _editState = null; // 수정 세션 종료
  try {
    if (action === "ADD") {
      let addInput = document.getElementById("add-comp");
      if (addInput && addInput.value) addInput.value = getFullName(addInput.value);
    } else if (action === "EDIT" && idx !== null) {
      let editInput = document.getElementById(`edit-comp-${idx}`);
      if (editInput && editInput.value) editInput.value = getFullName(editInput.value);
    }
  } catch (e) {
    console.log("이름 변환 오류", e);
  }

  let oldPal = "",
    oldBox = "";
  const safeStr = (val) => (val === "" || val == null ? "" : String(val).trim());
  let currentIsDone = isDone === true || String(isDone) === "true";

  let _itemId = null;
  let _itemOrds = []; // 이 일정에 붙어 있던 출고지시번호(수정창에서 바뀌었는지 비교용)
  let _itemOrigEtc = ""; // 원본 비고 — EDIT_BLOCK 변경 전 값 비교용
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
      oldBox = safeStr(item.box);
      currentIsDone = item.isDone === true || String(item.isDone) === "true";
      _itemId = item.id || null;
      _itemOrds = Array.isArray(item.ords) ? item.ords : [];
      _itemOrigEtc = String(item.etc || "").replace(/\[[\d/]+[^)]*추가\]/g, "").trim();
    }
  }

  let payload = {
    action: action,
    id: _itemId,
    oldComp: oldComp,
    oldDate: oldDate,
    oldDone: currentIsDone,
    oldPal: oldPal !== "" ? oldPal : "0", // "" → "0" 으로 정규화 (DB INSERT 시 0 저장)
    oldBox: oldBox !== "" ? oldBox : "0",
  };

  let confirmName = oldComp ? getFullName(oldComp.replace(/\[TASK\]/gi, "").trim()) : "";
  if (action === "DONE") {
    if (!(await uiConfirm(`✅ [${confirmName}] 일정을 완료 처리하시겠습니까?`))) return;
  } else if (action === "UNDO_DONE") {
    if (!(await uiConfirm(`⏪ [${confirmName}] 일정의 완료 상태를 취소하시겠습니까?`))) return;
  }

  let isTask = false;
  let rawComp = "";
  let startDateStr = "";
  let endDateStr = "";

  if (action === "ADD") {
    isTask = document.getElementById("type-task-add").checked;
    rawComp = document.getElementById("add-comp").value.trim();
    let finalComp = getFullName(rawComp);
    payload.newComp = isTask ? `[TASK]${finalComp}` : finalComp;
    payload.newPal = clampQty(document.getElementById("add-pal").value);
    payload.newBox = clampQty(document.getElementById("add-box").value);
    startDateStr = document.getElementById("add-date").value || "미정";
    let endNode = document.getElementById("add-end-date");
    endDateStr = endNode ? endNode.value : "";
    payload.newDate = startDateStr;
    payload.newEtc = document.getElementById("add-etc").value;
    if (!isTask) { const _sa = document.getElementById("add-ship"); if (_sa && _sa.value) payload.shipType = _sa.value; } // 배송 구분(기본 용차는 보내지 않음)
    { const _oe = document.getElementById("add-orders"); if (_oe && _oe.value.trim() && !isTask) { payload.orderNos = _oe.value.trim(); if (_ordHasIgnored(_oe.value)) showToast("ℹ️ 영문·숫자 6자 미만 번호는 저장되지 않습니다.", 3500); } } // 출고지시번호(선택)
  } else if (action === "EDIT") {
    isTask = document.getElementById(`edit-type-task-${idx}`).checked;
    rawComp = document.getElementById(`edit-comp-${idx}`).value.trim();
    let finalComp = getFullName(rawComp);
    payload.newComp = isTask ? `[TASK]${finalComp}` : finalComp;
    payload.newPal = clampQty(document.getElementById(`edit-pal-${idx}`).value);
    payload.newBox = clampQty(document.getElementById(`edit-box-${idx}`).value);
    payload.newDate = document.getElementById(`edit-date-${idx}`).value || "미정";
    let endNode = document.getElementById(`edit-${idx}-end-date`);
    endDateStr = endNode ? endNode.value : "";
    startDateStr = payload.newDate;

    // 🚨 [패치 4] 생존한 수량 이력 리스트를 다시 텍스트 규격으로 포장
    let cleanEtc = document.getElementById(`edit-etc-${idx}`)
      ? document.getElementById(`edit-etc-${idx}`).value.trim()
      : "";
    let histRows = document.querySelectorAll(`.hist-edit-row-${idx}`);
    let histArr = [];
    histRows.forEach((row) => {
      const dateText = row.querySelector(`.hist-date-${idx}`).innerText.trim();
      const pVal = Math.max(0, parseInt(row.querySelector(`.hist-pal-${idx}`).value) || 0);
      const bVal = Math.max(0, parseInt(row.querySelector(`.hist-box-${idx}`).value) || 0);
      if (pVal > 0 || bVal > 0) {
        let pStr = pVal > 0 ? `${pVal}P` : "";
        let bStr = bVal > 0 ? `${bVal}B` : "";
        let space = pVal > 0 && bVal > 0 ? " " : "";
        histArr.push(`[${dateText} ${pStr}${space}${bStr} 추가]`);
      }
    });
    let histStr = histArr.join(" ");
    payload.newEtc = histStr !== "" ? (cleanEtc !== "" ? cleanEtc + " " + histStr : histStr) : cleanEtc;
    payload.oldEtc = _itemOrigEtc; // 비고 변경 전 값 — EDIT_BLOCK 로그에서 변경 내용 표시용
    if (!isTask) { const _se = document.getElementById(`edit-ship-${idx}`); if (_se) payload.newShip = _se.value; } // 배송 구분(용차/용마/CJ)
    if (!isTask) {
      const _os = _ordCollectSlots(idx, _itemOrds);
      if (_os) payload.orderSlots = _os; // 출고지시번호를 바꾼 경우에만 전송
      const _ordInputs = Array.from(document.querySelectorAll(`#edit-ord-0-${idx}, #edit-ord-x-${idx}, .hist-ord-${idx}`));
      if (_ordInputs.some((e) => _ordHasIgnored(e.value))) showToast("ℹ️ 영문·숫자 6자 미만 번호는 저장되지 않습니다.", 3500);
    }

    if (tempEditColorObj && tempEditColorIdx !== null && !isTask) {
      let stdName = getFullName(rawComp);
      companyColors[stdName] = tempEditColorObj;
      customColors[stdName] = tempEditColorIdx;
      payload.colorNote = stdName; // 서버가 이 수정 알림 1건에 "색상 변경"을 함께 표기
      localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
      apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", compName: stdName, colorIdx: tempEditColorIdx });
      tempEditColorObj = null;
      tempEditColorIdx = null;
    }

    // 🚨 [여기가 누락되었던 핵심 블록입니다] 수량 추가 시 값을 싣고, 화면(로컬)에도 즉시 반영!
  } else if (action === "ADD_QTY") {
    payload.addPal = clampQty(document.getElementById(`add-q-pal-${idx}`).value);
    payload.addBox = clampQty(document.getElementById(`add-q-box-${idx}`).value);
    { const _oe = document.getElementById(`add-q-ord-${idx}`); if (_oe && _oe.value.trim()) { payload.orderNos = _oe.value.trim(); if (_ordHasIgnored(_oe.value)) showToast("ℹ️ 영문·숫자 6자 미만 번호는 저장되지 않습니다.", 3500); } } // 출고지시번호(선택)

    if (!payload.addPal && !payload.addBox) {
      showToast("⚠️ 추가할 파레트나 박스 수량을 입력해주세요.", 2000);
      return;
    }

    // 화면(서버 안 거치고 달력에 즉시 렌더링) 강제 주입
    if (idx !== null) {
      let day = oldDate === "미정" ? "pending" : parseInt(oldDate.split("-")[2], 10);
      let item = day === "pending" ? serverData.pendingItems[idx] : serverData.monthData[day][idx];
      if (item) {
        item.pal = (parseInt(item.pal) || 0) + (parseInt(payload.addPal) || 0);
        item.box = (parseInt(item.box) || 0) + (parseInt(payload.addBox) || 0);
        let histDate = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
        let pStr = payload.addPal ? `${payload.addPal}P` : "";
        let bStr = payload.addBox ? `${payload.addBox}B` : "";
        let spc = payload.addPal && payload.addBox ? " " : "";
        let histStr = `[${histDate} ${pStr}${spc}${bStr} 추가]`;
        item.etc = item.etc ? item.etc + " " + histStr : histStr;
        // 이번 수량추가에 적은 출고지시번호는 'N차 수량추가'(N = 지금까지 쌓인 추가 이력 수)로 바로 화면에 반영
        const _addNos = _ordNorm(payload.orderNos || "");
        if (_addNos.length) {
          const _hn = (String(item.etc).match(/\[\d{1,2}\/\d{1,2}\s*(?:\d+P)?\s*(?:\d+B)?\s*추가\]/g) || []).length || 1;
          item.ords = (Array.isArray(item.ords) ? item.ords : []).concat(_addNos.filter((no) => !(item.ords || []).some((o) => o.no === no)).map((no) => ({ no, slot: _hn })));
        }
      }
    }
  }

  if (action === "ADD" && payload.orderNos && startDateStr !== "미정" && endDateStr && endDateStr > startDateStr) {
    delete payload.shipType; // 기간 등록은 배송 구분을 저장하지 않음(작업·기간 일정용)
    delete payload.orderNos; // 여러 날에 걸친 등록은 날마다 일정이 따로 생겨 번호를 어디에 붙일지 모호함 → 등록 후 각 일정 상세에서 입력
    showToast("ℹ️ 기간 등록은 출고지시번호를 저장하지 않습니다. 등록 후 일정에서 입력해 주세요.", 3500);
  }
  if ((action === "ADD" || action === "EDIT") && (!payload.newComp || payload.newComp === "[TASK]")) {
    showToast("⚠️ 업체/작업명은 필수입니다.", 2000);
    return;
  }
  if (action === "DELETE" && !(await uiConfirm(`⚠️ 정말 [${confirmName}] 일정을 영구 삭제하시겠습니까?`, { danger: true })))
    return;

  if (action === "ADD" || action === "EDIT") {
    if (startDateStr !== "미정" && endDateStr && endDateStr < startDateStr) {
      showToast("⚠️ 종료일은 시작일보다 빠를 수 없습니다.", 2000);
      return;
    }
  }

  // 🛡️ 같은 날 같은 업체 일정이 이미 있으면 덮어쓰지 않고 먼저 묻는다
  if (action === "ADD") {
    const isRangeAdd = startDateStr !== "미정" && endDateStr && endDateStr >= startDateStr;
    if (isRangeAdd) {
      const dupDays = [];
      const sd = new Date(startDateStr + "T00:00:00");
      const ed = new Date(endDateStr + "T00:00:00");
      for (let t = new Date(sd), n = 0; t <= ed && n < 62; t.setDate(t.getDate() + 1), n++) {
        const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
        const same = _addLiveSame(payload.newComp, ds);
        if (same && same.length) dupDays.push(ds.slice(5).replace("-", "/"));
      }
      if (dupDays.length) {
        const ok = await uiConfirm(`선택한 기간 중 같은 업체 일정이 이미 있는 날(${dupDays.slice(0, 3).join(", ")}${dupDays.length > 3 ? " 외" : ""})이 있습니다.\n기존 일정은 그대로 두고 별도 일정으로 추가할까요?`, { okText: "따로 추가", cancelText: "취소" });
        if (!ok) return;
        payload.onDup = "new";
      }
    } else {
      const same = _addLiveSame(payload.newComp, startDateStr);
      if (same && same.length) {
        const first = same[0];
        const addP = parseInt(payload.newPal, 10) || 0;
        const addB = parseInt(payload.newBox, 10) || 0;
        const canAppend = !isTask && first.id && (addP > 0 || addB > 0);
        let chosen = null;
        if (canAppend) {
          const moreNote = same.length > 1 ? `\n(같은 업체 일정이 ${same.length}건 — 첫 번째에 더합니다)` : "";
          const doAppend = await uiConfirm(
            `같은 날 같은 업체 일정이 이미 있습니다.\n현재 PLT ${first.pal || 0} / 박스 ${first.box || 0}${moreNote}\n\n입력한 수량(PLT ${addP} / 박스 ${addB})을 기존 일정에 더할까요?`,
            { okText: "수량 더하기", cancelText: "다른 선택" },
          );
          if (doAppend) { payload.onDup = "append"; payload.dupTargetId = first.id; chosen = "append"; }
        }
        if (!chosen) {
          const doNew = await uiConfirm(
            canAppend ? "기존 일정은 그대로 두고 별도 일정으로 따로 추가할까요?" : `같은 날 같은 ${isTask ? "작업" : "업체"} 일정이 이미 있습니다.\n기존 일정은 그대로 두고 별도 일정으로 추가할까요?`,
            { okText: "따로 추가", cancelText: "취소" },
          );
          if (!doNew) return;
          payload.onDup = "new";
        }
      }
    }
  }

  document.getElementById("modal").style.display = "none";
  document.getElementById("addModal").style.display = "none";

  setTimeout(() => {
    if (action === "ADD" && startDateStr !== "미정" && endDateStr && endDateStr >= startDateStr) {
      updateLocalState("ADD", { ...payload, newDate: startDateStr, newEndDate: endDateStr }, null);
      renderCalendar();
      // 단일 ADD_BLOCK 호출 — 서버에서 날짜 루프 + 로그/알림 1회
      apiCall({
        source: "vercel", domain: "out", action: "ADD_BLOCK",
        data: { ...payload, blockStart: startDateStr, blockEnd: endDateStr },
        token: adminToken, admin_id: localStorage.getItem("admin_id"),
      }).then((res) => {
        if (res === null || !res.success) {
          showToast(res && res.dup ? "⚠️ " + res.msg : "❌ 서버 실패! 복구합니다.", 4000);
          goToAsync(serverData.year, serverData.month);
        }
      });
      return;
    }

    if (action === "EDIT" && _editNeedsBlockPath(oldComp, oldBlockStart, oldBlockEnd, isTask, _itemId)) {
      const optimisticPayload = {
        ...payload,
        newEndDate: endDateStr,
        oldBlockStart: oldBlockStart,
        oldBlockEnd: oldBlockEnd,
      };
      updateLocalState("EDIT", optimisticPayload, idx);
      renderCalendar();
      // 단일 EDIT_BLOCK 호출 — 서버에서 날짜 이동/추가/삭제 + 로그/알림 1회
      apiCall({
        source: "vercel", domain: "out", action: "EDIT_BLOCK",
        data: {
          ...payload,
          oldBlockStart, oldBlockEnd,
          newBlockStart: startDateStr, newBlockEnd: endDateStr || startDateStr,
        },
        token: adminToken, admin_id: localStorage.getItem("admin_id"),
      }).then((res) => {
        if (res === null && !window._recoverScheduled) {
          window._recoverScheduled = true;
          setTimeout(() => (window._recoverScheduled = false), 1500);
          goToAsync(serverData.year, serverData.month);
        }
      });
      if (action === "EDIT") _reopenDetailAfter(payload.newDate);
      return;
    }

    if (action !== "ADD_QTY" && payload.onDup !== "append") updateLocalState(action, payload, idx);
    renderCalendar();

    apiCall({
      source: "vercel",
      domain: "out",
      action: action,
      data: payload,
      token: adminToken,
      admin_id: localStorage.getItem("admin_id"),
    }).then(function (res) {
      if (res === null || !res.success) {
        // 같은 업체 일정이 그 사이 생긴 경우(다른 기기 등)도 서버가 덮어쓰지 않고 알려줌
        showToast(res && res.dup ? "⚠️ " + res.msg + " 다시 추가해주세요." : "❌ 서버 실패! 복구합니다.", res && res.dup ? 4500 : 2500);
        goToAsync(serverData.year, serverData.month);
      } else if (payload.onDup === "append") {
        showToast("✅ 기존 일정에 수량을 더했습니다.", 2500);
        goToAsync(serverData.year, serverData.month); // 합산 결과를 서버 값으로 다시 표시
      }
    });
    // 💡 수정/수량추가 후엔 모달을 닫지 않고 상세보기로 복귀
    if (action === "EDIT" || action === "ADD_QTY") _reopenDetailAfter(payload.newDate || oldDate);
  }, 50);
}

// 간트(여러날 이어진) 스케줄 전체 삭제 — 블록의 모든 날짜 DB행을 한 번에 삭제
async function submitDeleteBlock(comp, dateStr, idx, isDone, blockStart, blockEnd) {
  const confirmName = comp ? getFullName(comp.replace(/\[TASK\]/gi, "").trim()) : "";
  if (
    !(await uiConfirm(
      `⚠️ [${confirmName}] 이어진 전체 스케줄을 한 번에 삭제합니다.\n(${blockStart} ~ ${blockEnd})\n정말 모두 삭제하시겠습니까?`,
      { danger: true },
    ))
  )
    return;

  document.getElementById("modal").style.display = "none";
  document.getElementById("addModal").style.display = "none";

  setTimeout(() => {
    // 로컬에서 회사명 기준으로 블록 날짜 항목 모두 제거 (수량 달라도 같은 작업이면 제거)
    const compKey = `T_${getFullName(comp.replace(/\[TASK\]/gi, "").trim())}`;
    let dates = [];
    let cur = new Date(blockStart);
    const endD = new Date(blockEnd);
    let guard = 0;
    while (cur <= endD && guard++ < 400) {
      const dStr = _dateToYmd(cur);
      dates.push(dStr);
      const dd = parseInt(dStr.split("-")[2], 10);
      const arr = serverData.monthData[dd];
      if (arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (getMatchKey(arr[i]) === compKey) arr.splice(i, 1);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    renderCalendar();

    // 단일 DELETE_BLOCK 호출 → 로그·알림 1건
    apiCall({
      source: "vercel", domain: "out", action: "DELETE_BLOCK",
      data: { oldComp: comp, blockStart, blockEnd },
      token: adminToken, admin_id: localStorage.getItem("admin_id"),
    }).then((res) => {
      if ((res === null || !res.success) && !window._recoverScheduled) {
        window._recoverScheduled = true;
        setTimeout(() => (window._recoverScheduled = false), 1500);
        goToAsync(serverData.year, serverData.month);
      }
    });
  }, 50);
}

async function executeMultiAction(action) {
  // ❌ [삭제됨] if(isProcessing) { showToast('⏳ 처리 중입니다.', 1000); return; }

  if (selectedItems.length === 0) {
    showToast("항목을 먼저 터치하여 선택해 주세요.", 2000);
    return;
  }
  let actionName = action === "MULTI_DONE" ? "완료 처리" : action === "MULTI_UNDO_DONE" ? "완료 취소" : "영구 삭제";
  if (!(await uiConfirm(`⚠️ 선택된 ${selectedItems.length}개의 일정을 일괄 [${actionName}] 하시겠습니까?`))) return;

  // ❌ [삭제됨] isProcessing = true;
  let itemsToProcess = [...selectedItems];

  // 💡 화면부터 즉시 0초 만에 반영하고, 멀티 모드 종료!
  updateMultiLocalState(action, itemsToProcess);
  toggleMultiMode();
  renderCalendar();

  apiCall({
    source: "vercel",
    domain: "out",
    action: action,
    data: { items: itemsToProcess },
    token: adminToken,
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null || !res.success) {
      showToast("❌ 일괄 작업 실패! 데이터를 복구합니다.", 2500);
      goToAsync(serverData.year, serverData.month);
    }
  });
}

// 등록창의 '배송 구분' 칸은 index.html 을 건드리지 않고 여기서 한 번 끼워 넣는다
function _shipEnsureAddField() {
  let sel = document.getElementById("add-ship");
  if (!sel) {
    const anchor = document.getElementById("add-orders");
    const lab = anchor && anchor.previousElementSibling;
    if (!lab) return;
    const wrap = document.createElement("div");
    wrap.id = "add-ship-wrap";
    wrap.innerHTML = `<div class="form-label">배송 구분</div>${_shipSelectHtml("add-ship", "")}`;
    lab.parentNode.insertBefore(wrap, lab);
    sel = document.getElementById("add-ship");
  }
  if (sel) sel.value = ""; // 기본은 용차
}
function openAddForm() {
  if (isMultiMode) toggleMultiMode();
  _shipEnsureAddField();
  document.getElementById("type-out-add").checked = true;
  toggleEndDate("add", false);
  document.getElementById("add-comp").value = "";
  document.getElementById("add-pal").value = "";
  document.getElementById("add-box").value = "";
  document.getElementById("add-date").value = "";
  let endNode = document.getElementById("add-end-date");
  if (endNode) endNode.value = "";
  document.getElementById("add-etc").value = "";
  { const _ao = document.getElementById("add-orders"); if (_ao) _ao.value = ""; }
  attachAutocomplete("add-comp");
  document.getElementById("addModal").style.display = "flex";
}

// ───────── 출고지시번호: 일정 상세 표시 · 바코드 · 직접 입력 ─────────
// Code128(B) 바코드를 외부 라이브러리 없이 직접 그린다 (오프라인에서도 동작). 번호는 영문 대문자·숫자라 B 세트로 충분.
const _C128 = ["11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100","11001001000","11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110","11001110010","11001011100","11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110","11101100100","11100110100","11100110010","11011011000","11011000110","11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000","11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110","11101110110","11010001110","11000101110","11011101000","11011100010","11011101110","11101011000","11101000110","11100010110","11101101000","11101100010","11100011010","11101111010","11001000010","11110001010","10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000","10110000100","10011010000","10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010","10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110","11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010","10111011110","10111101110","11101011110","11110101110","11010000100","11010010000","11010011100"];
function _c128Bits(text) {
  const t = String(text || "");
  if (!t || /[^\x20-\x7e]/.test(t)) return null;
  let sum = 104; // Start B
  const seq = [104];
  for (let i = 0; i < t.length; i++) {
    const v = t.charCodeAt(i) - 32;
    seq.push(v);
    sum += v * (i + 1);
  }
  seq.push(sum % 103);
  let bits = seq.map((v) => _C128[v]).join("");
  bits += "1100011101011"; // Stop(11000111010) + 끝 막대(11)
  return bits;
}
function _c128Svg(text, heightPx) {
  const bits = _c128Bits(text);
  if (!bits) return "";
  const Q = 10; // 양쪽 여백(모듈 수) — 스캐너가 읽으려면 필수
  const W = bits.length + Q * 2;
  let rects = "";
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === "1") {
      let j = i;
      while (j < bits.length && bits[j] === "1") j++;
      rects += `<rect x="${i + Q}" y="0" width="${j - i}" height="100"/>`;
      i = j;
    } else i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 100" preserveAspectRatio="none" style="width:100%;height:${heightPx || 110}px;display:block;background:#fff" shape-rendering="crispEdges" fill="#000" role="img" aria-label="바코드 ${_esc(text)}">${rects}</svg>`;
}
function _ordInjectCss() {
  if (document.getElementById("ordCss")) return;
  const st = document.createElement("style");
  st.id = "ordCss";
  st.textContent = `
    .ord-ico{display:inline-flex;flex-direction:row;flex:0 0 auto;white-space:nowrap;width:auto;height:auto;align-items:center;gap:4px;margin-left:8px;background:transparent;border:1px solid rgba(128,128,128,.55);color:var(--text-sub,#888);border-radius:6px;padding:2px 7px;font-size:.78em;font-weight:800;cursor:pointer;line-height:1.3}
    .ord-ico svg{width:15px;height:13px;display:block}
    #ordOverlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;box-sizing:border-box;animation:ordFade .2s;overscroll-behavior:contain;touch-action:pan-y}
    @keyframes ordFade{from{opacity:0}to{opacity:1}}
    @keyframes ordUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    #ordOverlay .ord-card{background:var(--bg-color,#f4f6f9);color:var(--text-main,#222);border-radius:24px 24px 0 0;padding:8px 16px calc(18px + env(safe-area-inset-bottom));width:100%;max-width:500px;box-sizing:border-box;max-height:85vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;box-shadow:0 -10px 40px rgba(0,0,0,.2);animation:ordUp .35s cubic-bezier(.175,.885,.32,1)}
    @media (min-width:700px){#ordOverlay{align-items:center;padding:24px}#ordOverlay .ord-card{border-radius:22px;padding-bottom:18px}}
    #ordOverlay .ord-gz{padding:8px 0 12px;margin:-4px 0 0;touch-action:none;cursor:grab;-webkit-tap-highlight-color:transparent}
    #ordOverlay .ord-grab{width:42px;height:5px;border-radius:3px;background:var(--text-sub,#a0a0a0);opacity:.55;margin:0 auto}
    #ordOverlay .ord-head{touch-action:none;cursor:grab}
    #ordOverlay .ord-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}
    #ordOverlay .ord-head .tx{flex:1;min-width:0}
    #ordOverlay .ord-eyebrow{display:flex;align-items:center;gap:6px;font-size:.74em;font-weight:900;letter-spacing:.6px;color:#0a84ff}
    #ordOverlay .ord-eyebrow svg{width:16px;height:13px}
    #ordOverlay .ord-title{font-weight:900;font-size:1.2em;line-height:1.25;margin-top:3px;word-break:keep-all;overflow-wrap:anywhere}
    #ordOverlay .ord-sub{font-size:.78em;color:var(--text-sub,#777);margin-top:3px}
    #ordOverlay .ord-x{flex:0 0 auto;width:32px;height:32px;border-radius:50%;border:none;background:var(--card-bg,#fff);color:var(--text-sub,#777);font-size:1.05em;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    #ordOverlay .ord-sec{margin:14px 2px 6px;display:flex;align-items:center;gap:7px;font-size:.78em;font-weight:900;color:var(--text-sub,#777)}
    #ordOverlay .ord-sec .dot{width:8px;height:8px;border-radius:50%;background:#8e8e93}
    #ordOverlay .ord-sec.add .dot{background:#0a84ff}
    #ordOverlay .ord-sec .n{margin-left:auto;font-weight:800;background:var(--card-bg,#fff);border:1px solid var(--border-color,#e5e5e5);border-radius:10px;padding:1px 8px;font-size:.95em}
    #ordOverlay .ord-grp{border-radius:14px;overflow:hidden;background:var(--card-bg,#fff);border:1px solid var(--border-color,#e5e5e5);box-shadow:0 1px 3px rgba(0,0,0,.06)}
    #ordOverlay .ord-row{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;padding:14px 14px;background:transparent;border:none;border-top:1px solid var(--border-color,#e5e5e5);color:var(--text-main,#222);font-size:1.02em;font-weight:900;letter-spacing:.4px;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;font-variant-numeric:tabular-nums}
    #ordOverlay .ord-grp > .ord-row:first-child{border-top:none}
    #ordOverlay .ord-row .bi{flex:0 0 auto;width:30px;height:30px;border-radius:9px;background:rgba(10,132,255,.12);color:#0a84ff;display:flex;align-items:center;justify-content:center}
    #ordOverlay .ord-row .bi svg{width:16px;height:13px}
    #ordOverlay .ord-row .no{flex:1;min-width:0;word-break:break-all}
    #ordOverlay .ord-row .chev{flex:0 0 auto;font-size:.7em;color:var(--text-sub,#8e8e93);transition:transform .2s}
    #ordOverlay .ord-row.on{background:rgba(10,132,255,.09)}
    #ordOverlay .ord-row.on .bi{background:#0a84ff;color:#fff}
    #ordOverlay .ord-row.on .chev{transform:rotate(180deg);color:#0a84ff}
    #ordOverlay .ord-pan{max-height:0;overflow:hidden;transition:max-height .25s ease}
    #ordOverlay .ord-pan-in{padding:4px 14px 14px;background:rgba(10,132,255,.09)}
    #ordOverlay .ord-tile{background:#fff;border-radius:12px;padding:12px 10px 8px;box-shadow:0 1px 4px rgba(0,0,0,.14);border:1px solid rgba(0,0,0,.06)}
    #ordOverlay .ord-bcno{text-align:center;font-weight:900;font-size:1.08em;letter-spacing:1.2px;margin:7px 0 2px;word-break:break-all;color:#111}
    #ordOverlay .ord-cprow{display:flex;justify-content:center;margin-top:10px}
    #ordOverlay .ord-cp{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:20px;border:1px solid #0a84ff;background:transparent;color:#0a84ff;font-weight:800;font-size:.85em;cursor:pointer}
    #ordOverlay .ord-hint{font-size:.74em;color:var(--text-sub,#777);text-align:center;margin-top:12px;line-height:1.5}
  `;
  document.head.appendChild(st);
}
function _ordClose() {
  const o = document.getElementById("ordOverlay");
  if (o) o.remove();
}
// 영문·숫자 6자 이상만 번호로 인정(서버와 같은 규칙)
function _ordNorm(text) {
  const out = [];
  for (const t of String(text == null ? "" : text).split(/[\s,;]+/)) {
    const n = t.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 40);
    if (n.length >= 6 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 20);
}
function _ordSlotsToList(slots) {
  const list = [];
  const seen = new Set();
  Object.keys(slots || {}).map(Number).filter((k) => k >= 0).sort((x, y) => x - y).forEach((k) => {
    _ordNorm(slots[k]).forEach((no) => { if (!seen.has(no)) { seen.add(no); list.push({ no, slot: k }); } });
  });
  return list;
}
function _ordText(item, slot) {
  return (item && Array.isArray(item.ords) ? item.ords : []).filter((o) => Number(o.slot) === slot).map((o) => o.no).join(", ");
}
function _ordOrphanText(item, histN) {
  return (item && Array.isArray(item.ords) ? item.ords : []).filter((o) => Number(o.slot) > histN).map((o) => o.no).join(", ");
}
function _ordSlotLabel(slot) {
  return slot > 0 ? `${slot}차 수량추가` : "기본 일정";
}
// 수정창: 원래 일정 칸 + 수량추가 이력 칸의 번호를 모아 서버로 보낼 {slot: 글} 로 만든다. 바뀐 게 없으면 null(서버를 건드리지 않음)
function _ordCollectSlots(idx, origOrds) {
  const base = document.getElementById(`edit-ord-0-${idx}`);
  if (!base) return null;
  const slots = { 0: base.value };
  const histN = parseInt(base.getAttribute("data-histn"), 10) || 0; // 수정창을 열 때의 수량추가 이력 줄 수
  let k = 0;
  document.querySelectorAll(`.hist-edit-row-${idx}`).forEach((row) => {
    const p = Math.max(0, parseInt(row.querySelector(`.hist-pal-${idx}`).value) || 0);
    const b = Math.max(0, parseInt(row.querySelector(`.hist-box-${idx}`).value) || 0);
    if (p > 0 || b > 0) { // 수량이 남은 이력만 N차로 다시 센다 (삭제된 이력의 번호는 함께 사라짐)
      k++;
      const o = row.querySelector(`.hist-ord-${idx}`);
      slots[k] = o ? o.value : "";
    }
  });
  const oldBy = {};
  (origOrds || []).forEach((o) => { (oldBy[Number(o.slot)] = oldBy[Number(o.slot)] || []).push(o.no); });
  // 수량추가 이력 줄보다 큰 칸의 번호('이력과 연결 안 된 번호')는 별도 칸에서 보여 주며, 지우지 않는 한 원래 칸을 그대로 유지
  const ox = document.getElementById(`edit-ord-x-${idx}`);
  if (ox) {
    const slotOf = {};
    (origOrds || []).forEach((o) => { if (Number(o.slot) > histN) slotOf[o.no] = Number(o.slot); });
    _ordNorm(ox.value).forEach((no) => {
      const sl = slotOf[no] || histN + 1;
      slots[sl] = (slots[sl] ? slots[sl] + "," : "") + no;
    });
  } else {
    Object.keys(oldBy).map(Number).filter((sl) => sl > histN).forEach((sl) => { slots[sl] = oldBy[sl].join(","); }); // 칸이 안 보이면 건드리지 않음
  }
  const maxSlot = Math.max(k, 0, ...Object.keys(oldBy).map(Number));
  for (let sl = 0; sl <= maxSlot; sl++) {
    const nw = _ordNorm(slots[sl] || "").slice().sort().join(",");
    const od = (oldBy[sl] || []).slice().sort().join(",");
    if (nw !== od) return slots;
  }
  return null;
}
// 6자 미만 등 번호로 인정되지 않는 입력이 섞여 있으면 true (저장은 되지만 그 부분은 빠짐 → 안내용)
function _ordHasIgnored(text) {
  return String(text == null ? "" : text).split(/[\s,;]+/).some((t) => {
    const n = t.replace(/[^A-Za-z0-9]/g, "");
    return t.trim() !== "" && n.length < 6;
  });
}
function _ordOpenOverlay(innerHtml) {
  _ordInjectCss();
  _ordClose();
  const o = document.createElement("div");
  o.id = "ordOverlay";
  o.onclick = (e) => { if (e.target === o) _ordClose(); };
  o.innerHTML = `<div class="ord-card" onclick="event.stopPropagation()">${innerHtml}</div>`;
  document.body.appendChild(o);
  _ordAttachSwipe(o);
  return o;
}
// 손잡이·제목 줄을 잡고 아래로 끌면 시트가 따라 내려오고, 충분히 내리거나 빠르게 튕기면 닫힌다 (다른 창의 당겨 닫기와 같은 규칙: 120px 또는 속도 0.5)
function _ordAttachSwipe(o) {
  const card = o.querySelector(".ord-card");
  if (!card) return;
  let st = null;
  const start = (e) => {
    if (e.target && e.target.closest && e.target.closest("button")) return; // ✕ 같은 버튼은 그대로 눌리게
    if (card.scrollTop > 5) return; // 내용이 스크롤된 상태면 끌기 무시
    st = { y0: e.clientY, y: e.clientY, t0: Date.now(), id: e.pointerId };
    card.style.animation = "none";
    card.style.transition = "none";
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const move = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const d = e.clientY - st.y0;
    st.y = e.clientY;
    if (d > 0) {
      card.style.transform = `translateY(${d}px)`;
      o.style.background = `rgba(0,0,0,${Math.max(0.12, 0.6 - d / 700)})`;
    }
  };
  const end = (e) => {
    if (!st || (e && e.pointerId !== st.id)) return;
    const d = st.y - st.y0;
    const v = d / Math.max(1, Date.now() - st.t0);
    st = null;
    card.style.animation = "none"; // 열릴 때 애니메이션이 끝난 뒤의 위치를 기준으로
    card.style.transition = "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)"; // 다른 창과 같은 속도·곡선
    if (d > 120 || v > 0.5) {
      card.style.transform = "translateY(100%)";
      o.style.transition = "background 0.3s";
      o.style.background = "rgba(0,0,0,0)";
      setTimeout(_ordClose, 300);
    } else {
      card.style.transform = "translateY(0)";
      o.style.background = "";
      setTimeout(() => { card.style.transform = ""; card.style.transition = ""; }, 300);
    }
  };
  o.querySelectorAll(".ord-gz, .ord-head").forEach((z) => {
    z.addEventListener("pointerdown", start);
    z.addEventListener("pointermove", move);
    z.addEventListener("pointerup", end);
    z.addEventListener("pointercancel", end);
  });
}
// 상세의 수량 줄 옆에 붙는 바코드 아이콘 (번호가 있는 출고 일정에만). 번호는 달력 데이터에 이미 들어 있어 바로 열린다.
function _ordBtnHtml(item, day, idx, isAdminNow, isTaskNow) {
  if (!isAdminNow || isTaskNow || !item || !Array.isArray(item.ords) || !item.ords.length) return "";
  _ordInjectCss(); // 아이콘 모양(스타일)이 팝업을 열기 전에도 적용되도록
  const svg = `<svg viewBox="0 0 16 13" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="1.4" height="13"/><rect x="2.6" y="0" width="0.8" height="13"/><rect x="4.6" y="0" width="2" height="13"/><rect x="7.6" y="0" width="0.8" height="13"/><rect x="9.4" y="0" width="1.6" height="13"/><rect x="12" y="0" width="0.8" height="13"/><rect x="13.8" y="0" width="2.2" height="13"/></svg>`;
  return `<button type="button" class="ord-ico" title="출고지시번호 · 바코드" onclick="event.stopPropagation();ordOpenList('${day}', ${idx})">${svg}<span>${item.ords.length > 1 ? item.ords.length : ""}</span></button>`;
}
function ordOpenList(day, idx) {
  const arr = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  const item = arr && arr[idx];
  if (!item || !Array.isArray(item.ords) || !item.ords.length) return;
  const ords = item.ords.slice().sort((a, b) => Number(a.slot) - Number(b.slot));
  const name = getFullName(String(item.company || "").replace(/\[TASK\]/gi, "").trim());
  // 같은 칸(원래 일정 / N차 수량추가)의 번호들은 한 묶음 카드로
  const groups = [];
  ords.forEach((o) => {
    const sl = Number(o.slot) || 0;
    let g = groups.find((x) => x.slot === sl);
    if (!g) { g = { slot: sl, list: [] }; groups.push(g); }
    g.list.push(o.no);
  });
  const bcIco = `<svg viewBox="0 0 16 13" fill="currentColor" aria-hidden="true"><rect x="0" y="0" width="1.4" height="13"/><rect x="2.6" y="0" width="0.8" height="13"/><rect x="4.6" y="0" width="2" height="13"/><rect x="7.6" y="0" width="0.8" height="13"/><rect x="9.4" y="0" width="1.6" height="13"/><rect x="12" y="0" width="0.8" height="13"/><rect x="14" y="0" width="2" height="13"/></svg>`;
  const body = groups
    .map((g) => {
      const rows = g.list
        .map((no) => `<button type="button" class="ord-row" data-no="${_esc(no)}" onclick="ordToggleBar(this)"><span class="bi">${bcIco}</span><span class="no">${_esc(no)}</span><span class="chev">▼</span></button><div class="ord-pan"></div>`)
        .join("");
      return `<div class="ord-sec${g.slot > 0 ? " add" : ""}"><span class="dot"></span><span>${_esc(_ordSlotLabel(g.slot))}</span><span class="n">${g.list.length}건</span></div><div class="ord-grp">${rows}</div>`;
    })
    .join("");
  const total = ords.length;
  _ordOpenOverlay(
    `<div class="ord-gz"><div class="ord-grab"></div></div>
    <div class="ord-head"><div class="tx"><div class="ord-eyebrow">${bcIco}<span>출고지시번호</span></div><div class="ord-title">${_esc(name)}</div><div class="ord-sub">총 ${total}건 · 번호를 누르면 바코드가 열립니다</div></div><button type="button" class="ord-x" onclick="_ordClose()" aria-label="닫기">✕</button></div>
    ${body}
    <div class="ord-hint">한 번에 한 개의 바코드만 열립니다 · 번호 수정은 ✏️수정에서<br>스캔이 안 되면 화면 밝기를 높여 보세요</div>`
  );
}
// 번호 줄을 누르면 그 줄 바로 아래가 펼쳐지며 바코드가 나타나고, 이미 열려 있던 다른 바코드는 닫힌다 (같은 줄을 다시 누르면 닫힘)
function ordToggleBar(btn) {
  const root = document.getElementById("ordOverlay");
  if (!root || !btn) return;
  const pan = btn.nextElementSibling;
  const wasOn = btn.classList.contains("on");
  root.querySelectorAll(".ord-row.on").forEach((r) => {
    r.classList.remove("on");
    const pn = r.nextElementSibling;
    if (pn) { pn.style.maxHeight = "0px"; pn.innerHTML = ""; pn.removeAttribute("data-open"); } // 닫는 쪽 바코드는 바로 없앰 → 화면에는 항상 1개만
  });
  if (wasOn || !pan) return;
  const no = btn.getAttribute("data-no") || "";
  const svg = _c128Svg(no, 110);
  pan.innerHTML = `<div class="ord-pan-in"><div class="ord-tile">${svg || `<div class="ord-hint">바코드로 만들 수 없는 번호</div>`}<div class="ord-bcno">${_esc(no)}</div></div><div class="ord-cprow"><button type="button" class="ord-cp" onclick="ordCopy('${_argq(no)}')">📋 번호 복사</button></div></div>`;
  pan.setAttribute("data-open", "1");
  btn.classList.add("on");
  pan.style.maxHeight = pan.scrollHeight + "px";
  setTimeout(() => { try { btn.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (_) {} }, 60);
}
async function ordCopy(no) {
  try {
    await navigator.clipboard.writeText(String(no));
    showToast("📋 복사했습니다.", 1500);
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = String(no);
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("📋 복사했습니다.", 1500);
    } catch (e2) {
      showToast("⚠️ 복사하지 못했습니다. 번호를 길게 눌러 복사해 주세요.", 2500);
    }
  }
}

function showModal(day, clickedIdx) {
  let dayData = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  if (!dayData || dayData.length === 0) return;
  let titleText = "",
    dateStr = "";
  if (day === "pending") {
    titleText = "⚠️ 일정 미정 / 대기 상세";
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
    let isDoneClass = isItemDone ? "done-mark" : "";
    let isExplicitTask = String(item.company || "").toUpperCase().startsWith("[TASK]");
    let cleanComp = String(item.company || "").replace(/\[TASK\]/gi, "").trim();
    let isTaskMode = isExplicitTask || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(cleanComp));

    // 💡 showModal 함수 내 수정
    let colorObj = getCompanyColor(cleanComp);
    let bgStyle = `background: ${colorObj.bg};`;
    if (isTaskMode) {
      // 기존 #222222를 소프트 미드나잇으로 변경
      bgStyle = `background: rgba(33, 37, 41, 0.4); border: 2px solid #FFD60A;`;
    }

    let actionBtns = "";
    if (isAdmin) {
      let blockStartDateStr = dateStr;
      let blockEndDateStr = "";

      if (isTaskMode && day !== "pending") {
        let startDay = parseInt(day);
        let endDay = parseInt(day);
        // 전역 getMatchKey 재사용: TASK는 isDone·pal·box 제외 → 완료/대기 혼재해도 한 블록으로 인식
        let targetKey = getMatchKey(item);

        for (let d = startDay - 1; d >= 1; d--) {
          if (serverData.monthData[d] && serverData.monthData[d].some((x) => getMatchKey(x) === targetKey))
            startDay = d;
          else break;
        }
        for (let d = endDay + 1; d <= serverData.daysInMonth; d++) {
          if (serverData.monthData[d] && serverData.monthData[d].some((x) => getMatchKey(x) === targetKey)) endDay = d;
          else break;
        }

        blockStartDateStr = _ymd(serverData.year, serverData.month, startDay);
        blockEndDateStr =
          startDay !== endDay
            ? _ymd(serverData.year, serverData.month, endDay)
            : "";
      }

      if (!isItemDone) {
        actionBtns = `<div class="action-btn-group"><button class="done-toggle-btn" onclick="submitCMS('DONE', '${_argq(item.company)}', '${dateStr}', ${idx}, false)">✅ 완료</button><button class="edit-toggle-btn" onclick="openEditForm('${day}', ${idx}, '${_argq(item.company)}', '${dateStr}', '${item.pal}', '${item.box}', '${_argq(item.etc || "")}', false, '${blockStartDateStr}', '${blockEndDateStr}')">✏️ 수정</button></div>`;
      } else {
        actionBtns = `<div class="action-btn-group"><button class="edit-toggle-btn" style="color:#ff9f0a; border: 1px solid #ff9f0a; background: rgba(255,159,10,0.1);" onclick="submitCMS('UNDO_DONE', '${_argq(item.company)}', '${dateStr}', ${idx}, true)">⏪ 취소</button><button class="edit-toggle-btn" onclick="openEditForm('${day}', ${idx}, '${_argq(item.company)}', '${dateStr}', '${item.pal}', '${item.box}', '${_argq(item.etc || "")}', true, '${blockStartDateStr}', '${blockEndDateStr}')">✏️ 수정</button></div>`;
      }
    }

    // 🚨 [패치 2-1] 히스토리 분리 및 1차, 2차 뱃지 생성
    const histRegex = /\[(\d{1,2}\/\d{1,2})\s*(?:(\d+)P)?\s*(?:(\d+)B)?\s*추가\]/g;
    let rawEtc = item.etc || "";
    let matches = [...rawEtc.matchAll(histRegex)];

    let meaningfulEtc = rawEtc
      .replace(/\[(AI자동수정|수동완료|일괄완료|완료유지|입고일자동수정|출고일자동수정|출고완료|작업완료|TASK)\]/gi, "")
      .replace(histRegex, "")
      .trim();
    let etcHtml = meaningfulEtc !== "" ? `<div class="modal-etc">📍 비고: ${_esc(meaningfulEtc)}</div>` : "";

    let histHtml = "";
    if (matches.length > 0) {
      histHtml = `<div style="margin-top: 8px; margin-bottom: 8px; background: rgba(10,132,255,0.05); border: 1px dashed rgba(10,132,255,0.3); border-radius: 8px; padding: 8px 12px;">`;
      matches.forEach((match, i) => {
        let pPart = match[2] ? `${match[2]}P` : "";
        let bPart = match[3] ? `${match[3]}B` : "";
        let space = match[2] && match[3] ? " " : "";
        histHtml += `<div style="font-size: 0.85em; color: #0a84ff; font-weight: 800; margin-bottom: ${i === matches.length - 1 ? "0" : "4px"};">↳ ${i + 1}차 추가 (${match[1]}): ${pPart}${space}${bPart}</div>`;
      });
      histHtml += `</div>`;
    }

    let iconHtml = isItemDone
      ? `<span class="done-icon" style="font-size: 13px !important; margin-right: 4px;">✅</span>`
      : "";
    let pCount = parseInt(item.pal) || 0;
    let bCount = parseInt(item.box) || 0;
    let volStr = "";

    // 💡 파레트와 박스가 둘 다 있을 때는 중간에 ' / ' 를 넣음
    if (pCount > 0 && bCount > 0) {
      volStr = `${pCount} PLT / ${bCount} BOX`;
    } else if (pCount > 0) {
      volStr = `${pCount} PLT`;
    } else if (bCount > 0) {
      volStr = `${bCount} BOX`;
    } else {
      volStr = "수량 없음";
    }

    let badgeText = isTaskMode ? "작업 완료" : "출고 완료";

    let stampHtml = isItemDone
      ? `<div class="status-badge"><span style="font-size: 1.1em; line-height: 1;">✔️</span> ${badgeText}</div>`
      : "";

    // 💡 [CRM 패치] 우측 완료 도장 맞은편(좌측)에 알약 뱃지 장착!
    let pillStr = getPillHtml(getFullName(cleanComp));
    let pillContainer = pillStr ? `<div class="modal-left-pills">${pillStr}</div>` : "";

    // 💡 [패치] 수량 추가 UI는 "출고" 항목이면서 "완료되지 않은 상태"일 때만 노출!
    let addQtyBtn =
      isAdmin && !isTaskMode && !isItemDone
        ? `<button onclick="event.stopPropagation(); document.getElementById('add-qty-wrap-${idx}').style.display='flex';" style="background:transparent; border:1px solid #0a84ff; color:#0a84ff; border-radius:6px; padding:2px 8px; font-size:0.8em; margin-left:10px; cursor:pointer; font-weight:800;">+ 수량추가</button>`
        : "";

    let addQtyForm =
      isAdmin && !isTaskMode && !isItemDone
        ? `
          <div id="add-qty-wrap-${idx}" style="display:none; width:100%; margin-top:12px; padding-top:12px; border-top:1px dashed var(--border-color); flex-direction:column; gap:8px;">
            <div style="font-size:0.8em; color:var(--text-sub); font-weight:800;">📦 파레트/박스 수량 추가</div>
            <div style="display:flex; gap:8px; align-items:stretch;">
               <input type="number" min="0" id="add-q-pal-${idx}" class="edit-input" placeholder="+ 파레트" style="padding:10px; flex:1;">
               <input type="number" min="0" id="add-q-box-${idx}" class="edit-input" placeholder="+ 박스" style="padding:10px; flex:1;">
               <button onclick="submitCMS('ADD_QTY', '${_argq(item.company)}', '${dateStr}', ${idx})" class="save-btn" style="padding:10px; flex:0.6; font-size:0.9em; border-radius:8px;">추가</button>
            </div>
            <textarea id="add-q-ord-${idx}" class="edit-input" rows="1" placeholder="출고지시번호 (선택 · 여러 개는 줄바꿈/쉼표)" autocapitalize="characters" autocomplete="off" spellcheck="false" style="padding:10px; width:100%; box-sizing:border-box; resize:vertical;"></textarea>
          </div>
        `
        : "";

    // 🚨 [새로 추가된 핵심 로직] 마스터 이름 추출 및 CRM 등록 여부 확인
    let fullName = getFullName(cleanComp);
    let isRegistered = compInfoDB[fullName] !== undefined;
    let compNameHtml = "";

    if (isRegistered && !isTaskMode) {
      // CRM에 등록되어 있고 TASK가 아닐 때만 터치 가능 (밑줄 쫙!)
      compNameHtml = `<span class="modal-comp" style="font-size:1.05em; font-weight:900; cursor:pointer; text-decoration: underline; text-decoration-color: rgba(128,128,128,0.3); text-underline-offset: 4px;" onclick="event.stopPropagation(); openReadCompPopup('${_argq(cleanComp)}')">${_esc(fullName)}</span>`;
    } else {
      // 미등록 업체이거나 TASK일 경우 그냥 평범한 텍스트로 출력 (터치 안됨)
      compNameHtml = `<span class="modal-comp" style="font-size:1.05em; font-weight:900;">${_esc(fullName)}</span>`;
    }

    contentHtml += `<div class="modal-card" id="modal-card-${day}-${idx}">
                            ${pillContainer} <div class="modal-icon ${isDoneClass}" style="${bgStyle}"></div>
                            <div class="modal-info">
                                <div class="modal-comp-row">
                                    ${compNameHtml}
                                    ${actionBtns}
                                </div>
                                <div class="modal-vol" style="display:flex; align-items:center; flex-wrap:wrap;">${iconHtml}${volStr}${isTaskMode ? "" : _shipPillHtml(item.shipType)} ${addQtyBtn}${_ordBtnHtml(item, day, idx, isAdmin, isTaskMode)}</div>
                                ${histHtml} 
                                ${etcHtml}
                            </div>
                            ${addQtyForm}
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

// 현재 수정폼 입력값 스냅샷 (변경 감지용)
function _snapshotEdit(idx) {
  const g = (id) => {
    let e = document.getElementById(id);
    return e ? e.value : "";
  };
  const c = (id) => {
    let e = document.getElementById(id);
    return e ? e.checked : false;
  };
  return JSON.stringify([
    g(`edit-comp-${idx}`),
    g(`edit-pal-${idx}`),
    g(`edit-box-${idx}`),
    g(`edit-date-${idx}`),
    g(`edit-${idx}-end-date`),
    g(`edit-etc-${idx}`),
    c(`edit-type-task-${idx}`),
    g(`edit-ord-0-${idx}`),
    Array.from(document.querySelectorAll(`.hist-ord-${idx}`)).map((e) => e.value),
  ]);
}
function _isEditDirty() {
  if (!_editState) return false;
  if (tempEditColorIdx !== null) return true; // 색상 변경도 변경으로 간주
  return _snapshotEdit(_editState.idx) !== _editState.snapshot;
}

// 저장/수정 후 상세보기 모달 다시 열기 (해당 날짜에 항목이 남아있을 때)

// 수정폼 닫고 상세보기로 복귀 (취소 버튼)
async function closeEditForm(day, idx) {
  if (_isEditDirty()) {
    if (!(await uiConfirm("⚠️ 저장하지 않은 변경사항이 있습니다.\n변경을 취소하고 상세보기로 돌아갈까요?"))) return;
  }
  _editState = null;
  tempEditColorObj = null;
  tempEditColorIdx = null;
  renderCalendar();
  showModal(day);
}

async function openEditForm(
  day,
  idx,
  comp,
  dateStr,
  pal,
  box,
  etc,
  isDone,
  blockStartDateStr = null,
  blockEndDateStr = null,
) {
  // 🔁 다른 일정을 수정 중이었다면: 변경사항 확인 후 전환 (아코디언)
  if (_editState && _editState.idx !== idx) {
    if (_isEditDirty()) {
      const save = await uiConfirm("✏️ 수정 중인 변경사항이 있습니다.", {
        okText: "저장하고 이동",
        cancelText: "변경취소 이동",
      });
      if (save) {
        const a = _editState.saveArgs;
        _editState = null;
        submitCMS("EDIT", a.comp, a.dateStr, a.idx, a.isDone, a.blockStart, a.blockEnd);
        return; // 저장 후엔 상세보기로 복귀됨 (새 수정폼은 다시 탭하여 열기)
      }
    }
    // 변경 취소하고 이동: 카드들을 상세보기로 리셋 후 새 카드 수정폼 열기
    _editState = null;
    tempEditColorObj = null;
    tempEditColorIdx = null;
    showModal(day);
  }

  tempEditColorObj = null;
  const card = document.getElementById(`modal-card-${day}-${idx}`);
  if (!card) return;
  let inputDateVal = blockStartDateStr || (dateStr === "미정" ? "" : dateStr);
  let inputEndDateVal = blockEndDateStr || "";

  setTimeout(() => {
    const editEndInput = document.getElementById(`edit-${idx}-end-date`);
    if (editEndInput) {
      editEndInput.setAttribute("min", inputDateVal);
      editEndInput.min = inputDateVal;
      editEndInput.onfocus = function () {
        if (!this.value && this.min) this.value = this.min;
      };
      editEndInput.onchange = function () {
        if (this.value && this.min && this.value < this.min) {
          showToast("⚠️ 종료일은 시작일보다 빠를 수 없습니다.", 2000);
          return;
          this.value = this.min;
        }
      };
    }
  }, 50);

  let isExplicitTask = comp.toUpperCase().startsWith("[TASK]");
  let cleanComp = comp.replace(/\[TASK\]/gi, "").trim();
  let isTaskMode = isExplicitTask;

  // 🚨 [패치 3-1] 수정 폼에 인라인 에디팅 리스트 생성
  let safeEtc = etc === "undefined" || etc == null ? "" : String(etc);
  const histRegex = /\[(\d{1,2}\/\d{1,2})\s*(?:(\d+)P)?\s*(?:(\d+)B)?\s*추가\]/g;
  let matches = [...safeEtc.matchAll(histRegex)];
  let cleanEtc = safeEtc
    .replace(histRegex, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // 출고지시번호: 원래 일정(slot 0) + N차 수량추가(slot N)
  const _ordArr = day === "pending" ? serverData.pendingItems : serverData.monthData[day];
  const _ordItem = _ordArr && _ordArr[idx] ? _ordArr[idx] : null;
  const _ordInputAttr = `type="text" class="edit-input" autocapitalize="characters" autocomplete="off" spellcheck="false"`;

  let histHtml = "";
  if (matches.length > 0) {
    histHtml += `<div class="form-label" style="margin-bottom: 6px; margin-top: 10px;">수량 추가 이력 세부 제어</div>`;
    histHtml += `<div id="hist-container-${idx}" style="background: rgba(10,132,255,0.05); border: 1px dashed rgba(10,132,255,0.3); border-radius: 8px; padding: 8px; display:flex; flex-direction:column; gap:6px;">`;
    matches.forEach((match, i) => {
      let pVal = match[2] || 0;
      let bVal = match[3] || 0;
      histHtml += `
                <div class="hist-edit-row-${idx}" id="hist-item-${idx}-${i}" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; width:100%;">
                    <span style="font-size:0.75em; background:#0a84ff; color:#fff; padding:2px 5px; border-radius:4px; font-weight:bold; white-space:nowrap; flex-shrink:0;">${i + 1}차</span>
                    <span class="hist-date-${idx}" style="font-size:0.85em; font-weight:900; color:#0a84ff; white-space:nowrap; flex-shrink:0;">${match[1]}</span>
                    
                    <input type="number" min="0" class="hist-pal-${idx} edit-input" value="${pVal}" data-old="${pVal}" oninput="onHistQtyChange(this, ${idx}, 'pal')" style="padding:6px; font-size:0.85em; flex:1; min-width:0; text-align:center;" placeholder="PLT">
                    <input type="number" min="0" class="hist-box-${idx} edit-input" value="${bVal}" data-old="${bVal}" oninput="onHistQtyChange(this, ${idx}, 'box')" style="padding:6px; font-size:0.85em; flex:1; min-width:0; text-align:center;" placeholder="BOX">
                    
                    <button onclick="deleteHistItem(${idx}, ${i})" style="background:rgba(255,59,48,0.1); color:#ff3b30; border:none; border-radius:6px; padding:6px 10px; font-weight:bold; cursor:pointer; font-size:0.85em; white-space:nowrap; flex-shrink:0;">삭제</button>
                    ${!isTaskMode ? `<input type="text" class="hist-ord-${idx} edit-input" autocapitalize="characters" autocomplete="off" spellcheck="false" id="edit-ord-${i + 1}-${idx}" value="${_esc(_ordText(_ordItem, i + 1))}" placeholder="${i + 1}차 수량추가 출고지시번호 (선택 · 여러 개는 쉼표)" style="flex:1 1 100%; padding:6px; font-size:0.85em; margin-top:2px;">` : ""}
                </div>`;
    });
    histHtml += `</div>`;
  }

  card.style.flexDirection = "";
  card.style.alignItems = "";
  card.innerHTML = `
          <div class="edit-form" style="width: 100%; padding:0; border:none; margin-top:0;">
            <div class="type-toggle-wrapper" style="margin-bottom: 12px; margin-top: 0;">
              <input type="radio" id="edit-type-out-${idx}" name="edit-job-type-${idx}" value="OUT" ${!isTaskMode ? "checked" : ""} hidden onchange="toggleEndDate('edit-${idx}', false)">
              <label for="edit-type-out-${idx}" class="type-label">출고</label>
              <input type="radio" id="edit-type-task-${idx}" name="edit-job-type-${idx}" value="TASK" ${isTaskMode ? "checked" : ""} hidden onchange="toggleEndDate('edit-${idx}', true)">
              <label for="edit-type-task-${idx}" class="type-label">작업</label>
            </div>
            
            <div class="form-label" style="display:flex; justify-content:space-between; align-items:center;">
              <span>업체명 (필수)</span>
              <button type="button" id="edit-${idx}-shuffle-btn" style="display:${isTaskMode ? "none" : "block"}; background:rgba(10,132,255,0.1); border:1px solid #0a84ff; color:#0a84ff; border-radius:6px; padding:4px 10px; font-size:0.85em; cursor:pointer; font-weight:800; transition:0.2s;" onclick="shuffleColorInModal('${_argq(cleanComp)}', ${idx})" onmousedown="this.style.transform='scale(0.95)'" onmouseup="this.style.transform='scale(1)'">🎨 색상 셔플</button>
            </div>
            <div class="input-wrapper">
              <input type="text" id="edit-comp-${idx}" class="edit-input" value="${_esc(getFullName(cleanComp))}" autocomplete="off">
            </div>
            
            <div id="edit-${idx}-color-preview" style="display:none; margin-top:10px; padding:15px; background:rgba(0,0,0,0.1); border-radius:12px; border:1px solid var(--border-color); align-items:center; justify-content:center; gap:20px; animation: fadeIn 0.3s;">
               <div style="text-align:center;">
                  <div style="font-size:0.75em; color:var(--text-sub); margin-bottom:6px; font-weight:bold;">현재 색상</div>
                  <div id="old-color-box-${idx}" style="width:40px; height:40px; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.2);"></div>
               </div>
               <span style="font-size:1.5em; margin-top:15px; color:var(--text-sub);">➡️</span>
               <div style="text-align:center;">
                  <div style="font-size:0.75em; color:#0a84ff; margin-bottom:6px; font-weight:bold;">변경될 색상</div>
                  <div id="new-color-box-${idx}" style="width:44px; height:44px; border-radius:8px; box-shadow:0 4px 15px rgba(10,132,255,0.4); border:2px solid #0a84ff;"></div>
               </div>
            </div>

            <div class="form-label" style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
              <span>날짜 <span id="edit-${idx}-date-label-extra" style="display:${isTaskMode ? "inline" : "none"}">(시작일 ~ 종료일)</span></span>
              <span style="color:#ff3b30; cursor:pointer; font-weight:800; font-size:0.85em; padding:4px 8px; background:rgba(255,59,48,0.1); border-radius:6px; transition:0.2s;" onclick="document.getElementById('edit-date-${idx}').value=''; let e=document.getElementById('edit-${idx}-end-date'); if(e)e.value='';" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">✕ 지우기</span>
            </div>
            
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="date" id="edit-date-${idx}" class="edit-input" style="flex:1;" value="${inputDateVal}" onchange="let t=document.getElementById('edit-${idx}-end-date'); t.setAttribute('min', this.value); t.min=this.value; if(t.value && t.value < this.value) t.value=this.value;">
              <div id="edit-${idx}-end-date-group" style="display:${isTaskMode ? "flex" : "none"}; flex:1; gap:8px; align-items:center;">
                <span style="color:var(--text-sub); font-weight:bold;">~</span>
                <input type="date" id="edit-${idx}-end-date" class="edit-input" style="flex:1;" placeholder="종료일" value="${inputEndDateVal}" min="${inputDateVal || ""}">
              </div>
            </div>
            
            <div id="edit-${idx}-end-date-guide" style="display:${isTaskMode ? "block" : "none"}; font-size:0.75em; color:var(--text-sub); margin-top:4px; text-align:right; margin-bottom:5px;">※ 하루 일정은 앞쪽 시작일만 입력하세요.</div>
            
            <div class="edit-row">
              <div>
                <div class="form-label">총 파레트 (P)</div>
                <input type="number" min="0" id="edit-pal-${idx}" class="edit-input" placeholder="0" value="${pal == "0" ? "" : pal}">
              </div>
              <div>
                <div class="form-label">총 박스 (B)</div>
                <input type="number" min="0" id="edit-box-${idx}" class="edit-input" placeholder="0" value="${box == "0" ? "" : box}">
              </div>
            </div>
            
            ${!isTaskMode ? `<div class="form-label" style="margin-top:10px;">출고지시번호 (기본 일정 · 선택)</div>
            <input ${_ordInputAttr} id="edit-ord-0-${idx}" data-histn="${matches.length}" value="${_esc(_ordText(_ordItem, 0))}" placeholder="여러 개는 쉼표·띄어쓰기로 구분">` : ""}
            ${!isTaskMode && _ordOrphanText(_ordItem, matches.length) ? `<div class="form-label" style="margin-top:10px;">수량추가 이력과 연결되지 않은 번호 (지우면 삭제)</div>
            <input ${_ordInputAttr} id="edit-ord-x-${idx}" value="${_esc(_ordOrphanText(_ordItem, matches.length))}">` : ""}

            ${histHtml}

            ${!isTaskMode ? `<div class="form-label">배송 구분</div>${_shipSelectHtml(`edit-ship-${idx}`, _ordItem && _ordItem.shipType)}` : ""}

            <div class="form-label">비고 (메모 입력)</div>
            <input type="text" id="edit-etc-${idx}" class="edit-input" value="${_esc(cleanEtc !== "undefined" ? cleanEtc : "")}">
            
            <div class="btn-row" id="edit-save-row-${idx}"></div>
            <button class="cancel-btn" onclick="closeEditForm('${day}', ${idx})">취소</button>
            ${
              blockEndDateStr && blockEndDateStr !== "null" && blockEndDateStr !== "" && blockEndDateStr !== blockStartDateStr
                ? `<div style="display:flex; gap:8px;">
                     <button class="delete-btn" style="flex:1;" onclick="submitCMS('DELETE', '${_argq(comp)}', '${dateStr}', ${idx}, ${isDone}, '', '')">🗑️ 이 날짜만</button>
                     <button class="delete-btn" style="flex:1; background:#e0241b; color:#fff; border:1px solid #b71c10;" onclick="submitDeleteBlock('${_argq(comp)}', '${dateStr}', ${idx}, ${isDone}, '${blockStartDateStr}', '${blockEndDateStr}')">🗑️ 전체 스케줄</button>
                   </div>`
                : `<button class="delete-btn" onclick="submitCMS('DELETE', '${_argq(comp)}', '${dateStr}', ${idx}, ${isDone}, '${blockStartDateStr}', '${blockEndDateStr}')">🗑️ 이 스케줄 삭제</button>`
            }
          </div>
        `;
  attachAutocomplete(`edit-comp-${idx}`);

  // 저장 버튼 DOM으로 직접 삽입 (중첩 템플릿 리터럴 파싱 문제 회피)
  const _saveRow = document.getElementById("edit-save-row-" + idx);
  if (_saveRow) {
    const _isBlock = blockEndDateStr && blockEndDateStr !== "null" && blockEndDateStr !== "" && blockEndDateStr !== blockStartDateStr;
    if (_isBlock) {
      const _b1 = document.createElement("button");
      _b1.className = "save-btn"; _b1.style.flex = "1";
      _b1.textContent = "💾 이 날만";
      _b1.onclick = () => {
        // 이 날만 저장: 폼 날짜가 blockStartDateStr(블록 시작일)로 초기화돼 있어
        // 클릭한 날짜(dateStr)로 먼저 복원 → 날짜 이동 버그 방지
        const _di = document.getElementById("edit-date-" + idx);
        if (_di) _di.value = dateStr;
        const _dei = document.getElementById("edit-" + idx + "-end-date");
        if (_dei) _dei.value = "";
        submitCMS("EDIT", comp, dateStr, idx, isDone, "", "");
      };
      const _b2 = document.createElement("button");
      _b2.className = "save-btn"; _b2.style.flex = "1"; _b2.style.background = "#27ae60";
      _b2.textContent = "💾 전체 저장";
      _b2.onclick = () => submitCMS("EDIT", comp, dateStr, idx, isDone, blockStartDateStr, blockEndDateStr);
      _saveRow.appendChild(_b1); _saveRow.appendChild(_b2);
    } else {
      const _b = document.createElement("button");
      _b.className = "save-btn";
      _b.textContent = "💾 저장";
      _b.onclick = () => submitCMS("EDIT", comp, dateStr, idx, isDone, blockStartDateStr, blockEndDateStr);
      _saveRow.appendChild(_b);
    }
  }

  // 수정 상태 기록 (변경 감지 + 전환 시 저장용)
  _editState = {
    day,
    idx,
    snapshot: _snapshotEdit(idx),
    saveArgs: { comp, dateStr, idx, isDone, blockStart: blockStartDateStr, blockEnd: blockEndDateStr },
  };
}

// =====================================================
// 📊 [최종 완결판] 다이나믹 대시보드 & 하이브리드 지시선 통합 엔진
// =====================================================
window.dashMode = "month";
window.dashUnit = "pal";
window.dashYear = new Date().getFullYear();
window.dashMonth = new Date().getMonth() + 1;
let yearlyCache = {};
let mainChartIns = null;
let shareChartIns = null;
window.activePieIndex = null;

// 1. 도넛 가운데에 정보 띄우기 (풀네임 적용 및 글자 짤림 완벽 방어)
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

      // 🚨 [핵심] 차트 데이터에서 '풀네임'을 바로 가져옴
      const fullNames = chart.data.fullNames;
      const displayName = fullNames ? fullNames[idx] : chart.data.labels[idx];

      const totalSum = data.reduce((a, b) => a + b, 0);
      const percent = ((data[idx] / totalSum) * 100).toFixed(1);
      const unitStr = window.dashUnit === "pal" ? "P" : "B";

      // 1️⃣ 업체명 (폰트 사이즈 플렉서블 + 장평 강제 조절)
      ctx.font = "bold 15px -apple-system, sans-serif";
      ctx.fillStyle = colors[idx] !== "rgba(128,128,128,0.1)" ? colors[idx] : "#0a84ff";

      // 글씨가 너무 길면 폰트 사이즈를 단계별로 줄여서 삐져나가지 않게 방어
      let textWidth = ctx.measureText(displayName).width;
      if (textWidth > 100) {
        ctx.font = "bold 11px -apple-system, sans-serif";
      } else if (textWidth > 80) {
        ctx.font = "bold 13px -apple-system, sans-serif";
      }

      // 🚨 4번째 파라미터(100)를 주면, 너비가 100px을 초과할 경우 브라우저가 글자 폭(장평)을
      // 좁게 압축해서라도 밖으로 튀어나가지 않게 100% 방어해 줍니다.
      ctx.fillText(displayName, centerX, centerY - 22, 100);

      // 2️⃣ 퍼센트 (가장 크게!)
      ctx.font = "900 26px -apple-system, sans-serif";
      ctx.fillStyle = document.body.classList.contains("light-mode") ? "#222" : "#eee";
      ctx.fillText(`${percent}%`, centerX, centerY + 6);

      // 3️⃣ 수량 (크기 키움)
      ctx.font = "bold 15px -apple-system, sans-serif";
      ctx.fillStyle = "gray";
      ctx.fillText(`(${data[idx]}${unitStr})`, centerX, centerY + 30);
    } else {
      // 🚨 [패치] 기본 문구는 작은 폰에서도 안 짤리도록 예쁘게 두 줄로 쪼갬!
      ctx.font = "bold 14px -apple-system, sans-serif";
      ctx.fillStyle = "gray";
      ctx.fillText("👆 조각을", centerX, centerY - 10);
      ctx.fillText("터치하세요", centerX, centerY + 10);
    }
    ctx.restore();
  },
};

// 🎨 [플러그인 2] 하이브리드 지시선 (큰 조각은 안, 작은 조각은 밖으로 뻗침)
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

      // 조각이 크면 안에다 이름 적기
      if (circumference > 0.35) {
        const r = element.innerRadius + (element.outerRadius - element.innerRadius) * 0.55;
        const x = centerX + Math.cos(midAngle) * r;
        const y = centerY + Math.sin(midAngle) * r;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = isActive ? "bold 13px -apple-system, sans-serif" : "13px -apple-system, sans-serif";
        ctx.fillStyle = isActive ? "#ffffff" : "rgba(255,255,255,0.3)";
        if (isActive) {
          ctx.shadowColor = "rgba(0,0,0,0.6)";
          ctx.shadowBlur = 4;
        }

        ctx.fillText(labels[index], x, y - 6);
        ctx.font = isActive ? "bold 11px -apple-system, sans-serif" : "11px -apple-system, sans-serif";
        ctx.fillText(`${percent}%`, x, y + 8);
        ctx.restore();
      } else {
        // 작으면 밖으로 지시선 뽑기
        const startX = centerX + Math.cos(midAngle) * radius;
        const startY = centerY + Math.sin(midAngle) * radius;
        let elbowX = centerX + Math.cos(midAngle) * (radius + 15);
        let elbowY = centerY + Math.sin(midAngle) * (radius + 15);

        const text = `${labels[index]} (${percent}%)`;
        ctx.font = "bold 11px -apple-system, sans-serif";
        const textWidth = ctx.measureText(text).width;
        let obj = { index, text, textWidth, startX, startY, elbowX, elbowY, isRight };
        if (isRight) rightLabels.push(obj);
        else leftLabels.push(obj);
      }
    });

    // 겹침 방지 정렬 (천장 뚫림 방지 추가!)
    const avoidCollision = (lbls) => {
      lbls.sort((a, b) => a.elbowY - b.elbowY);
      let prevY = -9999;
      lbls.forEach((lbl) => {
        if (lbl.elbowY < 16) lbl.elbowY = 16; // 🚨 맨 위쪽 글씨가 천장 밖으로 나가지 않게 최저 한계선 고정!
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

// 🚨 이전에 꼬였던 플러그인들 리셋하고 새것만 등록!
// 🚨 chart.js(defer 로드) 준비 후에만 플러그인 등록 (Chart is not defined 방지)

_registerChartPlugins();

// ⚙️ 스위치 토글 및 네비게이션 함수들
function setDashUnit(unit) {
  window.dashUnit = unit;
  document.getElementById("btnDashPal").classList.toggle("active", unit === "pal");
  document.getElementById("btnDashBox").classList.toggle("active", unit === "box");
  renderDashCharts();
}
// 💡 [독립 변수 추가] 연간 탭 전용 년도 기억 장치
window.dashYearlyYear = new Date().getFullYear();

function setDashMode(mode) {
  window.dashMode = mode;
  document.getElementById("btnDashMonth").classList.toggle("active", mode === "month");
  document.getElementById("btnDashYear").classList.toggle("active", mode === "year");

  if (mode === "year") {
    // 🚨 연간 전용 년도를 사용해 데이터를 가져옵니다.
    if (!yearlyCache[window.dashYearlyYear]) fetchYearlyAndRender();
    else renderDashCharts();
  } else {
    // 🚨 월간으로 돌아올 때 원래 보던 년/월(dashYear)을 그대로 유지!
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
    // 🚨 연간 탭에서는 월간 변수(dashYear)를 건드리지 않고, 연간 전용 변수만 조작!
    window.dashYearlyYear += offset;
    fetchYearlyAndRender();
  }
}

// 🚨 [신규] 대시보드용 월간 데이터 독립 호출 엔진 (달력 UI 건드림 X)
window.dashCurrentData = null; // 대시보드가 임시로 쓸 데이터 바구니

function fetchDashMonthAndRender() {
  document.getElementById("dashTitleText").innerText = `${window.dashYear}년 ${window.dashMonth}월`;
  let sub = document.getElementById("dashSubTitleText");
  if (sub) sub.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약 (조회중)`;

  let cacheKey = `cal_cache_${currentType}_${window.dashYear}_${window.dashMonth}`;
  let cached = localStorage.getItem(cacheKey);
  let oldSig = null; // 🚨 [방어막 지문]

  if (cached) {
    try {
      let parsed = JSON.parse(cached);
      window.dashCurrentData = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      oldSig =
        JSON.stringify(window.dashCurrentData.monthData || {}) +
        JSON.stringify(window.dashCurrentData.pendingItems || []);
      renderDashCharts();
    } catch (e) {}
  } else {
    window.dashCurrentData = { monthData: {}, pendingItems: [] };
    renderDashCharts();
    document.getElementById("dashCardTitle1").innerText = "데이터 불러오는 중...";
    // 💡 출고 전용 리셋 UI 보존
    let vDet = document.getElementById("dashVolDetail");
    if (vDet) vDet.innerText = "조회중...";
    let dTot = document.getElementById("dashTotal");
    if (dTot) dTot.innerHTML = "0";
    document.getElementById("dashAvg").innerText = "⏳";
  }

  // 🚀 Vercel API 백그라운드 호출
  apiGet({ type: currentType, year: window.dashYear, month: window.dashMonth }).then((res) => {
    if (res === null) {
      if (window.dashMode === "month" && !cached) {
        document.getElementById("dashCardTitle1").innerText = "불러오기 실패 🥲";
        document.getElementById("dashAvg").innerText = "❌";
      }
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
    // 💡 출고 전용 리셋 UI 보존
    let vDet = document.getElementById("dashVolDetail");
    if (vDet) vDet.innerText = "조회중...";
    let dTot = document.getElementById("dashTotal");
    if (dTot) dTot.innerHTML = "0";
    document.getElementById("dashAvg").innerText = "⏳";
  }

  // 🚀 Vercel API 백그라운드 호출
  apiGet({ action: "yearlyStats", type: currentType, year: window.dashYearlyYear }).then((res) => {
    if (res === null) {
      if (window.dashMode === "year" && !cached) {
        document.getElementById("dashCardTitle1").innerText = "불러오기 실패 🥲";
        document.getElementById("dashAvg").innerText = "❌";
      }
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

function openDashboard() {
  // 🚨 창을 처음 열 때는 월간/연간 변수를 모두 '현재 바탕 화면 달력' 기준으로 초기화
  window.dashYear = serverData.year;
  window.dashMonth = serverData.month;
  window.dashYearlyYear = serverData.year;

  window.dashCurrentData = serverData;
  document.getElementById("dashboardModal").style.display = "flex";
  setTimeout(renderDashCharts, 380); // 모달 슬라이드인 끝난 뒤 생성해야 진입 애니메이션이 보임
}

// 📅 막대그래프에 '오늘 날짜' 점선 + 라벨 표시 (월별 모드 + 당월일 때만). 모바일·PC 공통.
const _todayLinePlugin = {
  id: "todayLine",
  afterDatasetsDraw(chart) {
    if (window.dashMode !== "month") return;
    const now = new Date();
    if (window.dashYear !== now.getFullYear() || window.dashMonth !== now.getMonth() + 1) return;
    const idx = now.getDate() - 1;
    const xScale = chart.scales.x;
    const ca = chart.chartArea;
    if (!xScale || !ca || idx < 0 || idx >= (chart.data.labels || []).length) return;
    const x = xScale.getPixelForValue(idx);
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 3]);
    ctx.moveTo(x, ca.top);
    ctx.lineTo(x, ca.bottom);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff3b30";
    ctx.stroke();
    ctx.setLineDash([]);
    const label = "오늘 " + now.getDate() + "일";
    ctx.font = "700 10px -apple-system, BlinkMacSystemFont, sans-serif";
    const tw = ctx.measureText(label).width;
    let lx = Math.max(ca.left, Math.min(x - tw / 2 - 3, ca.right - tw - 6));
    ctx.fillStyle = "#ff3b30";
    ctx.fillRect(lx, ca.top + 1, tw + 6, 14);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "top";
    ctx.fillText(label, lx + 3, ca.top + 3);
    ctx.restore();
  },
};

// 📈 핵심 차트 그리기 엔진
function renderDashCharts() {
  Chart.defaults.color = document.body.classList.contains("light-mode") ? "#777" : "#a0a0a0";
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif';
  let typeName = currentType === "out" ? "출고량" : "입고량";
  let unitName = window.dashUnit === "pal" ? "PAL" : "BOX";

  let labels = [];
  let barData = [];
  let compMap = {};
  let barDetails = [];
  let totalQty = 0;
  let doneQty = 0;
  document.getElementById("barDetailBox").style.display = "none";

  // 💡 [추가] 미정건 포함 체크박스 상태 확인
  const includePending = document.getElementById("includePendingCheck")?.checked;

  if (window.dashMode === "month") {
    // 💡 월별 타이틀 분리
    document.getElementById("dashTitleText").innerText = `${window.dashYear}년 ${window.dashMonth}월`;
    let sub = document.getElementById("dashSubTitleText");
    if (sub) sub.innerText = `${window.dashYear}년 ${window.dashMonth}월 요약`;

    let days = new Date(window.dashYear, window.dashMonth, 0).getDate();
    for (let d = 1; d <= days; d++) {
      labels.push(`${d}일`);
      barData.push(0);
      barDetails.push({});
    }

    const process = (it, dIdx) => {
      let clean = String(it.company || it.bl || "")
        .replace(/\[TASK\]/gi, "")
        .trim();
      let isTask =
        String(it.company || it.bl || "")
          .toUpperCase()
          .startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));
      if (!isTask) {
        let qty = parseInt(it[window.dashUnit]) || 0;
        totalQty += qty;
        if (it.isDone === true || String(it.isDone) === "true") doneQty += qty;
        if (dIdx !== null) {
          barData[dIdx - 1] += qty;
          let std = getFullName(clean);
          barDetails[dIdx - 1][std] = (barDetails[dIdx - 1][std] || 0) + qty;
        }
        let stdTotal = getFullName(clean);
        compMap[stdTotal] = (compMap[stdTotal] || 0) + qty;
      }
    };

    // 💡 [월간 데이터 처리]
    if (window.dashCurrentData) {
      for (let d = 1; d <= days; d++) {
        if (window.dashCurrentData.monthData && window.dashCurrentData.monthData[d]) {
          window.dashCurrentData.monthData[d].forEach((it) => process(it, d));
        }
      }
      // 💡 미정건 포함 체크 시에만 합산 처리 (process 함수 재사용)
      if (includePending && window.dashCurrentData.pendingItems) {
        window.dashCurrentData.pendingItems.forEach((it) => process(it, null));
      }
    }
  } else {
    // 💡 연간 타이틀 분리 (연간 전용 변수 dashYearlyYear 적용)
    document.getElementById("dashTitleText").innerText = `${window.dashYearlyYear}년`;
    let sub = document.getElementById("dashSubTitleText");
    if (sub) sub.innerText = `${window.dashYearlyYear}년 연간 요약`;
    for (let m = 1; m <= 12; m++) {
      labels.push(`${m}월`);
      barDetails.push({});
    }

    // 🚨 여기서도 dashYear 대신 dashYearlyYear 사용!
    let yData = yearlyCache[window.dashYearlyYear];
    if (!yData) return;

    barData = yData.monthly.map((m) => m[window.dashUnit]);
    // ... (이 아래 코드는 기존 그대로 유지하시면 됩니다!)
    totalQty = barData.reduce((a, b) => a + b, 0);
    Object.keys(yData.comp).forEach((k) => {
      compMap[k] = yData.comp[k][window.dashUnit];
    });

    // 💡 [연간 추가] 연간 모드에서도 체크 시 미정 데이터 합산 (출고 전용 로직)
    if (includePending && window.dashCurrentData && window.dashCurrentData.pendingItems) {
      window.dashCurrentData.pendingItems.forEach((it) => {
        let clean = String(it.company || it.bl || "")
          .replace(/\[TASK\]/gi, "")
          .trim();
        let isTask =
          String(it.company || it.bl || "")
            .toUpperCase()
            .startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));

        // 작업(TASK)이 아닌 순수 화물만 통계에 포함
        if (!isTask) {
          // 현재 선택된 단위(P/B)에 맞춰서 수량 추출
          let qty = parseInt(it[window.dashUnit]) || 0;
          totalQty += qty;

          // 도넛 차트용 업체별 점유율 계산
          let stdTotal = getFullName(clean);
          compMap[stdTotal] = (compMap[stdTotal] || 0) + qty;
        }
      });
    }
  }

  // ... (이 아래로 if (window.dashMode === 'month') { let rate = ...  코드가 이어짐)

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
    // 🚨 [핵심 패치] 물량이 1이라도 있는 '활성화된 달'의 개수만 추출!
    let activeMonths = barData.filter((val) => val > 0).length;
    let divider = activeMonths > 0 ? activeMonths : 1; // 0으로 나누기 방지 방어막

    // 무조건 12로 나누던 것을, 실제 영업을 한 개월 수(divider)로 나눔
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

  // 💡 1. 막대 색깔 하이라이트 + [빈 데이터 스킵(스냅) 로직]
  window.lastHoveredBarIndex = -1;
  let defaultBgColor = "#0a84ff";

  window.highlightBarOnly = function (idx) {
    if (idx === null || idx === undefined || idx < 0) {
      window.lastHoveredBarIndex = -1;
      mainChartIns.data.datasets[0].backgroundColor = new Array(labels.length).fill(defaultBgColor);
      mainChartIns.update();
      // 🚨 [패치 1] 마우스가 나가도 상세박스 유지!
      return;
    }

    let validIndices = [];
    for (let i = 0; i < labels.length; i++) {
      if (barData[i] > 0) validIndices.push(i);
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

    let dimColor = document.body.classList.contains("light-mode")
      ? "rgba(10, 132, 255, 0.2)"
      : "rgba(10, 132, 255, 0.3)";
    let newColors = new Array(labels.length).fill(dimColor);
    newColors[idx] = defaultBgColor;
    mainChartIns.data.datasets[0].backgroundColor = newColors;

    if (mainChartIns.tooltip) {
      mainChartIns.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
    }
    mainChartIns.update();
  };

  // 💡 2. 손 뗐을 때 상세내역 스르륵 호출
  window.showDetailBox = function (idx) {
    let detailBox = document.getElementById("barDetailBox");
    if (idx === null || idx === undefined || idx < 0) return;

    let details = barDetails[idx];
    let total = barData[idx];
    if (total === 0) {
      detailBox.style.display = "none";
      return;
    }

    let timeLabel = window.dashMode === "month" ? `${idx + 1}일` : `${idx + 1}월`;
    let unit = window.dashUnit === "pal" ? "P" : "B";
    let html = `<div style="font-weight:900; margin-bottom:10px; color:var(--text-main);">📅 ${timeLabel} 출고 내역 <span style="color:#0a84ff; font-size:0.9em;">(총 ${total}${unit})</span></div>`;
    html += `<div style="display:flex; flex-wrap:wrap; gap:8px;">`;

    let sortedComps = Object.keys(details).sort((a, b) => details[b] - details[a]);
    sortedComps.forEach((comp) => {
      if (details[comp] > 0) {
        let cObj = getCompanyColor(comp);
        html += `<div style="display:flex; align-items:center; gap:6px; background:${cObj.bg}; color:${cObj.cMain}; padding:6px 12px; border-radius:8px; font-size:0.95em; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
                          <span style="font-weight:900;">${comp}</span><span style="font-weight:800; opacity:0.9;">${details[comp]}${unit}</span>
                      </div>`;
      }
    });
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
  let bgColors = new Array(labels.length).fill(defaultBgColor);

  mainChartIns = new Chart(document.getElementById("mainChart"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ label: typeName, data: barData, backgroundColor: bgColors, borderRadius: 4 }],
    },
    plugins: [_todayLinePlugin],
    options: {
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
            title: (items) => (window.dashMode === "month" ? `${items[0].label} 출고량` : `${items[0].label} 출고량`),
            label: () => null,
            footer: (items) => `총 ${items[0].parsed.y}${window.dashUnit === "pal" ? "P" : "B"}`,
          },
        },
      },
      scales: { x: { grid: { display: false } } },
      events: [], // 커스텀 엔진 위임
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

  // 🍩 2. 파이 차트 (하이브리드 엔진 & 다이얼 슬라이더 연동!) ... (이하 기존 코드 유지)

  // 🍩 2. 파이 차트 (하이브리드 엔진 & 다이얼 슬라이더 연동!)
  window.activePieIndex = null;
  let sortedComps = Object.keys(compMap)
    .filter((k) => compMap[k] > 0)
    .sort((a, b) => compMap[b] - compMap[a]);
  let sLabels = [];
  let sData = [];
  let sColors = [];
  sortedComps.forEach((c) => {
    sLabels.push(getShortName(c));
    sData.push(compMap[c]);
    sColors.push(getCompanyColor(c).bg);
  });

  if (shareChartIns) shareChartIns.destroy();

  // 🚨 [핵심] 차트와 슬라이더를 동시에 조종하는 '마스터 컨트롤러'
  window.highlightPieSlice = function (idx) {
    if (!shareChartIns) return;
    const dataset = shareChartIns.data.datasets[0];
    let slider = document.getElementById("pieSlider");

    // 🚨 [버그 픽스] 스크롤바가 던지는 문자열 "-1"도 완벽하게 잡아냄!
    if (idx === null || String(idx) === "-1") {
      window.activePieIndex = null;
      dataset.backgroundColor = [...dataset._originalColors];
      if (slider) slider.value = -1; // 슬라이더 원위치
    } else {
      window.activePieIndex = parseInt(idx, 10);
      dataset.backgroundColor = dataset._originalColors.map((color, i) => {
        return i === window.activePieIndex
          ? color
          : document.body.classList.contains("light-mode")
            ? "rgba(0,0,0,0.05)"
            : "rgba(255,255,255,0.05)";
      });
      if (slider) slider.value = window.activePieIndex;
    }
    shareChartIns.update();
  };

  shareChartIns = new Chart(document.getElementById("shareChart"), {
    type: "doughnut",
    data: {
      labels: sLabels,
      fullNames: sortedComps,
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
      layout: { padding: { left: 50, right: 50, top: 30, bottom: 25 } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      onClick: (e, activeElements) => {
        // 도넛을 직접 터치했을 때도 마스터 컨트롤러 호출!
        if (!activeElements || activeElements.length === 0) window.highlightPieSlice(-1);
        else {
          const idx = activeElements[0].index;
          if (window.activePieIndex === idx) window.highlightPieSlice(-1);
          else window.highlightPieSlice(idx);
        }
      },
    },
  });

  // 🎛️ 슬라이더 범위 세팅 및 연결
  let sliderWrapper = document.getElementById("pieSliderWrapper");
  let slider = document.getElementById("pieSlider");
  if (sLabels.length > 0 && sliderWrapper && slider) {
    sliderWrapper.style.display = "block";
    slider.max = sLabels.length - 1; // 1등부터 꼴등까지 범위 설정
    slider.value = -1; // 시작할 땐 선택 안 됨

    // 슬라이더를 스르륵 움직일 때마다 차트 업데이트!
    slider.oninput = function () {
      window.highlightPieSlice(this.value);
    };
  } else if (sliderWrapper) {
    sliderWrapper.style.display = "none";
  }

  // 🖥️ PC 전용 상세 패널 (순위표·KPI·월별) — 모바일은 CSS로 숨겨져 영향 없음
  try {
    renderDashPcExtra({
      compMap,
      sortedComps,
      totalQty,
      doneQty,
      mode: window.dashMode,
      barData,
      labels,
    });
  } catch (e) {
    console.warn("PC 대시보드 상세 렌더 실패:", e);
  }
} // renderDashCharts 종료

// 🖥️ [PC 전용] 대시보드 상세 패널: 업체별 순위표 + KPI 확장 + (연간) 월별표
function _dpxCard(t, v, accent) {
  return `<div class="dpx-card"${accent ? ` style="border-left-color:${accent}"` : ""}><div class="dpx-card-t">${t}</div><div class="dpx-card-v">${v}</div></div>`;
}
function renderDashPcExtra(d) {
  const box = document.getElementById("dashPcExtra");
  if (!box) return;
  const unitFull = window.dashUnit === "pal" ? "PAL" : "BOX";
  const total = d.totalQty || 0;
  const comps = (d.sortedComps || []).filter((c) => (d.compMap[c] || 0) > 0);
  const activeCount = comps.length;
  const topComp = comps[0] ? getShortName(comps[0]) : "-";
  const rate = d.mode === "month" && total > 0 ? Math.round((d.doneQty / total) * 100) : null;

  // KPI 카드 (확장)
  let kpi = `<div class="dpx-kpi">`;
  kpi += _dpxCard(`총 ${unitFull}`, total.toLocaleString());
  kpi += _dpxCard("완료율", rate === null ? "—" : rate + "%", rate === null ? null : rate >= 100 ? "#34c759" : rate > 50 ? "#0a84ff" : "#ff9f0a");
  kpi += _dpxCard("활성 업체", activeCount + "곳");
  kpi += _dpxCard("최다 업체", topComp);
  kpi += `</div>`;

  // 업체별 순위표 — 업체가 많으면 좌/우 반으로 갈라 한 줄에 두 표(행 위치 정렬)
  const _rankTbl = (list, startIdx) => {
    let t = `<table class="dpx-table"><thead><tr><th>#</th><th>업체</th><th class="dpx-num">${unitFull}</th><th class="dpx-num">점유율</th><th></th></tr></thead><tbody>`;
    list.forEach((c, i) => {
      const qty = d.compMap[c] || 0;
      const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
      const color = getCompanyColor(c).bg;
      t += `<tr><td class="dpx-rank">${startIdx + i + 1}</td><td><span class="dpx-dot" style="background:${color}"></span>${_esc(c)}</td><td class="dpx-num">${qty.toLocaleString()}</td><td class="dpx-num">${pct}%</td><td class="dpx-barcell"><span class="dpx-bar" style="width:${pct}%;background:${color}"></span></td></tr>`;
    });
    t += `</tbody></table>`;
    return t;
  };
  const rankTitle = `🏢 업체별 ${d.mode === "month" ? "월간" : "연간"} 순위`;
  let rankBlock;
  if (comps.length === 0) {
    rankBlock = `<div class="dpx-sec dpx-wide"><div class="dpx-sec-title">${rankTitle}</div><div class="dpx-empty">데이터가 없습니다</div></div>`;
  } else if (comps.length > 6) {
    const half = Math.ceil(comps.length / 2);
    rankBlock =
      `<div class="dpx-sec"><div class="dpx-sec-title">${rankTitle}</div>${_rankTbl(comps.slice(0, half), 0)}</div>` +
      `<div class="dpx-sec"><div class="dpx-sec-title">&nbsp;</div>${_rankTbl(comps.slice(half), half)}</div>`;
  } else {
    rankBlock = `<div class="dpx-sec dpx-wide"><div class="dpx-sec-title">${rankTitle}</div>${_rankTbl(comps, 0)}</div>`;
  }

  // 연간 모드: 월별 추이표 (2열로 좌 1~6월 / 우 7~12월)
  let monthlyBlock = "";
  if (d.mode === "year" && Array.isArray(d.barData)) {
    const ymax = Math.max(...d.barData, 1);
    const mTbl = (from, to) => {
      let t = `<table class="dpx-table"><thead><tr><th>월</th><th class="dpx-num">${unitFull}</th><th class="dpx-num">비중</th><th></th></tr></thead><tbody>`;
      for (let i = from; i < to; i++) {
        const v = d.barData[i] || 0;
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        t += `<tr><td class="dpx-rank">${i + 1}월</td><td class="dpx-num">${v.toLocaleString()}</td><td class="dpx-num">${pct}%</td><td class="dpx-barcell"><span class="dpx-bar" style="width:${Math.round((v / ymax) * 100)}%;background:#0a84ff"></span></td></tr>`;
      }
      t += `</tbody></table>`;
      return t;
    };
    monthlyBlock =
      `<div class="dpx-sec"><div class="dpx-sec-title">📅 월별 추이 (상반기)</div>${mTbl(0, 6)}</div>` +
      `<div class="dpx-sec"><div class="dpx-sec-title">📅 월별 추이 (하반기)</div>${mTbl(6, 12)}</div>`;
  }

  box.innerHTML = kpi + `<div class="dpx-grid">` + rankBlock + monthlyBlock + `</div>`;
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

// 달력 바닥에 있는 "하단 요약바"용 업데이트 (출고 최적화)
function updateStatsSummary() {
  let tPal = 0,
    dPal = 0;
  const process = (it) => {
    // 🚨 [출고 전용 로직 보존] TASK나 휴무, 점검 등 순수 작업은 진척률 통계(물량)에서 완벽히 제외합니다!
    let clean = String(it.company || "")
      .replace(/\[TASK\]/gi, "")
      .trim();
    if (
      String(it.company || "")
        .toUpperCase()
        .startsWith("[TASK]") ||
      /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean))
    )
      return;

    tPal += parseInt(it.pal) || 0;
    if (it.isDone === true || String(it.isDone) === "true") dPal += parseInt(it.pal) || 0;
  };

  for (let d = 1; d <= serverData.daysInMonth; d++) {
    if (serverData.monthData[d]) serverData.monthData[d].forEach(process);
  }

  let elType = document.getElementById("statsLabelType");
  if (elType) elType.innerText = "출고";
  let elD = document.getElementById("sumDonePal");
  if (elD) elD.innerText = dPal;
  let elT = document.getElementById("sumTotalPal");
  if (elT) elT.innerText = tPal;

  // 🚀 [V2 게이지 바 애니메이션 로직 탑재] 출고 전용으로 계산된 숫자를 바탕으로 게이지를 채웁니다.
  const barEl = document.getElementById("progressBar");
  if (barEl) {
    let percent = tPal === 0 ? 0 : Math.round((dPal / tPal) * 100);
    setTimeout(() => {
      barEl.style.width = `${percent}%`;
      if (percent === 100 && tPal > 0) {
        // 완료: 단색 대신 또렷한 그라데이션(초록→에메랄드→틸)
        barEl.style.background = "linear-gradient(90deg, #30d158 0%, #2bc7a0 55%, #00b8d4 100%)";
      } else {
        barEl.style.background = "linear-gradient(90deg, #0a84ff 0%, #34c759 100%)"; // 진행중 파랑
      }
    }, 100);
  }
}

function closeModalOnBgClick(e) {
  if (isLongPress || isMultiMode) return;
  if (e.target === document.getElementById("modal")) {
    // mousedown이 모달 내부에서 시작된 드래그라면 닫지 않음
    // (모달 안에서 텍스트 선택 후 바깥에서 손 떼는 경우 방지)
    if (window._modalMdTarget && window._modalMdTarget !== e.target) return;
    document.getElementById("modal").style.display = "none";
    clearClickedHighlight();
  }
}
function toggleTheme() {
  const body = document.body;
  const themeBtn = document.querySelector(".theme-toggle");
  if (isDarkMode) {
    body.classList.add("light-mode");
    isDarkMode = false;
    if (themeBtn) themeBtn.innerText = "🌙";
    localStorage.setItem("cal_theme", "light");
    // 🚨 html(documentElement) 배경도 같이 전환 (인라인 테마 스크립트가 칠한 값 갱신)
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

let tempEditColorObj = null;
let tempEditColorIdx = null;

// =====================================================
// 📈 [V3.4] 크로스 연도 정밀 비교 그리드 (글로벌 Max, 스르륵 삭제, 독립옵션 적용)
// =====================================================
let compareMonthsList = [];
let compareSortTargetKey = null;
let compareSortOrder = "desc";
let crossPickerTempYear = new Date().getFullYear();
let tempSelectedMonthsForPicker = [];

// 💡 [신규] 정밀비교 전용 단위(P/B) 토글
window.compareUnit = "pal";
function setCompareUnit(unit) {
  window.compareUnit = unit;
  document.getElementById("btnCompPal").classList.toggle("active", unit === "pal");
  document.getElementById("btnCompBox").classList.toggle("active", unit === "box");
  renderCompareGridV3();
}

function switchDashTab(tabName) {
  const tabSummaryBtn = document.getElementById("tabSummary");
  const tabCompareBtn = document.getElementById("tabCompare");
  const summaryView = document.getElementById("dashSummaryView");
  const compareView = document.getElementById("dashCompareView");

  if (tabName === "summary") {
    tabSummaryBtn.classList.add("active");
    tabCompareBtn.classList.remove("active");
    summaryView.style.display = "block";
    compareView.style.display = "none";
  } else if (tabName === "compare") {
    tabSummaryBtn.classList.remove("active");
    tabCompareBtn.classList.add("active");
    summaryView.style.display = "none";
    compareView.style.display = "block";
    renderCompareTags();
    renderCompareInlinePicker();
  }
}

// 🖥️ [PC 전용] 인라인 월 선택기 — 연도 스텝퍼 + 12개월 토글(클릭 즉시 비교)
let compareInlineYear = null;
function renderCompareInlinePicker() {
  const box = document.getElementById("compareInlinePicker");
  if (!box) return;
  if (compareInlineYear === null) {
    compareInlineYear =
      compareMonthsList.length > 0 ? compareMonthsList[compareMonthsList.length - 1].y : parseInt(serverData.year, 10);
  }
  let cells = "";
  for (let m = 1; m <= 12; m++) {
    const on = compareMonthsList.some((it) => it.y === compareInlineYear && it.m === m);
    cells += `<button class="cmi-m${on ? " on" : ""}" onclick="toggleCompareInline(${compareInlineYear}, ${m})">${m}월</button>`;
  }
  box.innerHTML =
    `<div class="cmi-head">` +
    `<button class="cmi-nav" onclick="stepCompareInlineYear(-1)">‹</button>` +
    `<span class="cmi-year">${compareInlineYear}년</span>` +
    `<button class="cmi-nav" onclick="stepCompareInlineYear(1)">›</button>` +
    `<span class="cmi-hint">월을 눌러 바로 비교에 추가/제거</span>` +
    `</div><div class="cmi-grid">${cells}</div>`;
}
function stepCompareInlineYear(off) {
  compareInlineYear += off;
  renderCompareInlinePicker();
}
function toggleCompareInline(y, m) {
  const i = compareMonthsList.findIndex((it) => it.y === y && it.m === m);
  if (i !== -1) {
    removeCompareMonth(i); // 제거 + 그리드 갱신
  } else {
    compareMonthsList.push({ y, m });
    compareMonthsList.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.m - b.m));
    renderCompareTags();
    executeCompare(); // 추가 즉시 데이터 불러와 비교 (없는 달은 서버 fetch)
  }
  renderCompareInlinePicker();
}

function renderCompareTags() {
  const container = document.getElementById("compareTagsArea");
  if (!container) return;
  let html = "";
  compareMonthsList.forEach((item, idx) => {
    html += `<div class="compare-tag">
                         ${String(item.y).slice(2)}년 ${item.m}월
                         <div class="compare-tag-remove" onclick="removeCompareMonth(${idx})">✕</div>
                       </div>`;
  });
  html += `<button class="compare-add-btn" onclick="openCrossMonthPicker()">+ 연/월 추가</button>`;
  container.innerHTML = html;
}

// 💡 [수정] 태그 삭제 시 표가 꺼지지 않고 스르륵 갱신됨
function removeCompareMonth(idx) {
  let removedItem = compareMonthsList[idx];
  let removedKey = `${removedItem.y}-${removedItem.m}`;

  compareMonthsList.splice(idx, 1);
  renderCompareTags();
  if (typeof renderCompareInlinePicker === "function") renderCompareInlinePicker();

  if (compareMonthsList.length === 0) {
    document.getElementById("compareGridArea").style.display = "none";
  } else if (document.getElementById("compareGridArea").style.display === "block") {
    if (compareSortTargetKey === removedKey) compareSortTargetKey = null; // 기준열 삭제되면 기본 정렬로
    renderCompareGridV3();
  }
}

function openCrossMonthPicker() {
  tempSelectedMonthsForPicker = JSON.parse(JSON.stringify(compareMonthsList));
  if (compareMonthsList.length > 0) crossPickerTempYear = compareMonthsList[compareMonthsList.length - 1].y;
  else crossPickerTempYear = parseInt(serverData.year, 10);
  renderCrossPicker();
  document.getElementById("crossMonthPickerModal").style.display = "flex";
}

function changeCrossPickerYear(offset) {
  crossPickerTempYear += offset;
  renderCrossPicker();
}

function renderCrossPicker() {
  document.getElementById("crossPickerYearText").innerText = `${crossPickerTempYear}년`;
  let gridHtml = "";
  for (let i = 1; i <= 12; i++) {
    let isSelected = tempSelectedMonthsForPicker.some((item) => item.y === crossPickerTempYear && item.m === i)
      ? "current"
      : "";
    // onclick은 PC 폴백용, touchstart가 모바일에서 즉시 실행됨
    gridHtml += `<button class="month-btn ${isSelected}" data-m="${i}" onclick="toggleCompareMonth(${crossPickerTempYear}, ${i})">${i}월</button>`;
  }
  const grid = document.getElementById("crossPickerMonthGrid");
  grid.innerHTML = gridHtml;
  // touchstart 위임: 손가락 닿는 즉시 반응, 다중 터치도 각자 처리됨
  grid.ontouchstart = function (e) {
    const btn = e.target.closest(".month-btn");
    if (!btn) return;
    e.preventDefault(); // 이후 click 이벤트 차단 (이중 실행 방지)
    toggleCompareMonth(crossPickerTempYear, parseInt(btn.dataset.m));
  };
}

function toggleCompareMonth(y, m) {
  let existingIdx = tempSelectedMonthsForPicker.findIndex((item) => item.y === y && item.m === m);
  const willBeSelected = existingIdx === -1;
  if (existingIdx !== -1) tempSelectedMonthsForPicker.splice(existingIdx, 1);
  else tempSelectedMonthsForPicker.push({ y: y, m: m });
  const btns = document.querySelectorAll("#crossPickerMonthGrid .month-btn");
  if (btns[m - 1]) btns[m - 1].classList.toggle("current", willBeSelected);
}

function confirmCrossPicker() {
  if (tempSelectedMonthsForPicker.length === 0) {
    showToast("최소 1개 이상의 월을 선택해주세요.", 1500);
    return;
  }
  compareMonthsList = JSON.parse(JSON.stringify(tempSelectedMonthsForPicker));
  compareMonthsList.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.m - b.m;
  });
  document.getElementById("crossMonthPickerModal").style.display = "none";
  document.getElementById("compareGridArea").style.display = "none";
  renderCompareTags();
}

// 🚀 데이터 비교 실행 (연간 요약본 버림! 원본 캘린더 데이터를 직접 긁어옴)
function executeCompare() {
  if (compareMonthsList.length === 0) {
    showToast("비교할 월을 추가해주세요.", 1500);
    return;
  }

  const btn = document.getElementById("compareExecBtn");
  btn.innerText = "⏳ 데이터 불러오는 중...";
  btn.style.pointerEvents = "none";
  btn.style.opacity = "0.7";

  // 🚨 [핵심 픽스] 선택한 월들의 원본 캘린더 데이터(cal_cache)가 내 폰에 있는지 검사하고 없으면 서버에서 즉시 가져옴!
  let fetchPromises = [];
  compareMonthsList.forEach((item) => {
    let cacheKey = `cal_cache_${currentType}_${item.y}_${item.m}`;
    if (!localStorage.getItem(cacheKey)) {
      fetchPromises.push(
        apiGet({ type: currentType, year: item.y, month: item.m }).then((res) => {
          if (res === null) throw new Error("fetch failed");
          localStorage.setItem(cacheKey, JSON.stringify(typeof res === "string" ? JSON.parse(res) : res));
        }),
      );
    }
  });

  if (fetchPromises.length === 0) {
    btn.innerHTML = "📊 데이터 비교하기";
    btn.style.pointerEvents = "auto";
    btn.style.opacity = "1";
    renderCompareGridV3();
    return;
  }

  Promise.all(fetchPromises)
    .then(() => {
      btn.innerHTML = "📊 데이터 비교하기";
      btn.style.pointerEvents = "auto";
      btn.style.opacity = "1";
      renderCompareGridV3();
    })
    .catch((e) => {
      btn.innerHTML = "📊 데이터 비교하기";
      btn.style.pointerEvents = "auto";
      btn.style.opacity = "1";
      showToast("데이터를 불러오는데 실패했습니다.", 2500);
    });
}

let lastSortTime = 0;
function setCompareSort(key) {
  let now = Date.now();
  if (now - lastSortTime < 300) return; // 💡 안드로이드 더블 터치 방어
  lastSortTime = now;

  if (window.colDragVars && window.colDragVars.wasDragged) {
    window.colDragVars.wasDragged = false;
    return;
  }
  if (compareSortTargetKey === key) {
    compareSortOrder = compareSortOrder === "desc" ? "asc" : "desc";
  } else {
    compareSortTargetKey = key;
    compareSortOrder = "desc";
  }
  renderCompareGridV3();
}

function resetCompareSort() {
  compareSortTargetKey = null;
  compareSortOrder = "desc";
  renderCompareGridV3();
}

window.colDragVars = {
  active: false,
  startIdx: -1,
  ghost: null,
  timer: null,
  wasDragged: false,
  sourceTh: null,
  lastDropTargetIdx: -1,
  startX: 0,
  startY: 0,
};

function startColDrag(e, idx) {
  if (e.button !== undefined && e.button !== 0) return;
  colDragVars.wasDragged = false;
  let th = e.currentTarget;
  let clientX = e.touches ? e.touches[0].clientX : e.clientX;
  let clientY = e.touches ? e.touches[0].clientY : e.clientY;
  colDragVars.startX = clientX;
  colDragVars.startY = clientY;

  colDragVars.timer = setTimeout(() => {
    colDragVars.active = true;
    colDragVars.startIdx = idx;
    if (navigator.vibrate) navigator.vibrate(50);
    colDragVars.sourceTh = th;
    let ghost = th.cloneNode(true);
    ghost.classList.remove("dragging-source", "active-sort");
    ghost.style.position = "fixed";
    ghost.style.zIndex = "99999";
    ghost.style.opacity = "0.95";
    ghost.style.pointerEvents = "none";
    ghost.style.background = "#0a84ff";
    ghost.style.color = "#fff";
    ghost.style.borderRadius = "8px";
    ghost.style.width = th.offsetWidth + "px";
    ghost.style.border = "2px solid #fff";
    ghost.style.boxShadow = "0 10px 25px rgba(0,0,0,0.4)";
    ghost.style.transform = "scale(1.05)";
    ghost.style.left = clientX - th.offsetWidth / 2 + "px";
    ghost.style.top = clientY - 25 + "px";
    document.body.appendChild(ghost);
    colDragVars.ghost = ghost;
    th.classList.add("dragging-source");
  }, 350);
}

function moveColGhost(e) {
  let clientX = e.touches ? e.touches[0].clientX : e.clientX;
  let clientY = e.touches ? e.touches[0].clientY : e.clientY;

  if (!colDragVars.active || !colDragVars.ghost) {
    if (colDragVars.timer && e.type.includes("move")) {
      let dx = Math.abs(clientX - colDragVars.startX);
      let dy = Math.abs(clientY - colDragVars.startY);
      if (dx > 10 || dy > 10) {
        clearTimeout(colDragVars.timer);
        colDragVars.timer = null;
      }
    }
    return;
  }

  colDragVars.ghost.style.left = clientX - colDragVars.ghost.offsetWidth / 2 + "px";
  colDragVars.ghost.style.top = clientY - 25 + "px";
  if (e.cancelable) e.preventDefault();

  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
  colDragVars.lastDropTargetIdx = -1;

  let dropTarget = document.elementFromPoint(clientX, clientY);
  if (!dropTarget) return;

  let targetTh = dropTarget.closest(".compare-th");
  let targetTd = dropTarget.closest(".compare-td");
  let hoverColIdx = -1;
  if (targetTh && targetTh.dataset.colidx !== undefined) hoverColIdx = parseInt(targetTh.dataset.colidx, 10);
  else if (targetTd && targetTd.dataset.colidx !== undefined) hoverColIdx = parseInt(targetTd.dataset.colidx, 10);

  if (hoverColIdx !== -1 && hoverColIdx !== colDragVars.startIdx) {
    colDragVars.lastDropTargetIdx = hoverColIdx;
    let thToHighlight = document.querySelector(`.compare-th[data-colidx="${hoverColIdx}"]`);
    if (thToHighlight) thToHighlight.classList.add("drag-over");
    document.querySelectorAll(`.compare-td[data-colidx="${hoverColIdx}"]`).forEach((td) => {
      td.classList.add("drag-over");
    });
  }
}

function endColDrag(e, key) {
  if (!colDragVars.active) {
    if (colDragVars.timer) {
      clearTimeout(colDragVars.timer);
      colDragVars.timer = null;
      if (e.type === "touchend" || e.type === "mouseup") setCompareSort(key);
    }
    return;
  }
  if (colDragVars.timer) clearTimeout(colDragVars.timer);
  colDragVars.wasDragged = true;
  colDragVars.active = false;

  if (colDragVars.sourceTh) {
    colDragVars.sourceTh.classList.remove("dragging-source");
    colDragVars.sourceTh = null;
  }
  if (colDragVars.ghost) {
    colDragVars.ghost.remove();
    colDragVars.ghost = null;
  }
  document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));

  let dropIdx = colDragVars.lastDropTargetIdx;
  if (dropIdx !== -1 && colDragVars.startIdx !== -1 && colDragVars.startIdx !== dropIdx) {
    let item = compareMonthsList.splice(colDragVars.startIdx, 1)[0];
    compareMonthsList.splice(dropIdx, 0, item);
    renderCompareGridV3();
  }
  colDragVars.startIdx = -1;
  colDragVars.lastDropTargetIdx = -1;
}

// 📊 V3.7 그리드 렌더링 (원시 데이터 추출 기반 + P/B 완벽 분리 + 다크모드 색상 최적화)
function renderCompareGridV3() {
  document.getElementById("compareGridArea").style.display = "block";

  let colCount = compareMonthsList.length;
  let tableWidth = "100%";
  if (colCount >= 4) tableWidth = colCount * 33.333 + "%";
  document.getElementById("compareTable").style.width = tableWidth;
  document.getElementById("compareTable").style.minWidth = tableWidth;

  let theadHtml = "<tr>";
  let cUnit = window.compareUnit || "pal";
  let unitStr = cUnit === "pal" ? "P" : "B";
  let includePending = document.getElementById("compIncludePendingCheck")?.checked;

  // 🚨 [다크모드 패치] 투명도 조절로 칙칙함 해결!
  let isLight = document.body.classList.contains("light-mode");
  let barAlpha = isLight ? "40" : "85";

  compareMonthsList.forEach((item, index) => {
    let key = `${item.y}-${item.m}`;
    let sortClass = compareSortTargetKey === key ? "active-sort" : "";
    let sortIconStr = "";
    if (compareSortTargetKey === key) sortIconStr = compareSortOrder === "desc" ? " 🔽" : " 🔼";

    theadHtml += `<th class="compare-th ${sortClass}" data-colidx="${index}" 
                                ontouchstart="startColDrag(event, ${index})" 
                                ontouchmove="moveColGhost(event)" 
                                ontouchend="endColDrag(event, '${key}')"
                                onmousedown="startColDrag(event, ${index})"
                                onmousemove="moveColGhost(event)"
                                onmouseup="endColDrag(event, '${key}')">
                                ${String(item.y).slice(2)}년 ${item.m}월${sortIconStr}
                            </th>`;
  });
  theadHtml += "</tr>";
  document.getElementById("compareThead").innerHTML = theadHtml;

  let compStats = {};
  let maxVolPerCol = {};

  compareMonthsList.forEach((item) => {
    let key = `${item.y}-${item.m}`;
    maxVolPerCol[key] = 0;

    // 🚨 [핵심] 요약본 말고, 진짜 "원본 달력"을 직접 뜯어서 P/B를 완벽하게 꺼냄!
    let cached = localStorage.getItem(`cal_cache_${currentType}_${item.y}_${item.m}`);
    if (cached) {
      try {
        let mData = JSON.parse(cached);
        let days = mData.daysInMonth || 31;

        const processItem = (it) => {
          let clean = String(it.company || it.bl || "")
            .replace(/\[TASK\]/gi, "")
            .trim();
          let isTask =
            String(it.company || it.bl || "")
              .toUpperCase()
              .startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(getFullName(clean));
          if (!isTask) {
            let stdName = getFullName(clean);
            if (!compStats[stdName]) compStats[stdName] = { name: stdName, vols: {} };

            // cUnit('pal' / 'box')에 맞춰 수량을 콕 집어옴
            let vol = parseInt(it[cUnit]) || 0;
            compStats[stdName].vols[key] = (compStats[stdName].vols[key] || 0) + vol;
          }
        };

        if (mData.monthData) {
          for (let d = 1; d <= days; d++) {
            if (mData.monthData[d]) mData.monthData[d].forEach(processItem);
          }
        }

        // 미정건 합산
        // 🚨 버그 수정: 미정건은 모든 달에 더하지 않고, 오직 '당월(현재 띄워진 달력)' 칸에만 더함!
        if (includePending && mData.pendingItems && item.y === serverData.year && item.m === serverData.month) {
          mData.pendingItems.forEach(processItem);
        }
      } catch (e) {}
    }

    Object.values(compStats).forEach((c) => {
      if ((c.vols[key] || 0) > maxVolPerCol[key]) maxVolPerCol[key] = c.vols[key];
    });
  });

  let tbodyHtml = "";

  // 🚀 상태 A: 기본 정렬 (증감 표시 없음, 독립 Max)
  if (compareSortTargetKey === null) {
    let sortedLists = {};
    let maxRows = 0;
    compareMonthsList.forEach((item) => {
      let key = `${item.y}-${item.m}`;
      let list = Object.values(compStats)
        .map((c) => ({ name: c.name, vol: c.vols[key] || 0 }))
        .filter((c) => c.vol > 0)
        .sort((a, b) => b.vol - a.vol);
      sortedLists[key] = list;
      if (list.length > maxRows) maxRows = list.length;
    });

    for (let r = 0; r < maxRows; r++) {
      tbodyHtml += "<tr>";
      compareMonthsList.forEach((item, index) => {
        let key = `${item.y}-${item.m}`;
        let dataItem = sortedLists[key][r];

        if (dataItem) {
          let cObj = getCompanyColor(dataItem.name);
          let vol = dataItem.vol;
          let percent = maxVolPerCol[key] > 0 ? (vol / maxVolPerCol[key]) * 100 : 0;

          // 💡 다크모드 색상 최적화 반영
          let bgCss = `background: linear-gradient(to right, ${cObj.bg}${barAlpha} ${percent}%, transparent ${percent}%);`;

          tbodyHtml += `
                            <td class="compare-td" style="${bgCss}" data-colidx="${index}">
                               <div class="compare-cell">
                                  <div class="comp-info"><span class="comp-name-txt">${getShortName(dataItem.name)}</span></div>
                                  <div class="vol-info"><span class="vol-txt">${vol}${unitStr}</span></div>
                               </div>
                            </td>`;
        } else {
          tbodyHtml += `<td class="compare-td" data-colidx="${index}"></td>`;
        }
      });
      tbodyHtml += "</tr>";
    }
  }
  // 🚀 상태 B: 행 맞춤 정렬 (글로벌 Max 적용, 증감 표시 O)
  else {
    let sortedComps = Object.values(compStats)
      .filter((c) => Object.values(c.vols).some((v) => v > 0))
      .sort((a, b) => {
        let volA = a.vols[compareSortTargetKey] || 0;
        let volB = b.vols[compareSortTargetKey] || 0;
        return compareSortOrder === "desc" ? volB - volA : volA - volB;
      });

    let globalMaxVol = 0;
    sortedComps.forEach((comp) => {
      compareMonthsList.forEach((item) => {
        let vol = comp.vols[`${item.y}-${item.m}`] || 0;
        if (vol > globalMaxVol) globalMaxVol = vol;
      });
    });

    sortedComps.forEach((comp) => {
      let cObj = getCompanyColor(comp.name);
      tbodyHtml += "<tr>";

      compareMonthsList.forEach((item, index) => {
        let key = `${item.y}-${item.m}`;
        let vol = comp.vols[key] || 0;
        let percent = globalMaxVol > 0 ? (vol / globalMaxVol) * 100 : 0;

        // 💡 다크모드 색상 최적화 반영
        let bgCss = `background: linear-gradient(to right, ${cObj.bg}${barAlpha} ${percent}%, transparent ${percent}%);`;

        let rateHtml = "";
        if (key !== compareSortTargetKey) {
          let baseVol = comp.vols[compareSortTargetKey] || 0;
          if (baseVol > 0) {
            let diff = vol - baseVol;
            let rate = Math.round((diff / baseVol) * 100);
            let diffStr = diff > 0 ? `+${diff}` : `${diff}`;
            if (rate > 0) rateHtml = `<span class="rate-txt rate-up">▲${diffStr} (${rate}%)</span>`;
            else if (rate < 0)
              rateHtml = `<span class="rate-txt rate-down">▼${Math.abs(diff)} (${Math.abs(rate)}%)</span>`;
            else rateHtml = `<span class="rate-txt rate-zero">-</span>`;
          }
        } else {
          rateHtml = `<span class="rate-txt rate-zero" style="opacity:0.6;">기준</span>`;
        }

        let opClass = vol === 0 ? 'style="opacity: 0.4;"' : "";

        tbodyHtml += `
                        <td class="compare-td" style="${bgCss}" data-colidx="${index}">
                           <div class="compare-cell" ${opClass}>
                              <div class="comp-info"><span class="comp-name-txt">${getShortName(comp.name)}</span></div>
                              <div class="vol-info"><span class="vol-txt">${vol}${unitStr}</span>${rateHtml}</div>
                           </div>
                        </td>`;
      });
      tbodyHtml += "</tr>";
    });
  }

  if (tbodyHtml === "")
    tbodyHtml = `<tr><td colspan="10" style="text-align:center; padding:20px; font-weight:bold; color:var(--text-sub);">선택된 월에 출고 데이터가 없습니다.</td></tr>`;
  document.getElementById("compareTbody").innerHTML = tbodyHtml;
}

// =====================================================
// 🏢 [미니 CRM] 업체 정보 관리 시스템 (화면 분할 마스터-디테일 V3)
// =====================================================
compInfoDB = JSON.parse(localStorage.getItem("COMP_INFO_DB") || "{}"); // (위에서 이미 let 선언됨)
let selectedCrmComp = null; // 💡 현재 선택된 업체 기억

function getPillHtml(compName) {
  let info = compInfoDB[compName];
  if (!info) return "";
  if (info.ic && info.oc && info.wc) return `<span class="type-pill pill-all">ALL</span>`;
  let html = "";
  if (info.ic) html += `<span class="type-pill pill-ic">IC</span>`;
  if (info.oc) html += `<span class="type-pill pill-oc">OC</span>`;
  if (info.wc) html += `<span class="type-pill pill-wc">WC</span>`;
  return html;
}

// 💡 1. 업체 리스트 모달창 열기 (서버 기다리지 않고 즉시 오픈!)
// 🔁 [1회성 마이그레이션] 하드코딩 기본 업체를 compInfoDB로 이관
//    반드시 '서버 최신 compInfoDB를 받은 직후'에만 호출할 것 (기존 데이터 보존)
function migrateFixedCompanies() {
  if (localStorage.getItem("crm_fixed_migrated_v1")) return;
  let changed = false;
  fixedCompanies.forEach((name) => {
    if (!compInfoDB[name]) {
      compInfoDB[name] = {
        shortName: compShortMap[name] || name.substring(0, 2),
        ic: false,
        oc: false,
        wc: false,
        etc: "",
        addr: "",
        phone: "",
        time: "",
      };
      changed = true;
    }
  });
  if (changed) {
    localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
    apiCall({ source: "vercel", action: "SAVE_COMP_INFO_DB", data: compInfoDB });
  }
  localStorage.setItem("crm_fixed_migrated_v1", "1");
}

function openCompListModal() {
  // 1단계: [즉시 실행] 내 폰에 저장된 데이터로 0.1초 만에 창부터 엽니다.
  document.getElementById("btnAddNewComp").style.display = isAdmin ? "block" : "none";
  renderCompList(); // 일단 현재 데이터로 리스트 그리기
  document.getElementById("compListModal").style.display = "flex";

  // 2단계: [백그라운드] 창이 떠 있는 동안 서버에서 최신 DB를 몰래 가져옵니다.
  apiCall({ source: "vercel", action: "GET_COMP_INFO_DB" }).then(function (dbData) {
    if (!dbData) return;
    const prevSig = JSON.stringify(compInfoDB);
    compInfoDB = dbData;
    localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
    migrateFixedCompanies();
    const changed = JSON.stringify(compInfoDB) !== prevSig;
    if (changed) {
      renderCompList(); // 데이터 바뀐 경우에만 재렌더
      renderCalendar();
    }
    // 데이터 동일하면 태그 목록도 그대로 — 깜빡임 없음
  });
}

// 💡 상단 태그(Pill) 목록만 그리는 함수
function renderCompList() {
  // 🚨 [스마트 정렬 필터] (주), (유), (사), (재) 및 띄어쓰기를 모두 무시하고 알맹이만 추출해서 가나다 정렬!
  let allComps = Object.keys(compInfoDB).sort((a, b) => {
    const cleanStr = (str) =>
      str
        .replace(/\(주\)|\(유\)|\(사\)|\(재\)/g, "")
        .replace(/\s+/g, "")
        .trim();
    let cleanA = cleanStr(a);
    let cleanB = cleanStr(b);
    return cleanA.localeCompare(cleanB);
  });

  // 🚨 총 업체 수 실시간 갱신 ('업체' 표기)
  let countEl = document.getElementById("compTotalCount");
  if (countEl) countEl.innerText = `${allComps.length}업체`;

  let html = "";
  allComps.forEach((comp) => {
    let cObj = getCompanyColor(comp);
    let isActive = comp === selectedCrmComp ? "active" : "";

    // 업체명에 따옴표/특수문자가 있어도 안전하도록 data 속성 + 위임 방식 사용
    html += `<button class="comp-tag-btn ${isActive}"
                          style="background:${cObj.bg}; color:${cObj.cMain};"
                          data-comp="${_esc(comp)}">${_esc(comp)}</button>`;
  });
  const cont = document.getElementById("compTagsContainer");
  cont.innerHTML = html;
  // 이벤트 위임 (한 번만 바인딩)
  if (!cont._bound) {
    cont.addEventListener("click", (e) => {
      const btn = e.target.closest(".comp-tag-btn");
      if (btn && btn.dataset.comp != null) selectCrmComp(btn.dataset.comp);
    });
    cont._bound = true;
  }

  if (!selectedCrmComp || !allComps.includes(selectedCrmComp)) {
    if (allComps.length > 0) selectCrmComp(allComps[0]);
  } else {
    renderCompDetail(selectedCrmComp);
  }
}

// 💡 태그를 터치했을 때 발동 (액티브 효과 & 하단 상세 렌더링)
function selectCrmComp(comp) {
  selectedCrmComp = comp;
  document.querySelectorAll(".comp-tag-btn").forEach((btn) => {
    if (btn.dataset.comp === comp) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  renderCompDetail(comp);
}

// 💡 하단 상세 정보를 그리는 함수 (하나만 그리므로 i 변수가 필요 없음!)
function renderCompDetail(comp) {
  // 🚨 수정창 열 때마다 이전에 고르다 만 임시 색상 리셋!
  tempEditColorObj = null;
  tempEditColorIdx = null;

  let info = compInfoDB[comp] || {
    shortName: "",
    ic: false,
    oc: false,
    wc: false,
    etc: "",
    addr: "",
    phone: "",
    time: "",
  };
  let pillStr = getPillHtml(comp);
  let currentShortName = info.shortName || getShortName(comp);

  let html = `
              <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:10px; padding: 0 5px;">
                  <div style="display:flex; flex-direction:column; gap:4px;">
                      <span style="font-size:0.75em; font-weight:800; color:#0a84ff;">MASTER BUSINESS NAME</span>
                      <div style="font-size:1.4em; font-weight:900; letter-spacing:-0.5px; color:var(--text-main);">${_esc(comp)}</div>
                  </div>
                  <div class="pill-group" style="margin-bottom:5px;">${pillStr}</div>
              </div>
              
              <div class="comp-detail-wrapper">
                  <div id="crm-read-mode" style="display:flex; flex-direction:column; gap:18px;">
                      <div class="info-row"><span class="info-label">📅 달력 약어</span><span class="info-value" style="color:#0a84ff; font-size:1.1em;">${currentShortName}</span></div>
                      <div class="info-row"><span class="info-label">📍 주소</span><span class="info-value" style="white-space:pre-wrap; line-height:1.4;">${info.addr || "-"}</span></div>
                      <div class="info-row"><span class="info-label">📞 연락처</span><span class="info-value">${info.phone || "-"}</span></div>
                      <div class="info-row"><span class="info-label">🕒 배송 시간</span><span class="info-value">${info.time || "-"}</span></div>
                      <div class="info-row"><span class="info-label">📝 특이사항</span><span class="info-value" style="white-space:pre-wrap; line-height:1.5; background:rgba(255,159,10,0.05); padding:10px; border-radius:10px; border-left:4px solid #ff9f0a;">${info.etc || "-"}</span></div>
                      ${isAdmin ? `<button class="edit-toggle-btn" style="margin-top:10px; width:100%; padding:15px; font-size:1em; border-radius:14px; background:var(--btn-bg); color:var(--text-main); font-weight:900;" onclick="swapToEditMode()">✏️ 업체명 및 정보 수정하기</button>` : ""}
                  </div>
                  
                  <div id="crm-edit-mode" style="display:none; flex-direction:column; gap:12px;">
                      <div class="info-row">
                          <span class="info-label">🏢 업체 풀네임 (마스터 명칭)</span>
                          <input type="text" id="crm-edit-fullname" class="edit-input" value="${_esc(comp)}" style="border:2px solid #0a84ff; background:var(--bg-color);">
                      </div>
                      
                      <button type="button" style="width:100%; padding:14px; border-radius:12px; background:rgba(10,132,255,0.1); color:#0a84ff; border:1px solid rgba(10,132,255,0.3); font-weight:900; font-size:0.95em; cursor:pointer; transition:0.2s;" 
                              onmousedown="this.style.transform='scale(0.98)'" onmouseup="this.style.transform='scale(1)'"
                              onclick="openColorPickerV3(selectedCrmComp)">🎨 달력 표시 색상 변경</button>
                      
                      <div id="crm-color-picker-area" style="display:none;"></div>

                      <div style="display:flex; justify-content:space-around; background:var(--bg-color); padding:12px; border-radius:12px; margin-bottom:5px;">
                         <label style="font-weight:900;"><input type="checkbox" id="crm-edit-ic" ${info.ic ? "checked" : ""}> IC</label>
                         <label style="font-weight:900;"><input type="checkbox" id="crm-edit-oc" ${info.oc ? "checked" : ""}> OC</label>
                         <label style="font-weight:900;"><input type="checkbox" id="crm-edit-wc" ${info.wc ? "checked" : ""}> WC</label>
                      </div>
                      
                      <div class="info-row"><span class="info-label">📅 달력 표시 약어</span><input type="text" id="crm-edit-short" class="edit-input" value="${currentShortName}" placeholder="예: 메뱅"></div>
                      <div class="info-row"><span class="info-label">📍 주소</span><textarea id="crm-edit-addr" class="edit-input auto-expand" oninput="autoResizeTextarea(this)" rows="1" placeholder="주소를 입력하세요">${info.addr || ""}</textarea></div>
                      <div class="info-row"><span class="info-label">📞 연락처</span><input type="text" id="crm-edit-phone" class="edit-input" value="${info.phone || ""}"></div>
                      <div class="info-row"><span class="info-label">🕒 배송시간</span><input type="text" id="crm-edit-time" class="edit-input" value="${info.time || ""}"></div>
                      <div class="info-row"><span class="info-label">📝 특이사항</span><textarea id="crm-edit-etc" class="edit-input auto-expand" oninput="autoResizeTextarea(this)" rows="1" placeholder="줄바꿈은 엔터입니다">${info.etc || ""}</textarea></div>
                      
                      <div style="display:flex; gap:10px; margin-top:10px;">
                          <button class="save-btn" style="flex:2; padding:15px; font-weight:900;" onclick="saveCompEdit(selectedCrmComp)">💾 변경사항 저장</button>
                          <button class="cancel-btn" style="flex:1; padding:15px; font-weight:800;" onclick="cancelEditMode()">취소</button>
                      </div>
                      <button class="delete-btn" style="width:100%; margin-top:5px; padding:12px; font-size:0.9em; border:none; background:transparent; color:#ff3b30; text-decoration:underline;" onclick="deleteCompInfo(selectedCrmComp)">🗑️ 이 업체 정보 완전히 삭제</button>
                  </div>
              </div>
          `;
  document.getElementById("compDetailContainer").innerHTML = html;
}

function swapToEditMode() {
  document.getElementById("crm-read-mode").style.display = "none";
  document.getElementById("crm-edit-mode").style.display = "flex";

  // 🚨 수정 모드 진입 시 바깥 껍데기를 파란색으로 하이라이트!
  let wrapper = document.querySelector(".comp-detail-wrapper");
  if (wrapper) {
    wrapper.style.borderColor = "#0a84ff";
    wrapper.style.boxShadow = "0 0 0 2px rgba(10,132,255,0.2)";
  }

  // 텍스트 박스들 크기 자동 세팅
  document.querySelectorAll("textarea.auto-expand").forEach((el) => autoResizeTextarea(el));
}

function cancelEditMode() {
  document.getElementById("crm-edit-mode").style.display = "none";
  document.getElementById("crm-read-mode").style.display = "flex";

  // 🚨 취소 시 바깥 껍데기 색상 복구
  let wrapper = document.querySelector(".comp-detail-wrapper");
  if (wrapper) {
    wrapper.style.borderColor = "var(--border-color)";
    wrapper.style.boxShadow = "inset 0 2px 10px rgba(0,0,0,0.05)";
  }
}
async function saveCompEdit(oldCompName) {
  const newCompName = document.getElementById("crm-edit-fullname").value.trim();
  if (!newCompName) {
    showToast("업체 풀네임은 필수입니다.", 2000);
    return;
  }

  const newInfo = {
    shortName: document.getElementById("crm-edit-short").value.trim(),
    ic: document.getElementById("crm-edit-ic").checked,
    oc: document.getElementById("crm-edit-oc").checked,
    wc: document.getElementById("crm-edit-wc").checked,
    etc: document.getElementById("crm-edit-etc").value,
    addr: document.getElementById("crm-edit-addr").value,
    phone: document.getElementById("crm-edit-phone").value,
    time: document.getElementById("crm-edit-time").value,
  };

  // 이름이 바뀌었다면 이사 처리
  if (oldCompName !== newCompName) {
    if (compInfoDB[newCompName]) {
      showToast(`⚠️ [${newCompName}]은(는) 이미 등록된 업체명입니다.`, 2500);
      return;
    }
    if (await uiConfirm(`업체 명칭을 [${oldCompName}]에서 [${newCompName}]으로 변경하시겠습니까?`)) {
      delete compInfoDB[oldCompName];

      // 기존 색상 정보도 새 이름으로 인계!
      if (customColors[oldCompName] !== undefined) {
        customColors[newCompName] = customColors[oldCompName];
        delete customColors[oldCompName];
      }
    } else return;
  }

  compInfoDB[newCompName] = newInfo;
  selectedCrmComp = newCompName;

  // 🚨 [핵심 버그 수정!] 피커에서 색상을 골랐다면 실제 글로벌 컬러 DB에 강제 세이브!!
  let _crmColorNote = "";
  if (tempEditColorObj && tempEditColorIdx !== null) {
    _crmColorNote = newCompName; // 업체정보 저장 알림 1건에 색상 변경 함께 표기
    companyColors[newCompName] = tempEditColorObj; // 메모리 갱신
    customColors[newCompName] = tempEditColorIdx; // 로컬 캐시 갱신
    localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
    apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", compName: newCompName, colorIdx: tempEditColorIdx });

    // 저장했으니 임시 메모리 청소
    tempEditColorObj = null;
    tempEditColorIdx = null;
  } else if (oldCompName !== newCompName) {
    // 이름만 바꾼 경우: 새 이름 저장 + 구 이름 DB에서 제거
    localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
    apiCall({
      source: "vercel",
      action: "SAVE_GLOBAL_COLOR",
      compName: newCompName,
      colorIdx: customColors[newCompName],
      deleteNames: [oldCompName],
    });
  }

  localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
  apiCall({ source: "vercel", action: "SAVE_COMP_INFO_DB", data: compInfoDB, colorNote: _crmColorNote });

  showToast("💾 업체 정보 및 색상이 저장되었습니다.", 1500);
  renderCompList();
  renderCalendar(); // 달력 즉시 새로고침 (색상 완벽 반영됨!)
}

async function deleteCompInfo(comp) {
  if (
    !(await uiConfirm(
      `⚠️ 정말 [${comp}] 업체를 목록에서 완전히 삭제하시겠습니까?\n\n※ 이미 등록된 달력 일정에는 영향을 주지 않습니다.`,
      { danger: true },
    ))
  )
    return;
  delete compInfoDB[comp];
  localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
  apiCall({ source: "vercel", action: "SAVE_COMP_INFO_DB", data: compInfoDB });
  // 색상 슬롯도 함께 해제
  if (customColors[comp] !== undefined) {
    delete customColors[comp];
    delete companyColors[comp];
    localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
    apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", deleteNames: [comp] });
  }
  showToast(`🗑️ 삭제되었습니다.`);

  // 삭제 후 선택 초기화
  selectedCrmComp = null;
  renderCompList();
  renderCalendar();
}

// 신규 등록 로직
let _ncColorIdx = null; // 신규 업체 선택 색상 인덱스 (null = 자동)

function openNewCompModal() {
  document.getElementById("nc-full").value = "";
  document.getElementById("nc-short").value = "";
  document.getElementById("nc-ic").checked = false;
  document.getElementById("nc-oc").checked = false;
  document.getElementById("nc-wc").checked = false;
  document.getElementById("nc-etc").value = "";
  document.getElementById("nc-addr").value = "";
  document.getElementById("nc-phone").value = "";
  document.getElementById("nc-time").value = "";
  _ncColorIdx = null;
  const btn = document.getElementById("nc-color-btn");
  if (btn) { btn.textContent = "🎨 색상 선택 (선택 안 하면 자동)"; btn.style.background = "rgba(10,132,255,0.1)"; btn.style.color = "#0a84ff"; btn.style.border = "1px solid rgba(10,132,255,0.3)"; }
  const area = document.getElementById("nc-color-picker-area");
  if (area) area.style.display = "none";
  document.getElementById("newCompModal").style.display = "flex";
}

function openNcColorPicker() {
  const area = document.getElementById("nc-color-picker-area");
  if (area.style.display === "block") { area.style.display = "none"; return; }
  // 이미 사용 중인 색 수집
  const usedBgs = new Set();
  [...Object.keys(compInfoDB), ...Object.keys(customColors), ...Object.keys(companyColors)].forEach((c) => {
    if (_ncColorIdx !== null && presetPalette[_ncColorIdx]?.bg === getCompanyColor(c).bg) return;
    usedBgs.add(getCompanyColor(c).bg);
  });
  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:6px;margin-top:8px;background:var(--bg-color);padding:10px;border-radius:12px;border:1px solid var(--border-color);">`;
  presetPalette.forEach((p, idx) => {
    const isUsed = usedBgs.has(p.bg);
    const isSel = _ncColorIdx === idx;
    let cls = isUsed ? "reserved" : "available";
    if (isSel) cls += " selected";
    html += `<div class="color-seat ${cls}" style="background:${p.bg};width:100%;height:auto;aspect-ratio:1/1;" onclick="selectNcColor(${idx})"></div>`;
  });
  html += `</div>`;
  area.innerHTML = html;
  area.style.display = "block";
}

async function selectNcColor(idx) {
  const p = presetPalette[idx];
  // 다른 업체가 이미 쓰는 색이면 경고 (CRM 수정 피커와 동일 동작)
  let usedBy = null;
  for (const c of [...Object.keys(compInfoDB), ...Object.keys(customColors), ...Object.keys(companyColors)]) {
    if (getCompanyColor(c).bg === p.bg) { usedBy = getFullName(c); break; }
  }
  if (usedBy) {
    if (!(await uiConfirm(`⚠️ 이 색상은 현재 [${usedBy}] 업체가 사용 중입니다.\n\n강제로 이 색상을 같이 사용하시겠습니까?`))) return;
  }
  _ncColorIdx = idx;
  const btn = document.getElementById("nc-color-btn");
  if (btn) { btn.style.background = p.bg; btn.style.color = p.cMain; btn.style.border = "none"; btn.textContent = "✅ 색상 선택됨 (다시 누르면 변경)"; }
  document.getElementById("nc-color-picker-area").style.display = "none";
}

function saveNewComp() {
  let full = document.getElementById("nc-full").value.trim();
  if (!full) {
    showToast("업체명을 입력하세요.", 2000);
    return;
  }

  compInfoDB[full] = {
    shortName: document.getElementById("nc-short").value.trim(),
    ic: document.getElementById("nc-ic").checked,
    oc: document.getElementById("nc-oc").checked,
    wc: document.getElementById("nc-wc").checked,
    etc: document.getElementById("nc-etc").value,
    addr: document.getElementById("nc-addr").value,
    phone: document.getElementById("nc-phone").value,
    time: document.getElementById("nc-time").value,
  };
  localStorage.setItem("COMP_INFO_DB", JSON.stringify(compInfoDB));
  apiCall({ source: "vercel", action: "SAVE_COMP_INFO_DB", data: compInfoDB });

  // 색상 선택됐으면 저장, 아니면 자동 배정
  if (_ncColorIdx !== null) {
    customColors[full] = _ncColorIdx;
    companyColors[full] = presetPalette[_ncColorIdx];
    localStorage.setItem("GLOBAL_COMPANY_COLORS", JSON.stringify(customColors));
    apiCall({ source: "vercel", action: "SAVE_GLOBAL_COLOR", compName: full, colorIdx: _ncColorIdx });
  }
  _ncColorIdx = null;

  showToast(`✅ [${full}] 등록 완료!`);
  document.getElementById("newCompModal").style.display = "none";

  selectedCrmComp = full;
  renderCompList();
}

function openReadCompPopup(compName) {
  let fullName = getFullName(compName);
  let info = compInfoDB[fullName] || {};
  document.getElementById("readCompTitle").innerText = fullName;
  document.getElementById("readCompPills").innerHTML =
    getPillHtml(fullName) || `<span class="type-pill pill-none">지정됨 없음</span>`;

  // 💡 팝업창 내부도 깔끔한 카드 형태로 세련되게 디자인!
  let html = `
              <div style="background:var(--bg-color); border:1px solid var(--border-color); border-radius:16px; padding:20px; display:flex; flex-direction:column; gap:16px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.03);">
                  <div class="info-row"><span class="info-label">📍 주소</span><span class="info-value">${info.addr || "-"}</span></div>
                  <div class="info-row"><span class="info-label">📞 연락처</span><span class="info-value">${info.phone || "-"}</span></div>
                  <div class="info-row"><span class="info-label">🕒 배송시간</span><span class="info-value">${info.time || "-"}</span></div>
                  <div class="info-row">
                      <span class="info-label">📝 특이사항</span>
                      <span class="info-value" style="background:rgba(255,159,10,0.05); padding:12px; border-radius:10px; border-left:4px solid #ff9f0a; margin-top:4px;">${info.etc || "기록된 특이사항이 없습니다."}</span>
                  </div>
              </div>
          `;
  document.getElementById("readCompContent").innerHTML = html;
  document.getElementById("compReadPopup").style.display = "flex";
}

// 💡 [자동 크기 조절 엔진] 글을 길게 쓰거나 엔터를 치면 칸이 자동으로 늘어남
function autoResizeTextarea(obj) {
  obj.style.height = "auto";
  obj.style.height = obj.scrollHeight + 2 + "px";
}

// 💡 [컬러 시트 엔진 V5] 토글 기능 및 예약석 시인성 개선
function openColorPickerV3(compName) {
  const stdName = getFullName(compName);
  const container = document.getElementById("crm-color-picker-area");

  // 🚨 [핵심] 토글 로직: 이미 열려있으면 닫고 즉시 종료!
  if (container.style.display === "block" && container.dataset.currentComp === stdName) {
    container.style.display = "none";
    return;
  }

  // 현재 어떤 업체의 팔레트를 열었는지 기억 (토글 판단용)
  container.dataset.currentComp = stdName;
  container.style.display = "block";

  // 1. 색상 사용 현황 수집 — CRM·customColors·달력 렌더된 업체(companyColors) 모두 포함
  let usedColorMap = {};
  const allCompNames = new Set([
    ...Object.keys(compInfoDB),
    ...Object.keys(customColors),
    ...Object.keys(companyColors),
  ]);
  allCompNames.forEach((c) => {
    if (c === stdName) return;
    const colorObj = getCompanyColor(c);
    const colorIdx = presetPalette.findIndex((p) => p.bg === colorObj.bg);
    if (colorIdx !== -1 && usedColorMap[colorIdx] === undefined) usedColorMap[colorIdx] = c;
  });

  let currentDisplayIdx =
    tempEditColorIdx !== null
      ? tempEditColorIdx
      : customColors[stdName] !== undefined
        ? customColors[stdName]
        : presetPalette.findIndex((p) => p.bg === getCompanyColor(stdName).bg);

  // 2. 그리드 HTML 생성
  let html = `<div class="color-picker-title"><span>🎨 색상 선택 (X 표시: 다른 업체 사용 중)</span></div>`;
  html += `<div class="color-grid">`;

  presetPalette.forEach((p, idx) => {
    let usedBy = usedColorMap[idx];
    let isCurrent = currentDisplayIdx === idx;

    let stateClass = usedBy ? "reserved" : "available";
    if (isCurrent) stateClass += " selected";

    let clickAction = `onclick="selectPaletteColor('${_argq(stdName)}', ${idx}, '${_argq(usedBy || "")}')"`;
    html += `<div class="color-seat ${stateClass}" style="background:${p.bg};" ${clickAction}></div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

// 💡 색상 선택 및 실시간 팝업 로직
async function selectPaletteColor(stdName, colorIdx, usedBy) {
  if (usedBy) {
    let confirmMsg = `⚠️ 이 색상은 현재 [${usedBy}] 업체가 사용 중입니다.\n\n강제로 이 색상을 같이 사용하시겠습니까?`;
    if (!(await uiConfirm(confirmMsg))) return;
  }

  tempEditColorIdx = colorIdx;
  tempEditColorObj = presetPalette[colorIdx];

  // 🚨 팔레트를 닫지 않고 선택 상태만 갱신하기 위해 container 디스플레이를 잠시 조작
  const container = document.getElementById("crm-color-picker-area");
  container.style.display = "none"; // 토글 로직 회피용
  openColorPickerV3(stdName);

  showToast("🎨 색상이 선택되었습니다.", 1000);
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

// (handleBioLogin → common-ui.js 로 통합됨)

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
      let cleanDesc = log.description.replace("[접속성공] ", ""); // 중복 문구 제거

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

// 📊 [신규 엔진] 이력 리스트 수량 변경 시 메인 수량 실시간 연동 (차분 계산 방식)
function onHistQtyChange(input, idx, type) {
  const mainInput = document.getElementById(type === "pal" ? `edit-pal-${idx}` : `edit-box-${idx}`);
  if (!mainInput) return;
  const oldVal = parseInt(input.getAttribute("data-old")) || 0;
  const newVal = parseInt(input.value) || 0;
  mainInput.value = Math.max(0, (parseInt(mainInput.value) || 0) + (newVal - oldVal));
  input.setAttribute("data-old", newVal);
}

// 🗑️ [신규 엔진] 이력 리스트 개별 파기 시 메인 수량에서 완전 차감
function deleteHistItem(idx, i) {
  const itemEl = document.getElementById(`hist-item-${idx}-${i}`);
  if (!itemEl) return;
  const palInput = itemEl.querySelector(`.hist-pal-${idx}`);
  const boxInput = itemEl.querySelector(`.hist-box-${idx}`);
  const oldPal = parseInt(palInput.getAttribute("data-old")) || 0;
  const oldBox = parseInt(boxInput.getAttribute("data-old")) || 0;
  const mainPal = document.getElementById(`edit-pal-${idx}`);
  const mainBox = document.getElementById(`edit-box-${idx}`);
  if (mainPal) mainPal.value = Math.max(0, (parseInt(mainPal.value) || 0) - oldPal);
  if (mainBox) mainBox.value = Math.max(0, (parseInt(mainBox.value) || 0) - oldBox);
  itemEl.remove();
}

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

// ═══════════════════════════════════════════════════════════════
// 📷 피킹지 사진 → 출고 자동 등록
//   촬영/선택 → 폰에서 크기 축소 → 서버 PICK_PARSE(판독) → 확인창(수정 가능) → PICK_REGISTER(새 행 등록)
//   · 손글씨 PLT / 완박스 / 혼재박스 가 핵심 (박스 = 완박스 + 혼재박스)
//   · 빨강 = 비어 있어 직접 입력 필수 / 주황 = 참고(다시 확인)
//   · 출고일이 문서에 없으면 '미정'
// ═══════════════════════════════════════════════════════════════
let _pickReq = 0; // 판독 요청 번호 — 창을 닫았다 다시 열어 새로 판독했을 때 늦게 도착한 이전 응답을 버림
let _pickState = null; // { result, company, duplicate, dupInfo, legacy, busy, mode, targetId, rows, seq }

// FAB 📷 → 가져오기 방법 선택 (촬영 / 사진첩)
function openPickCamera() {
  if (!isAdmin) {
    showToast("⚠️ 로그인한 관리자만 사용할 수 있습니다.", 2500);
    return;
  }
  const modal = document.getElementById("pickModal");
  if (!modal) return;
  modal.style.display = "flex";
  _pickChooser();
}

function _pickChooser() {
  const body = document.getElementById("pickBody");
  if (!body) return;
  _pickState = null;
  _pickSentCv = null;
  // 시스템 관리자 전용 '판독 정확도' 바로가기 — 화면 아래쪽은 아이폰 홈 막대에 가려질 수 있어 맨 위 오른쪽 작은 알약으로 둠
  const statsChip = typeof isSystemUser === "function" && isSystemUser()
    ? `<div style="display:flex;justify-content:flex-end;margin:2px 0 12px"><button type="button" onclick="pickStatsOpen()" style="display:inline-flex;align-items:center;gap:5px;background:var(--card-bg);border:1px solid var(--border-color);color:var(--text-sub);font-size:0.8em;font-weight:800;border-radius:999px;padding:6px 12px;cursor:pointer">📊 판독 정확도</button></div>`
    : "";
  body.innerHTML = `${statsChip}<div class="pk-choose">
    <button type="button" onclick="pickChoose('cam')"><span class="ic">📷</span><span>지금 촬영하기<small>카메라로 피킹지 마지막 장을 찍어요</small></span></button>
    <button type="button" onclick="pickChoose('lib')"><span class="ic">🖼️</span><span>사진첩에서 선택<small>이미 찍어 둔 사진·스캔 이미지를 불러와요</small></span></button>
  </div>`;
}

function pickChoose(kind) {
  const inp = document.getElementById(kind === "lib" ? "pickFileLib" : "pickFile");
  if (!inp) return;
  inp.value = ""; // 같은 사진을 다시 골라도 동작하게
  inp.click();
}

function closePickModal() {
  _pickReq++; // 진행 중이던 판독 응답은 무시
  _dsEd = null;
  _pickSentCv = null;
  const m = document.getElementById("pickModal");
  if (m) m.style.display = "none";
  _pickState = null;
}

// ==DOCSCAN-BEGIN==  📄 문서 스캐너식 모서리 찾기·펴기 (외부 라이브러리 없음, 화면 없이도 시험 가능한 순수 계산)
// gray: 0~255 Uint8Array(w*h). 종이(밝은 덩어리)의 네 모서리를 찾아 [{x,y}×4] (좌상→우상→우하→좌하) 와 신뢰도를 돌려줌. 못 찾으면 null.
function _dsOtsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
function _dsHull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function _dsPolyArea(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; a += P[i].x * P[j].y - P[j].x * P[i].y; }
  return Math.abs(a) / 2;
}
function _dsFindQuad(gray, w, h) {
  if (!gray || gray.length !== w * h || w < 20 || h < 20) return null;
  const thr = Math.min(215, Math.max(80, _dsOtsu(gray)));
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = gray[i] > thr ? 1 : 0;
  // 가장 큰 밝은 덩어리(= 종이)
  const lab = new Int32Array(w * h);
  let bestId = 0, bestSize = 0, id = 0;
  const stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || lab[s]) continue;
    id++;
    let sp = 0, size = 0;
    stack[sp++] = s; lab[s] = id;
    while (sp) {
      const c = stack[--sp]; size++;
      const x = c % w, y = (c / w) | 0;
      if (x > 0 && mask[c - 1] && !lab[c - 1]) { lab[c - 1] = id; stack[sp++] = c - 1; }
      if (x < w - 1 && mask[c + 1] && !lab[c + 1]) { lab[c + 1] = id; stack[sp++] = c + 1; }
      if (y > 0 && mask[c - w] && !lab[c - w]) { lab[c - w] = id; stack[sp++] = c - w; }
      if (y < h - 1 && mask[c + w] && !lab[c + w]) { lab[c + w] = id; stack[sp++] = c + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }
  if (!bestId || bestSize < w * h * 0.12) return null;
  const pts = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (lab[c] !== bestId) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[c - 1] !== bestId || lab[c + 1] !== bestId || lab[c - w] !== bestId || lab[c + w] !== bestId) pts.push({ x, y });
    }
  let H = _dsHull(pts);
  if (H.length < 4) return null;
  // 꼭짓점이 4개가 될 때까지, 면적을 가장 덜 깎는 점부터 제거
  while (H.length > 4) {
    let bi = 0, bl = Infinity;
    for (let i = 0; i < H.length; i++) {
      const a = H[(i + H.length - 1) % H.length], b = H[i], c = H[(i + 1) % H.length];
      const loss = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
      if (loss < bl) { bl = loss; bi = i; }
    }
    H.splice(bi, 1);
  }
  // 시계 방향 정렬 후 좌상(x+y 최소)부터
  const cx = H.reduce((s, p) => s + p.x, 0) / 4, cy = H.reduce((s, p) => s + p.y, 0) / 4;
  H.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let s0 = 0;
  for (let i = 1; i < 4; i++) if (H[i].x + H[i].y < H[s0].x + H[s0].y) s0 = i;
  const Q = [0, 1, 2, 3].map((k) => H[(s0 + k) % 4]);
  const qa = _dsPolyArea(Q);
  const fill = bestSize / Math.max(1, qa); // 덩어리가 사각형을 얼마나 채우나(글씨 구멍이 있어도 보통 0.8 이상)
  const areaRatio = qa / (w * h);
  if (areaRatio < 0.12 || fill < 0.6) return null;
  return { quad: Q, conf: Math.min(1, fill) * Math.min(1, areaRatio / 0.4), areaRatio, fill };
}
// 사각형을 사방으로 조금 넓힘(종이 가장자리가 잘리지 않게)
function _dsExpand(Q, k) {
  const cx = Q.reduce((s, p) => s + p.x, 0) / 4, cy = Q.reduce((s, p) => s + p.y, 0) / 4;
  return Q.map((p) => ({ x: cx + (p.x - cx) * (1 + k), y: cy + (p.y - cy) * (1 + k) }));
}
function _dsOutSize(Q, maxSide) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let ow = Math.max(d(Q[0], Q[1]), d(Q[3], Q[2])), oh = Math.max(d(Q[0], Q[3]), d(Q[1], Q[2]));
  const sc = Math.min(1, maxSide / Math.max(ow, oh));
  return { w: Math.max(2, Math.round(ow * sc)), h: Math.max(2, Math.round(oh * sc)) };
}
// 출력 사각형(0,0)-(ow,0)-(ow,oh)-(0,oh) → 원본의 Q 로 가는 투영 변환 계수 8개
function _dsHomography(Q, ow, oh) {
  const dst = [[0, 0], [ow, 0], [ow, oh], [0, oh]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], { x, y } = Q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
// RGBA(sw×sh) 에서 Q 영역을 ow×oh 직사각형으로 펴서 RGBA 로 돌려줌
function _dsWarp(src, sw, sh, Q, ow, oh) {
  const m = _dsHomography(Q, ow, oh);
  if (!m) return null;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let v = 0; v < oh; v++)
    for (let u = 0; u < ow; u++) {
      const dn = m[6] * u + m[7] * v + 1;
      const x = (m[0] * u + m[1] * v + m[2]) / dn, y = (m[3] * u + m[4] * v + m[5]) / dn;
      const o = (v * ow + u) * 4;
      if (x < 0 || y < 0 || x > sw - 1 || y > sh - 1) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
      const x0 = x | 0, y0 = y | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let k = 0; k < 3; k++)
        out[o + k] = src[i00 + k] * (1 - fx) * (1 - fy) + src[i10 + k] * fx * (1 - fy) + src[i01 + k] * (1 - fx) * fy + src[i11 + k] * fx * fy;
      out[o + 3] = 255;
    }
  return out;
}
// ==DOCSCAN-END==

// ───────── 📄 모서리 맞추기 화면 ─────────
// 사진 → (자동으로 종이 모서리 찾기) → 사람이 점을 끌어 확인 → 반듯하게 펴서 서버로.
let _dsEd = null; // { cv(원본 캔버스), quad, disp(표시 캔버스), sc, drag }
let _pickSentCv = null; // 서버로 보낸 바로 그 그림(손글씨 2차 판독 때 같은 좌표로 자르기 위해 판독이 끝날 때까지 보관)
function _dsLoad(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 2000;
        const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(img.naturalWidth * sc));
        cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 열 수 없습니다.")); };
    img.src = url;
  });
}
function _dsAuto(cv) {
  try {
    const sc = Math.min(1, 480 / Math.max(cv.width, cv.height));
    const w = Math.max(20, Math.round(cv.width * sc)), h = Math.max(20, Math.round(cv.height * sc));
    const t = document.createElement("canvas");
    t.width = w; t.height = h;
    const c2 = t.getContext("2d");
    c2.drawImage(cv, 0, 0, w, h);
    const d = c2.getImageData(0, 0, w, h).data;
    const g = new Uint8Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    const r = _dsFindQuad(g, w, h);
    if (!r) return null;
    const k = cv.width / w;
    return { quad: _dsExpand(r.quad.map((p) => ({ x: p.x * k, y: p.y * k })), 0.015), conf: r.conf };
  } catch (_) { return null; }
}
function _dsClampQuad(Q, W, H) {
  return Q.map((p) => ({ x: Math.min(W - 1, Math.max(0, p.x)), y: Math.min(H - 1, Math.max(0, p.y)) }));
}
function _dsDraw() {
  const E = _dsEd;
  if (!E || !E.disp) return;
  const c = E.disp, x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(E.cv, 0, 0, c.width, c.height);
  const P = E.quad.map((p) => ({ x: p.x * E.sc, y: p.y * E.sc }));
  x.fillStyle = "rgba(10,132,255,0.14)";
  x.strokeStyle = "#0a84ff";
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(P[0].x, P[0].y);
  for (let i = 1; i < 4; i++) x.lineTo(P[i].x, P[i].y);
  x.closePath(); x.fill(); x.stroke();
  P.forEach((p, i) => {
    x.beginPath();
    x.arc(p.x, p.y, 15, 0, Math.PI * 2);
    x.fillStyle = E.drag === i ? "#ff9f0a" : "rgba(255,255,255,0.92)";
    x.fill();
    x.lineWidth = 3; x.strokeStyle = "#0a84ff"; x.stroke();
  });
  if (E.drag != null && E.drag >= 0) _dsLoupe(x, c, E);
}
// 🔍 점을 끄는 동안 손가락에 가려지는 부분을 확대해서 보여줌 (스캔 앱처럼). 손가락 반대쪽 모서리에 띄움.
function _dsLoupe(x, c, E) {
  const rect = c.getBoundingClientRect();
  const k = c.width / Math.max(1, rect.width); // 화면 1px 당 캔버스 px
  const Rr = Math.min(62, rect.width * 0.17) * k; // 돋보기 반지름(캔버스 px) ≈ 화면 62px
  const q = E.quad[E.drag];
  const hx = q.x * E.sc, hy = q.y * E.sc;
  const m = 8 * k;
  const cx = hx < c.width / 2 ? c.width - Rr - m : Rr + m;
  const cy = hy > c.height * 0.4 ? Rr + m : c.height - Rr - m;
  const ZOOM = 3; // 화면에 보이는 크기의 3배
  const srcR = (Rr / k) / (ZOOM * (rect.width / E.cv.width)); // 원본 사진에서 돋보기에 담길 반지름(px)
  const f = Rr / srcR; // 원본 1px → 돋보기 캔버스 px
  x.save();
  x.beginPath(); x.arc(cx, cy, Rr, 0, Math.PI * 2); x.clip();
  x.fillStyle = "#000"; x.fillRect(cx - Rr, cy - Rr, Rr * 2, Rr * 2);
  // 사진 밖으로 벗어난 부분은 검게 두고, 사진 안쪽만 제 위치·제 배율로 그린다(안 그러면 브라우저가 남은 조각을 늘려 그려서 위치가 어긋남)
  {
    const sx0 = Math.max(0, q.x - srcR), sy0 = Math.max(0, q.y - srcR);
    const sx1 = Math.min(E.cv.width, q.x + srcR), sy1 = Math.min(E.cv.height, q.y + srcR);
    if (sx1 > sx0 && sy1 > sy0) x.drawImage(E.cv, sx0, sy0, sx1 - sx0, sy1 - sy0, cx + (sx0 - q.x) * f, cy + (sy0 - q.y) * f, (sx1 - sx0) * f, (sy1 - sy0) * f);
  }
  // 사각형의 변도 같이 그려서 어느 방향으로 맞춰야 하는지 보이게
  x.strokeStyle = "#0a84ff"; x.lineWidth = 2 * k;
  x.beginPath();
  E.quad.forEach((p, i) => { const px = cx + (p.x - q.x) * f, py = cy + (p.y - q.y) * f; i ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.closePath(); x.stroke();
  x.restore();
  // 십자선 = 점의 정확한 위치
  x.strokeStyle = "#ff453a"; x.lineWidth = 1.5 * k;
  x.beginPath(); x.moveTo(cx - 12 * k, cy); x.lineTo(cx + 12 * k, cy); x.moveTo(cx, cy - 12 * k); x.lineTo(cx, cy + 12 * k); x.stroke();
  x.beginPath(); x.arc(cx, cy, Rr, 0, Math.PI * 2); x.lineWidth = 3 * k; x.strokeStyle = "#fff"; x.stroke();
  x.beginPath(); x.arc(cx, cy, Rr + 1.5 * k, 0, Math.PI * 2); x.lineWidth = 1 * k; x.strokeStyle = "rgba(0,0,0,0.5)"; x.stroke();
}
function _dsPtr(ev) {
  const c = _dsEd.disp, r = c.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * c.width, y: ((ev.clientY - r.top) / r.height) * c.height };
}
function _dsDown(ev) {
  const E = _dsEd;
  if (!E) return;
  const p = _dsPtr(ev);
  let bi = -1, bd = 46 * (E.disp.width / Math.max(1, E.disp.getBoundingClientRect().width)); // 손가락 크기만큼 넉넉히
  E.quad.forEach((q, i) => { const d = Math.hypot(q.x * E.sc - p.x, q.y * E.sc - p.y); if (d < bd) { bd = d; bi = i; } });
  if (bi < 0) return;
  E.drag = bi;
  E.off = { x: E.quad[bi].x * E.sc - p.x, y: E.quad[bi].y * E.sc - p.y }; // 잡은 위치와 점 사이 간격 유지(점이 튀지 않게)
  try { E.disp.setPointerCapture(ev.pointerId); } catch (_) {}
  ev.preventDefault();
  _dsDraw();
}
function _dsMove(ev) {
  const E = _dsEd;
  if (!E || E.drag == null || E.drag < 0) return;
  const p = _dsPtr(ev);
  const o = E.off || { x: 0, y: 0 };
  E.quad[E.drag] = { x: Math.min(E.cv.width - 1, Math.max(0, (p.x + o.x) / E.sc)), y: Math.min(E.cv.height - 1, Math.max(0, (p.y + o.y) / E.sc)) };
  ev.preventDefault();
  _dsDraw();
}
function _dsUp() {
  if (_dsEd) { _dsEd.drag = null; _dsDraw(); }
}
function _dsQuadOk(Q) {
  // 볼록한 사각형이고 너무 작지 않아야 펼 수 있음
  const cr = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const sg = [0, 1, 2, 3].map((i) => cr(Q[i], Q[(i + 1) % 4], Q[(i + 2) % 4]));
  return (sg.every((v) => v > 0) || sg.every((v) => v < 0)) && _dsPolyArea(Q) > 40000;
}
function _pickEditShow(cv, auto) {
  const body = document.getElementById("pickBody");
  if (!body) return;
  const W = cv.width, H = cv.height;
  const q0 = auto ? auto.quad : [{ x: W * 0.08, y: H * 0.08 }, { x: W * 0.92, y: H * 0.08 }, { x: W * 0.92, y: H * 0.92 }, { x: W * 0.08, y: H * 0.92 }];
  _dsEd = { cv, quad: _dsClampQuad(q0, W, H), disp: null, sc: 1, drag: null, auto: !!auto };
  body.innerHTML = `<div id="pkEd">
    <div id="pkEdMsg" style="font-weight:800;color:var(--text-main);margin:2px 0 8px;font-size:0.95em">${auto ? "📄 종이 모서리를 찾았어요. 맞는지 보고, 틀리면 점을 끌어 맞춰주세요." : "📄 종이 모서리를 못 찾았어요. 네 점을 종이 모서리에 끌어 맞춰주세요."}</div>
    <div style="text-align:center"><canvas id="pkEdCv" style="max-width:100%;max-height:58vh;touch-action:none;border-radius:10px"></canvas></div>
    <div class="pk-foot">
      <button type="button" class="pk-btn ghost" onclick="_pickChooser()">다시 선택</button>
      <button type="button" class="pk-btn ghost" onclick="pickEditSend(false)">그대로 읽기</button>
      <button type="button" class="pk-btn primary" id="pkEdGo" onclick="pickEditSend(true)">📄 펴서 읽기</button>
    </div></div>`;
  const disp = document.getElementById("pkEdCv");
  const sc = Math.min(1, 900 / Math.max(W, H));
  disp.width = Math.round(W * sc); disp.height = Math.round(H * sc);
  _dsEd.disp = disp; _dsEd.sc = sc;
  disp.addEventListener("pointerdown", _dsDown);
  disp.addEventListener("pointermove", _dsMove);
  disp.addEventListener("pointerup", _dsUp);
  disp.addEventListener("pointercancel", _dsUp);
  _dsDraw();
}
function _dsToB64(cv) {
  let q = 0.85;
  let data = cv.toDataURL("image/jpeg", q);
  while (data.length > 3800000 && q > 0.4) { q -= 0.1; data = cv.toDataURL("image/jpeg", q); }
  return data.replace(/^data:[^,]+,/, "");
}
async function pickEditSend(flatten) {
  const E = _dsEd;
  if (!E) return;
  let b64;
  try {
    if (flatten) {
      if (!_dsQuadOk(E.quad)) { showToast("모서리 점이 꼬였어요. 네 점을 종이 모서리 순서대로 맞춰주세요.", 2800); return; }
      const go = document.getElementById("pkEdGo");
      if (go) { go.disabled = true; go.textContent = "펴는 중…"; }
      await new Promise((r) => setTimeout(r, 30)); // 버튼 문구가 먼저 그려지게
      const sw = E.cv.width, sh = E.cv.height;
      const src = E.cv.getContext("2d").getImageData(0, 0, sw, sh).data;
      const o = _dsOutSize(E.quad, 2000);
      const px = _dsWarp(src, sw, sh, E.quad, o.w, o.h);
      if (!px) throw new Error("warp");
      const oc = document.createElement("canvas");
      oc.width = o.w; oc.height = o.h;
      oc.getContext("2d").putImageData(new ImageData(px, o.w, o.h), 0, 0);
      b64 = _dsToB64(oc);
      _pickSentCv = oc;
    } else {
      b64 = _dsToB64(E.cv);
      _pickSentCv = E.cv;
    }
  } catch (e) {
    // 펴기에 실패하면 원본 그대로 읽는다
    b64 = _dsToB64(E.cv);
    _pickSentCv = E.cv;
  }
  _dsEd = null;
  await _pickSend(b64);
}

// 사진 → 긴 변 2000px JPEG(base64). 서버 요청 한도(약 4.5MB)와 인식 선명도 사이 균형
function _pickResize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 2000; // 손글씨 인식을 위해 충분한 해상도(서버 요청 한도 안에서 품질을 자동 조절)
        const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * sc));
        const h = Math.max(1, Math.round(img.naturalHeight * sc));
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        let q = 0.85;
        let data = cv.toDataURL("image/jpeg", q);
        while (data.length > 3800000 && q > 0.4) {
          q -= 0.1;
          data = cv.toDataURL("image/jpeg", q);
        }
        URL.revokeObjectURL(url);
        resolve(data.replace(/^data:[^,]+,/, ""));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없습니다."));
    };
    img.src = url;
  });
}


// ───────── ✍️ 손글씨 2차 판독 ─────────
//  1차 판독이 알려준 손글씨 영역(hwRegions: 보낸 그림 기준 사각형)을 같은 그림에서 잘라 확대해 한 번 더 읽고, 1차와 다르면 표시한다.
//  값을 사람 몰래 바꾸지 않는다: 칸이 비어 있을 때만 채우고, 이미 값이 있으면 표시와 [바꾸기] 버튼만 둔다.
function _pickDirty(id) {
  if (_pickState) (_pickState.dirty = _pickState.dirty || {})[id] = 1;
}
function _pickCrop(cv, rg, tall) {
  if (!cv || !rg) return null;
  const x = Math.max(0, Math.min(cv.width - 2, Math.round(rg.x))), y = Math.max(0, Math.min(cv.height - 2, Math.round(rg.y)));
  const w = Math.min(cv.width - x, Math.round(rg.w)), h = Math.min(cv.height - y, Math.round(rg.h));
  if (w < 60 || h < (tall ? 40 : 18)) return null;
  const sc = Math.max(1, Math.min(3, 1800 / w, 1800 / h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * sc); c.height = Math.round(h * sc);
  const x2 = c.getContext("2d");
  x2.imageSmoothingEnabled = true; x2.imageSmoothingQuality = "high";
  x2.fillStyle = "#fff"; x2.fillRect(0, 0, c.width, c.height);
  x2.drawImage(cv, x, y, w, h, 0, 0, c.width, c.height);
  let q = 0.9, d = c.toDataURL("image/jpeg", q);
  while (d.length > 1500000 && q > 0.5) { q -= 0.1; d = c.toDataURL("image/jpeg", q); }
  return d.replace(/^data:[^,]+,/, "");
}
async function _pickStartReread(st, myReq) {
  const r = st && st.result, cv = _pickSentCv;
  if (!r || !r.hwRegions || !cv || !st.parseId) return; // 손글씨 줄 머리글을 못 찾았으면 2차 판독 없이 1차 값만
  const imgs = [];
  try {
    const a = _pickCrop(cv, r.hwRegions.A, false);
    const b = _pickCrop(cv, r.hwRegions.B, true);
    if (a) imgs.push(a);
    if (a && b) imgs.push(b);
  } catch (_) {}
  if (!imgs.length) return;
  st.reread = { state: "wait" };
  _pickShowReread(st, st.reread);
  const token = window._sessionToken || localStorage.getItem("session_token") || sessionStorage.getItem("session_token");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 40000);
  let d = null;
  try {
    const resp = await fetch(VERCEL_API_URL, {
      method: "POST",
      body: JSON.stringify({ source: "vercel", domain: "system", action: "PICK_REREAD", admin_id: localStorage.getItem("admin_id"), session_token: token, data: { images: imgs, mime: "image/jpeg", parseId: st.parseId } }),
      signal: ctl.signal,
    });
    const raw = await resp.json();
    d = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) { d = null; }
  clearTimeout(timer);
  if (_pickState !== st || myReq !== _pickReq) return; // 그 사이 창을 닫았거나 다른 사진으로 바뀜
  if (!d || !d.success || !d.hw) { st.reread = { state: "err" }; _pickShowReread(st, st.reread); return; }
  _pickApplyReread(st, d.hw);
}
function _pickApplyReread(st, hw) {
  const F = [["plt", "pick-pal", "PLT"], ["wanbox", "pick-wan", "완박스"], ["honjae", "pick-hon", "혼재박스"]];
  const items = [];
  F.forEach(([k, id, lab]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const s = hw[k] === "empty" ? 0 : hw[k];
    if (s === null || s === undefined) { items.push({ k, id, lab, kind: "unread" }); return; }
    const cur = _pickInt(id);
    const edited = !!(st.dirty && st.dirty[id]);
    if (cur === null && !edited) { el.value = String(s); el.style.borderColor = _PICK_ORANGE; items.push({ k, id, lab, s, kind: "filled" }); }
    else if (cur === s) items.push({ k, id, lab, s, kind: "ok" });
    else { if (!edited) el.style.borderColor = _PICK_ORANGE; items.push({ k, id, lab, s, cur, kind: "diff", edited }); }
  });
  _pickRecalc();
  const r = st.result || {};
  st.reread = { state: "done", items, addHint: !!(hw.addToExisting && !r.addExisting && !r.mergeHint && st.mode !== "append"), handNote: hw.handNote || null };
  _pickShowReread(st, st.reread);
}
function _pickTakeReread(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = String(v);
  el.style.borderColor = "";
  _pickDirty(id);
  _pickRecalc();
  const st = _pickState;
  if (st && st.reread && Array.isArray(st.reread.items)) {
    const it = st.reread.items.find((x) => x.id === id);
    if (it) { it.kind = "ok"; it.cur = undefined; }
    _pickShowReread(st, st.reread);
  }
}
function _pickShowReread(st, info) {
  const box = document.getElementById("pick-reread");
  if (!box) return;
  const sty = "margin-top:10px;font-size:0.82em;line-height:1.55;";
  if (!info) { box.style.display = "none"; return; }
  box.style.display = "";
  if (info.state === "wait") { box.innerHTML = `<div style="${sty}color:var(--text-sub)">✍️ 손글씨를 한 번 더 확인하는 중… (등록은 지금도 할 수 있어요)</div>`; return; }
  if (info.state === "err") { box.innerHTML = `<div style="${sty}color:var(--text-sub)">✍️ 손글씨 2차 확인은 하지 못했어요. 위 값을 직접 한 번 확인해 주세요.</div>`; return; }
  const its = info.items || [];
  const bad = its.filter((x) => x.kind === "diff" || x.kind === "filled");
  let html = "";
  if (!bad.length && its.some((x) => x.kind === "ok")) {
    html += `<div style="${sty}color:#30d158;font-weight:800">✍️ 손글씨를 두 번 읽어 결과가 같아요 ✓</div>`;
  }
  bad.forEach((x) => {
    if (x.kind === "filled") html += `<div style="${sty}color:${_PICK_ORANGE};font-weight:800">🟠 ${_esc(x.lab)}: 1차에서 못 읽어 2차 판독 값 ${x.s} 로 채웠어요 — 확인하세요</div>`;
    else html += `<div style="${sty}color:${_PICK_ORANGE};font-weight:800">🟠 ${_esc(x.lab)}: 2차 판독은 <b>${x.s}</b>, 지금 입력은 <b>${x.cur}</b> ${x.edited ? "(직접 고친 값)" : ""} <button type="button" onclick="_pickTakeReread('${x.id}', ${x.s})" style="margin-left:6px;border:1px solid ${_PICK_ORANGE};background:none;color:${_PICK_ORANGE};border-radius:8px;padding:2px 9px;font-weight:800;font-size:0.95em;cursor:pointer">${x.s} 로 바꾸기</button></div>`;
  });
  const un = its.filter((x) => x.kind === "unread");
  if (un.length) html += `<div style="${sty}color:var(--text-sub)">✍️ 2차에서 읽지 못한 칸: ${un.map((x) => _esc(x.lab)).join(", ")}</div>`;
  if (info.addHint) html += `<div style="${sty}color:#0a84ff;font-weight:800">✍️ 2차 판독에서 "${_esc(info.handNote || "기존에 추가")}" 글씨를 봤어요 <button type="button" onclick="pickSetMode('append')" style="margin-left:6px;border:1px solid #0a84ff;background:none;color:#0a84ff;border-radius:8px;padding:2px 9px;font-weight:800;font-size:0.95em;cursor:pointer">기존 일정에 추가로 바꾸기</button></div>`;
  box.innerHTML = html || "";
  if (!html) box.style.display = "none";
}

// ───────── 📊 판독 정확도 보기 (시스템 관리자) ─────────
async function pickStatsOpen(days) {
  const body = document.getElementById("pickBody");
  if (!body) return;
  _pickState = null;
  const D = days || 90;
  body.innerHTML = `<div style="text-align:center;padding:36px 8px;color:var(--text-sub)">📊 집계하는 중…</div>`;
  let res = null;
  try { res = await apiCall({ source: "vercel", domain: "system", action: "PICK_STATS", admin_id: localStorage.getItem("admin_id"), data: { days: D } }); } catch (e) {}
  if (!document.getElementById("pickBody") || !body.isConnected) return;
  if (!(res && res.success && res.stats)) { _pickShowError((res && res.msg) || "집계를 불러오지 못했습니다."); return; }
  const S = res.stats;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
  const rowsHtml = Object.keys(S.fields).map((k) => {
    const f = S.fields[k];
    const sub = f.secondN ? `${pct(f.second, f.secondN)} <small style="color:var(--text-sub)">(${f.second}/${f.secondN})</small>` : "–";
    const agree = f.agreeN ? `${pct(f.agreeOk, f.agreeN)} <small style="color:var(--text-sub)">(${f.agreeOk}/${f.agreeN})</small>` : "–";
    const diff = f.diffN ? `1차 ${f.diffFirstOk} · 2차 ${f.diffSecondOk} · 둘 다 틀림 ${f.diffNeither}` : "–";
    return `<tr><td style="font-weight:900">${_esc(f.label)}</td><td>${pct(f.first, f.n)} <small style="color:var(--text-sub)">(${f.first}/${f.n})</small></td><td>${sub}</td><td>${agree}</td><td style="font-size:0.85em">${diff}</td></tr>`;
  }).join("");
  const mm = (S.mismatches || []).map((m) => `<div style="padding:6px 0;border-top:1px solid var(--border-color);font-size:0.85em"><b>${_esc(m.orderNo || "-")}</b> · ${_esc(m.field)} — 1차 <b>${m.parsed === null ? "못 읽음" : m.parsed}</b>${m.reread === null ? "" : ` / 2차 <b>${m.reread}</b>`} → 최종 <b>${m.final}</b></div>`).join("");
  body.innerHTML = `<div style="font-weight:900;font-size:1.05em;margin-bottom:4px">📊 피킹지 판독 정확도</div>
    <div style="font-size:0.82em;color:var(--text-sub);margin-bottom:10px">최근 ${D}일 · 판독 ${S.parses}건 · 등록까지 끝난 건 ${S.registered}건 (사진은 저장하지 않고 값만 기록)</div>
    <div class="pk-card"><div style="font-size:0.85em;font-weight:800;margin-bottom:6px">업체 자동 연결 정확도: ${pct(S.company.ok, S.company.n)} <small style="color:var(--text-sub)">(${S.company.ok}/${S.company.n})</small></div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.88em;text-align:left"><thead><tr style="color:var(--text-sub);font-size:0.85em"><th>칸</th><th>1차 정확</th><th>2차 정확</th><th>두 판독이 같을 때</th><th>다를 때 누가 맞았나</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div style="font-size:0.78em;color:var(--text-sub);margin-top:8px">정확 = 등록 때 사람이 최종으로 넣은 값과 같은 비율. 2차 판독은 손글씨 줄만 잘라 다시 읽은 결과입니다. 건수가 적을 때는 참고만 하세요.</div></div>
    ${mm ? `<div class="pk-card"><div style="font-size:0.85em;font-weight:800;margin-bottom:4px">1차가 틀렸던 건 (최근 ${Math.min(30, S.mismatches.length)}개)</div>${mm}</div>` : ""}
    <div class="pk-foot"><button class="pk-btn ghost" type="button" onclick="pickStatsOpen(${D === 90 ? 30 : 90})">${D === 90 ? "30일" : "90일"}로 보기</button><button class="pk-btn primary" type="button" onclick="_pickChooser()">닫기</button></div>`;
}

async function pickOnFile(inp) {
  const file = inp && inp.files && inp.files[0];
  if (!file) return;
  const modal = document.getElementById("pickModal");
  const body = document.getElementById("pickBody");
  if (!modal || !body) return;
  modal.style.display = "flex";
  const myReq = ++_pickReq;
  _pickState = { busy: true };
  body.innerHTML = `<div style="text-align:center;padding:36px 8px;color:var(--text-sub)"><div style="font-size:2em">⏳</div><div style="margin-top:10px;font-weight:800;color:var(--text-main)">사진을 여는 중입니다</div></div>`;
  try {
    const cv = await _dsLoad(file);
    if (myReq !== _pickReq) return;
    _pickState = null; // 편집 화면에서는 닫기 가능
    _pickEditShow(cv, _dsAuto(cv));
  } catch (e) {
    if (myReq !== _pickReq) return;
    _pickShowError("사진을 열 수 없습니다. 다시 시도해주세요.");
  }
}

async function _pickSend(b64) {
  const modal = document.getElementById("pickModal");
  const body = document.getElementById("pickBody");
  if (!modal || !body) return;
  modal.style.display = "flex";
  const myReq = ++_pickReq;
  _pickState = { busy: true };
  body.innerHTML = `<div style="text-align:center;padding:36px 8px;color:var(--text-sub)">
    <div style="font-size:2em">⏳</div>
    <div style="margin-top:10px;font-weight:800;color:var(--text-main)">피킹지를 읽는 중입니다</div>
    <div style="margin-top:6px;font-size:0.85em">약 10~20초 걸립니다. 창을 닫지 마세요.</div></div>`;
  try {
    const token = window._sessionToken || localStorage.getItem("session_token") || sessionStorage.getItem("session_token");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 55000); // 서버 한도(60초) 안에서 충분히 기다림 (기본 apiCall 은 15초라 사용 안 함)
    let d;
    try {
      const r = await fetch(VERCEL_API_URL, {
        method: "POST",
        body: JSON.stringify({
          source: "vercel", domain: "system", action: "PICK_PARSE",
          admin_id: localStorage.getItem("admin_id"), session_token: token,
          data: { image: b64, mime: "image/jpeg" },
        }),
        signal: ctl.signal,
      });
      const raw = await r.json();
      d = typeof raw === "string" ? JSON.parse(raw) : raw;
    } finally {
      clearTimeout(timer);
    }
    if (myReq !== _pickReq) return; // 그 사이 창을 닫았거나 다른 사진을 골랐음
    if (d && d.forceLogout) {
      closePickModal();
      showToast(d.msg || "세션이 만료되었습니다. 다시 로그인하세요.", 3000);
      if (typeof executeLogout === "function") executeLogout();
      return;
    }
    if (!d || !d.success) {
      _pickShowError((d && d.msg) || "판독에 실패했습니다. 다시 시도해주세요.");
      return;
    }
    _pickState = {
      result: d.result, company: d.company, duplicate: !!d.duplicate, dupInfo: d.dupInfo || null, legacy: !!d.legacy,
      busy: false, mode: d.result && (d.result.addExisting || d.result.mergeHint) ? "append" : "new", targetId: null, rows: null, seq: 0,
      autoMerge: !!(d.result && d.result.mergeHint && !d.result.addExisting), mergeMiss: false,
      parseId: d.parseId || null, dirty: {}, reread: null,
    };
    _pickRender();
    _pickLoadRows();
    _pickStartReread(_pickState, myReq); // 손글씨 2차 판독(화면은 먼저 보여주고 뒤에서 확인)
  } catch (e) {
    if (myReq !== _pickReq) return;
    _pickShowError(e && e.name === "AbortError" ? "판독 시간이 초과되었습니다. 다시 시도해주세요." : "판독 중 오류가 발생했습니다: " + (e.message || e));
  }
}

function _pickShowError(msg) {
  const body = document.getElementById("pickBody");
  if (!body) return;
  _pickState = null;
  body.innerHTML = `<div style="text-align:center;padding:28px 8px">
    <div style="font-size:2em">⚠️</div>
    <div style="margin:10px 0 16px;font-weight:800;color:var(--text-main)">${_esc(msg)}</div>
    <div class="pk-foot"><button class="pk-btn primary" onclick="_pickChooser()">다시 선택</button></div></div>`;
}

const _PICK_RED = "#ff453a";
const _PICK_ORANGE = "#ff9f0a";
function _pickFlagHtml(f) {
  const fl = _pickState && _pickState.result && _pickState.result.flags && _pickState.result.flags[f];
  if (!fl) return "";
  const c = fl.level === "red" ? _PICK_RED : _PICK_ORANGE;
  return `<div class="pk-flag" style="color:${c}">${fl.level === "red" ? "🔴" : "🟠"} ${_esc(fl.msg)}</div>`;
}
function _pickBorder(f) {
  const fl = _pickState && _pickState.result && _pickState.result.flags && _pickState.result.flags[f];
  return fl ? `border-color:${fl.level === "red" ? _PICK_RED : _PICK_ORANGE};` : "";
}

function _pickRender() {
  const body = document.getElementById("pickBody");
  const st = _pickState;
  if (!body || !st || !st.result) return;
  const r = st.result;
  const c = st.company || {};
  // 업체 초기값: 자동 연결된 마스터 이름만 채움(후보만 있으면 비워 두고 선택하게 함)
  const compVal = c.company || "";
  const cands = !c.company && Array.isArray(c.candidates) ? c.candidates : [];
  let banners = "";
  if (r.unfinished)
    banners += `<div class="pk-banner err" id="pick-unfin">🚫 작성 전 피킹지로 보입니다<br><span style="font-weight:600">PLT·완박스·혼재박스가 모두 비어 있어요. 손글씨가 있는데 못 읽은 거라면 아래 칸에 직접 입력하면 등록할 수 있어요. 아니면 작업이 끝난 마지막 장을 다시 찍어주세요.</span></div>`;
  if (st.duplicate) {
    const di = st.dupInfo;
    banners += `<div class="pk-banner err">🚫 이미 등록된 피킹지입니다<br><span style="font-weight:600">${_esc(r.orderNo || "")}${di ? ` → ${_esc(di.company)} · ${_esc(di.date || "미정")} 일정` : ""}<br>그 일정을 지웠다면 다시 등록할 수 있어요. 일정이 남아 있으면 중복 등록을 막기 위해 등록되지 않습니다.</span></div>`;
  } else if (st.legacy) {
    banners += `<div class="pk-banner warn">⚠️ 이전 버전에서 등록한 기록이 있는 피킹지입니다<br><span style="font-weight:600">달력에 이미 들어가 있는지 확인한 뒤 등록하세요.</span></div>`;
  }
  const isYongcha = !r.shipType || /용차/.test(r.shipType) || !!_shipKey(r.shipType); // 용마·CJ 택배는 아래 '배송 구분' 칸에서 고르므로 경고하지 않음
  const metaRows = [];
  if (r.orderNo) metaRows.push(`출고지시번호 <b>${_esc(r.orderNo)}</b>`);
  if (r.shipType) metaRows.push(`택배유형 <b style="${isYongcha ? "" : "color:" + _PICK_ORANGE}">${_esc(r.shipType)}</b>${isYongcha ? "" : " — 용차·용마·CJ 가 아니라 등록 때 한 번 더 묻습니다"}`);
  if (r.buyerNote) metaRows.push(`구매처 비고 <b>${_esc(r.buyerNote)}</b>`);
  if (r.sbox !== null && r.sbox !== undefined) metaRows.push(`이 장 인쇄 합계 SBOX ${_esc(String(r.sbox))} / RBOX ${r.rbox === null || r.rbox === undefined ? "?" : _esc(String(r.rbox))} <span style="opacity:.8">(손글씨 합계와 달라도 정상)</span>`);
  const metaHtml = (metaRows.length ? `<div class="pk-meta">${metaRows.join("<br>")}</div>` : "") + (!r.orderNo ? _pickFlagHtml("orderNo") : "");
  const matchNote = c.company
    ? `인쇄된 출고처명 "${_esc(r.customer || "")}" → 자동 연결`
    : `인쇄된 출고처명: ${_esc(r.customer || "(읽지 못함)")}`;
  const chips = cands.map((n) => `<button type="button" class="pk-chip" data-name="${_esc(n)}">${_esc(n)}</button>`).join("");
  const numIn = (id, v, f, lab) =>
    `<div class="pk-field"><label class="pk-label" for="${id}">${lab}</label><input type="number" inputmode="numeric" min="0" id="${id}" class="pk-input pk-num" style="${_pickBorder(f)}" value="${v === null || v === undefined ? "" : v}" oninput="_pickRecalc(); _pickDirty('${id}')" />${_pickFlagHtml(f)}</div>`;
  const dateHint = r.shipDate ? (_pickFlagHtml("shipDate") || `<div class="pk-hint">문서에 인쇄된 출고일</div>`) : `<div class="pk-hint">문서에서 출고일을 찾지 못해 미정으로 둡니다. 날짜를 고르면 같은 날 일정과 합산도 할 수 있어요.</div>`;
  body.innerHTML = `
    ${banners}
    <div class="pk-card">
      <label class="pk-label" for="pick-comp">업체 (필수)</label>
      <div class="input-wrapper"><input type="text" id="pick-comp" class="pk-input" style="${_pickBorder("customer")}" placeholder="업체 선택 또는 입력" autocomplete="off" value="${_esc(compVal)}" /></div>
      <div class="pk-hint">${matchNote}</div>${chips ? `<div>${chips}</div>` : ""}${_pickFlagHtml("customer")}
    </div>
    <div class="pk-card">
      <div class="pk-grid3">
        ${numIn("pick-pal", r.plt, "plt", "PLT")}${numIn("pick-wan", r.wanbox, "wanbox", "완박스")}${numIn("pick-hon", r.honjae, "honjae", "혼재박스")}
      </div>
      <div class="pk-sum" id="pick-box-line"></div>
      <div id="pick-reread" style="display:none"></div>
    </div>
    <div class="pk-card" id="pick-mode-box"></div>
    <div class="pk-card" id="pick-newonly">
      <label class="pk-label" for="pick-date">출고일 <span style="font-weight:500">(비우면 미정)</span></label>
      <input type="date" id="pick-date" class="pk-input" style="${_pickBorder("shipDate")}" value="${_esc(r.shipDate || "")}" onchange="_pickLoadRows()" />
      ${dateHint}
      <div class="pk-hint" id="pick-datehint" style="display:none">기존 일정에 추가할 때는 이 날짜의 일정만 후보로 보입니다. 날짜를 비우면 미정 일정과 앞으로의 일정이 모두 보여요.</div>
      <div id="pick-shipwrap"><label class="pk-label" for="pick-ship" style="margin-top:14px">배송 구분</label>
      ${_shipSelectHtml("pick-ship", _shipKey(r.shipType), "pk-input")}
      <div class="pk-hint">${r.shipType ? `문서의 택배유형: ${_esc(r.shipType)}` : "문서에서 택배유형을 찾지 못해 용차로 두었어요"}</div></div>
      <div id="pick-etcwrap"><label class="pk-label" for="pick-etc" style="margin-top:14px">비고</label>
      <input type="text" id="pick-etc" class="pk-input" placeholder="(선택)" /></div>
    </div>
    ${metaHtml}
    ${r.ai === "fail" ? `<div class="pk-banner warn">🟠 AI 판독이 실패해 문자인식 값만 사용했습니다. 손글씨 값을 꼭 확인하세요.</div>` : ""}
    <div class="pk-foot">
      <button class="pk-btn ghost" type="button" onclick="_pickChooser()">다시 선택</button>
      <button id="pick-submit" class="pk-btn primary" type="button" onclick="submitPick(this)">등록</button>
    </div>`;
  body.querySelectorAll(".pk-chip").forEach((b) => {
    b.onclick = () => {
      document.getElementById("pick-comp").value = b.getAttribute("data-name");
      body.querySelectorAll(".pk-chip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      _pickLoadRows();
    };
  });
  const compEl = document.getElementById("pick-comp");
  try { attachAutocomplete("pick-comp"); } catch (e) {}
  let _t = null;
  const later = () => { clearTimeout(_t); _t = setTimeout(_pickLoadRows, 350); };
  compEl.addEventListener("input", later);
  compEl.addEventListener("change", later);
  compEl.addEventListener("blur", () => setTimeout(_pickLoadRows, 300)); // 자동완성 선택 후 값이 채워진 뒤
  _pickRecalc();
  if (st.reread) _pickShowReread(st, st.reread); // 화면을 다시 그려도 2차 판독 안내 유지
  _pickRenderMode();
}

function _pickCurComp() {
  const el = document.getElementById("pick-comp");
  const raw = el ? (el.value || "").trim() : "";
  return raw ? getFullName(raw) : "";
}

// 같은 업체(+날짜)의 완료 전 일정 불러오기 → '기존 일정에 추가' 후보
async function _pickLoadRows() {
  const st = _pickState;
  if (!st || !st.result) return;
  const company = _pickCurComp();
  const dEl = document.getElementById("pick-date");
  const date = dEl && dEl.value ? dEl.value : null;
  const key = company + "|" + (date || "");
  if (st.rowsKey === key && st.rows) return;
  const seq = ++st.seq;
  st.rowsKey = key;
  if (!company) { st.rows = []; st.targetId = null; _pickRenderMode(); return; }
  st.rows = null;
  _pickRenderMode();
  let res = null;
  try {
    res = await apiCall({ source: "vercel", domain: "system", action: "PICK_FIND_ROWS", admin_id: localStorage.getItem("admin_id"), data: { company, date } });
  } catch (e) {}
  if (!_pickState || _pickState !== st || seq !== st.seq) return; // 그 사이 입력이 바뀜
  if (!(res && res.success && Array.isArray(res.rows))) { // 불러오기 실패 — '일정 없음'으로 굳히지 않고 다시 시도할 수 있게
    st.rows = []; st.rowsKey = null; st.rowsErr = true; st.targetId = null; _pickRenderMode(); return;
  }
  st.rowsErr = false;
  st.rows = res.rows;
  // 구매처 비고(합배 등)만 보고 '기존 일정에 추가'를 골랐는데 합칠 일정이 없으면 → 새 일정으로 (손글씨로 고른 경우는 그대로 안내만)
  if (st.autoMerge && st.mode === "append" && !st.rows.length) { st.mode = "new"; st.mergeMiss = true; }
  // 후보가 하나뿐이어도 출고일을 모르면(미정+앞으로 일정 전체가 후보) 자동으로 고르지 않음 — 다른 날짜 일정에 잘못 더하는 일 방지
  if (!st.rows.some((x) => x.id === st.targetId)) st.targetId = st.rows.length === 1 && date ? st.rows[0].id : null;
  _pickRenderMode();
}

function pickSetMode(m) {
  if (!_pickState) return;
  _pickState.mode = m;
  _pickRenderMode();
}
function pickSetTarget(id) {
  if (!_pickState) return;
  _pickState.targetId = id;
  _pickRenderMode();
}

function _pickRenderMode() {
  const st = _pickState;
  const box = document.getElementById("pick-mode-box");
  if (!st || !box) return;
  const r = st.result || {};
  const rows = st.rows;
  const n = Array.isArray(rows) ? rows.length : 0;
  const app = st.mode === "append";
  let inner = `<label class="pk-label">등록 방식</label>
    <div class="pk-seg">
      <button type="button" class="${app ? "" : "on"}" onclick="pickSetMode('new')">새 일정으로 등록</button>
      <button type="button" class="${app ? "on" : ""}" onclick="pickSetMode('append')">기존 일정에 추가${n ? ` (${n})` : ""}</button>
    </div>`;
  if (app) {
    if (r.mergeHint && !r.addExisting) inner += `<div class="pk-hint" style="color:#0a84ff;font-weight:800">📎 구매처 비고 "${_esc(r.mergeNote || "")}" 를 보고 기존 일정에 추가하는 방식을 골랐어요. 아니면 '새 일정으로 등록'을 누르세요.</div>`;
    if (r.addExisting) inner += `<div class="pk-hint" style="color:#0a84ff;font-weight:800">✍️ 손글씨에서 "${_esc(r.addNote || "기존에 추가")}" 문구를 찾아 이 방식을 골랐어요. 아니면 '새 일정으로 등록'을 누르세요.</div>`;
    if (rows === null) inner += `<div class="pk-hint">같은 업체 일정을 찾는 중...</div>`;
    else if (st.rowsErr) inner += `<div class="pk-hint" style="color:${_PICK_RED};font-weight:800">⚠️ 일정을 불러오지 못했습니다. <a href="#" onclick="event.preventDefault(); _pickLoadRows();" style="color:#0a84ff">다시 불러오기</a></div>`;
    else if (!n) inner += `<div class="pk-hint" style="color:${_PICK_ORANGE};font-weight:800">🟠 추가할 수 있는 ${_pickCurComp() ? "같은 업체 일정" : "일정"}이 없습니다. 업체·출고일을 확인하거나 '새 일정으로 등록'을 선택하세요.</div>`;
    else {
      inner += `<div class="pk-hint">수량(PLT·박스)을 더할 일정을 고르세요. [+수량추가] 와 똑같이 합산되고 비고에 이력이 남습니다. PLT 칸이 비어 있으면 박스만 더해져요.</div>`;
      inner += rows
        .map((x) => `<div class="pk-target ${x.id === st.targetId ? "on" : ""}" onclick="pickSetTarget(${Number(x.id)})"><span class="dot" style="margin:0"></span><div style="min-width:0"><b>${_esc(x.date || "미정")} · PLT ${_esc(String(x.pal))} / 박스 ${_esc(String(x.box))}</b>${x.etc ? `<span>${_esc(x.etc)}</span>` : ""}</div></div>`)
        .join("");
    }
  } else if (st.mergeMiss && !n) {
    inner += `<div class="pk-hint" style="color:${_PICK_ORANGE};font-weight:800">🟠 구매처 비고 "${_esc(r.mergeNote || "")}" 는 기존 일정과 합치라는 뜻 같지만, 같은 업체·같은 날 일정을 찾지 못해 새 일정으로 두었어요. 업체·출고일을 확인하세요.</div>`;
  } else if (n) {
    inner += `<div class="pk-hint" style="color:${_PICK_ORANGE};font-weight:800">🟠 같은 업체${document.getElementById("pick-date") && document.getElementById("pick-date").value ? "·같은 날" : ""} 일정이 ${n}건 있어요. 같은 날 같이 나가는 건이면 '기존 일정에 추가'를 쓰세요.</div>`;
  }
  box.innerHTML = inner;
  const ew = document.getElementById("pick-etcwrap");
  if (ew) ew.style.display = app ? "none" : "";
  const sw = document.getElementById("pick-shipwrap");
  if (sw) sw.style.display = app ? "none" : ""; // 기존 일정에 추가할 때는 그 일정의 배송 구분을 그대로 둠
  const dh = document.getElementById("pick-datehint");
  if (dh) dh.style.display = app ? "" : "none";
  const sb = document.getElementById("pick-submit");
  if (sb && !sb.dataset.busy) {
    sb.textContent = app ? "기존 일정에 추가" : "새 일정으로 등록";
    sb.disabled = !!(st.duplicate || _pickUnfin(st) || (app && !st.targetId));
  }
}

function _pickInt(id) {
  const el = document.getElementById(id);
  if (!el || String(el.value).trim() === "") return null;
  const n = parseInt(el.value, 10);
  return isNaN(n) || n < 0 ? null : n;
}
// '작성 전 피킹지'(세 칸 모두 못 읽음)는 사람이 칸에 값을 넣으면 풀린다 — 손글씨는 있는데 못 읽은 경우에도 직접 입력해 등록할 수 있게
function _pickUnfin(st) {
  if (!st || !st.result || !st.result.unfinished) return false;
  return (_pickInt("pick-pal") || 0) + (_pickInt("pick-wan") || 0) + (_pickInt("pick-hon") || 0) === 0;
}
function _pickRecalc() {
  const st0 = _pickState;
  if (st0 && st0.result && st0.result.unfinished) {
    const un = _pickUnfin(st0);
    const bn = document.getElementById("pick-unfin");
    if (bn) bn.style.display = un ? "" : "none";
    const sb0 = document.getElementById("pick-submit");
    if (sb0 && !sb0.dataset.busy) sb0.disabled = !!(st0.duplicate || un || (st0.mode === "append" && !st0.targetId));
  }
  const line = document.getElementById("pick-box-line");
  if (!line) return;
  const w = _pickInt("pick-wan"), h = _pickInt("pick-hon");
  line.innerHTML = w === null || h === null
    ? `<small>완박스·혼재박스를 입력하세요 (없으면 0)</small>`
    : `<span>박스 합계</span><span>${w} + ${h} = ${w + h}</span>`;
}

let _pickSubmitting = false;
async function submitPick(btn) {
  if (_pickSubmitting) return; // 확인창이 떠 있는 동안·처리 중 연타 방지
  _pickSubmitting = true;
  try {
    await _submitPickInner(btn);
  } finally {
    _pickSubmitting = false;
  }
}
async function _submitPickInner(btn) {
  const st = _pickState;
  if (!st || !st.result || st.busy || st.duplicate || _pickUnfin(st)) return;
  const rawComp = (document.getElementById("pick-comp").value || "").trim();
  let pal = _pickInt("pick-pal");
  const wan = _pickInt("pick-wan"), hon = _pickInt("pick-hon");
  if (!rawComp) { showToast("⚠️ 업체를 선택해주세요.", 2500); return; }
  // 기존 일정에 추가할 때는 PLT 를 비워도 됨(박스 수량만 더함). 새 일정은 PLT 필수
  if (pal === null && st.mode === "append") pal = 0;
  if (pal === null) { showToast("⚠️ PLT 수를 입력해주세요. (없으면 0)", 2500); return; }
  if (st.mode !== "append" && st.result.pltAddZero && pal === 0) {
    if (!(await uiConfirm("PLT 가 적혀 있지 않은 피킹지입니다(기존에추가 표시).\nPLT 0 인 새 일정으로 등록할까요?", { okText: "등록" }))) return;
  }
  if (wan === null || hon === null) { showToast("⚠️ 완박스와 혼재박스를 입력해주세요. (없으면 0)", 2500); return; }
  const company = getFullName(rawComp); // 약어로 입력해도 마스터 업체명으로 통일 (신규 등록과 동일)
  const app = st.mode === "append";
  const date = app ? null : document.getElementById("pick-date").value || null;
  const etc = app ? "" : (document.getElementById("pick-etc").value || "").trim();
  const box = wan + hon;
  let target = null;
  if (app) {
    target = (st.rows || []).find((x) => x.id === st.targetId);
    if (!target) { showToast("⚠️ 수량을 추가할 기존 일정을 선택해주세요.", 2500); return; }
    if (pal === 0 && box === 0) { showToast("⚠️ 추가할 PLT 또는 박스가 0 입니다.", 2500); return; }
  }
  const orangeLeft = Object.values((st.result && st.result.flags) || {}).filter((f) => f.level === "orange").length;
  const shipT = st.result.shipType;
  if (shipT && !/용차/.test(shipT) && !_shipKey(shipT)) {
    if (!(await uiConfirm(`택배유형이 "${shipT}" 입니다.\n출고 달력은 용차 기준인데, 이 건도 달력에 반영할까요?`, { okText: "계속" }))) return;
  }
  const msg = app
    ? `${company}\n${target.date || "미정"} 일정 (현재 PLT ${target.pal} / 박스 ${target.box})\n+ PLT ${pal} / 박스 ${box} (완박스 ${wan} + 혼재 ${hon})\n→ PLT ${(parseInt(target.pal) || 0) + pal} / 박스 ${(parseInt(target.box) || 0) + box}\n이 일정에 추가할까요?`
    : `${company}\nPLT ${pal} / 박스 ${box} (완박스 ${wan} + 혼재 ${hon})\n출고일 ${date || "미정"}\n새 출고 일정으로 등록할까요?`;
  if (!(await uiConfirm(msg + (orangeLeft ? `\n\n🟠 참고 표시 ${orangeLeft}건이 남아 있습니다.` : ""), { okText: app ? "추가" : "등록" }))) return;
  st.busy = true;
  if (btn) { btn.dataset.busy = "1"; btn.disabled = true; btn.textContent = "처리 중... ⏳"; }
  const res = await apiCall({
    source: "vercel", domain: "system", action: "PICK_REGISTER",
    admin_id: localStorage.getItem("admin_id"),
    data: { company, pal, box, date, etc, orderNo: st.result.orderNo || "", printedName: st.result.customer || "", mode: app ? "append" : "new", targetId: app ? target.id : undefined, wan, hon, parseId: st.parseId || undefined, shipType: app ? undefined : (document.getElementById("pick-ship") ? document.getElementById("pick-ship").value : undefined) },
  });
  st.busy = false;
  if (res && res.success) {
    showToast(app ? `✅ 추가 완료: ${company} +PLT ${pal} / +박스 ${box}` : `✅ 등록 완료: ${company} PLT ${pal} / 박스 ${box}`, 3000);
    closePickModal();
    goToAsync(serverData.year, serverData.month);
  } else {
    if (btn) { delete btn.dataset.busy; }
    if (res === null || res === undefined) {
      // 응답이 없음(시간 초과·네트워크) — 서버에서는 처리됐을 수 있으니 같은 걸 또 누르기 전에 달력을 새로 불러와 확인하게 함
      showToast("⚠️ 서버 응답이 없습니다. 달력에 반영됐는지 확인한 뒤 다시 시도하세요.", 5000);
      goToAsync(serverData.year, serverData.month);
    } else {
      showToast("⚠️ " + (res.msg || "처리에 실패했습니다."), 3500);
    }
    if (app) { st.rowsKey = null; _pickLoadRows(); } // 대상 일정이 바뀌었을 수 있으니 목록을 새로 받음
    else _pickRenderMode();
  }
}
