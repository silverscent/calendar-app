// ============================================================
// common-ui.js — 출고/입고 공통 UI/관리자/인증 함수 (양쪽 100% 동일분 추출)
// page별 전역(serverData,currentType,isAdmin,compInfoDB,adminToken 등)은
// 각 HTML 인라인 스크립트에 정의됨. 함수는 호출 시점에 그 전역을 참조.
// ============================================================

// ── 페이지네이션 바 렌더링 (3곳에서 반복되던 패턴 공통화)
//    prevFn/nextFn: onclick에 들어갈 전역 함수명 문자열 (e.g. "changeDbPage")
function _renderPager(pager, res, prevFn, nextFn, opts) {
  if (!pager || !res || res.totalPages <= 1) return;
  opts = opts || {};
  const pad = opts.compact ? "6px 12px" : "8px 16px";
  const btnStyle = `padding:${pad}; background:var(--card-bg); border:1px solid var(--border-color); color:var(--text-main); border-radius:8px; cursor:pointer; font-weight:bold;`;
  const countHtml = (!opts.compact && res.totalCount != null)
    ? ` <span style="font-size:0.85em; color:var(--text-sub); font-weight:normal; margin-left:5px;">(총 ${res.totalCount}건)</span>`
    : "";
  const midStyle = opts.compact
    ? `color:var(--text-main); font-weight:900; font-size:0.95em; padding:0 10px;`
    : `color:var(--text-main); font-weight:900; font-size:1em;`;
  pager.innerHTML =
    `<button onclick="${prevFn}(-1)" ${res.page === 1 ? "disabled" : ""} style="${btnStyle}">${opts.compact ? "◀" : "◀ 이전"}</button>` +
    `<span style="${midStyle}">${res.page} <span style="color:var(--text-sub); font-weight:normal;">/ ${res.totalPages}</span>${countHtml}</span>` +
    `<button onclick="${nextFn}(1)" ${res.page === res.totalPages ? "disabled" : ""} style="${btnStyle}">${opts.compact ? "▶" : "다음 ▶"}</button>`;
}

function searchRawDatabaseRows() {
  const keyword = document.getElementById("dbMasterSearchKeyword").value.trim();
  const filterCol = document.getElementById("dbMasterFilterCol").value;
  const limit = document.getElementById("dbMasterLimit").value; // 몇 줄씩 볼지
  const container = document.getElementById("dbMasterRowsContainer");
  const pager = document.getElementById("dbMasterPaginationBar");

  if (!container) return;
  container.innerHTML =
    "<div style='color:var(--text-sub); text-align:center; padding:25px; font-weight:800;'>실시간 데이터 파싱 중...</div>";
  if (pager) pager.innerHTML = "";

  apiCall({
    source: "vercel",
    action: "GET_RAW_DB_ROWS",
    keyword: keyword,
    filterCol: filterCol,
    limit: Number(limit),
    page: dbCurrentPage,
    sortCol: dbSortCol,
    sortDir: dbSortDir,
    type: currentType,
  }).then(function (res) {
    if (res === null || !res.success || !res.rows || res.rows.length === 0) {
      container.innerHTML =
        "<div style='color:var(--text-sub); text-align:center; padding:25px;'>데이터가 없습니다.</div>";
      return;
    }

    let html = `<style>
                  .db-input { width: 100%; padding: 6px; background: var(--bg-color); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 4px; box-sizing: border-box; font-size: 0.85em; }
                  .db-btn-save { background: rgba(52,199,89,0.1); border: 1px solid #34c759; color: #34c759; border-radius: 6px; padding: 5px 10px; font-size: 0.85em; font-weight: 900; cursor: pointer; margin-right: 4px; }
                  .db-btn-del { background: rgba(255,59,48,0.1); border: 1px solid #ff3b30; color: #ff3b30; border-radius: 6px; padding: 5px 10px; font-size: 0.85em; font-weight: 900; cursor: pointer; }
              </style>`;

    // 🚨 정렬 기능이 탑재된 헤더(th) 자동 생성기
    const th = (col, name) =>
      `<th onclick="setDbSort('${col}')" style="cursor:pointer; user-select:none; white-space:nowrap;" title="클릭하여 정렬">${name} <span style="font-size:0.8em">${getSortIcon(col)}</span></th>`;

    if (currentType === "out") {
      // 📤 출고 테이블 렌더링
      html += `<table style='width:100%; border-collapse:collapse; font-size:0.85em; text-align:left; min-width: 950px; table-layout: fixed;'>
                      <colgroup><col style='width: 60px;'><col style='width: 130px;'><col style='width: 70px;'><col style='width: 70px;'><col style='width: 120px;'><col style='width: 100px;'><col style='width: 150px;'><col style='width: 70px;'><col style='width: 70px;'><col style='width: 120px;'></colgroup>
                      <thead style='background:var(--bg-color); color:var(--text-sub); border-bottom:1px solid var(--border-color);'><tr>
                          ${th("id", "ID")} ${th("company", "company")} ${th("pal", "pal")} ${th("box", "box")} ${th("outbound_date", "out_date")} ${th("etc", "etc")} ${th("created_at", "created_at")} ${th("sort_idx", "sort")} ${th("isDone", "isDone")} <th style='text-align:center;'>명령</th>
                      </tr></thead><tbody>`;

      // 항상 첫 줄에 뜨는 신규 데이터 주입 폼
      html += `<tr style='background:rgba(52,199,89,0.08); border-bottom:2px solid #34c759;'>
                      <td style='color:#34c759; font-weight:900; text-align:center;'>NEW</td>
                      <td><input type="text" id="db-o-comp-new" placeholder="업체명 (필수)" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="number" id="db-o-pal-new" placeholder="0" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="number" id="db-o-box-new" placeholder="0" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-o-date-new" placeholder="YYYY-MM-DD" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-o-etc-new" placeholder="비고 입력" class="db-input" style="border:1px solid #34c759;"></td>
                      <td style="color:var(--text-sub); text-align:center; font-size:0.9em;">(자동 각인)</td>
                      <td><input type="number" id="db-o-sort-new" value="999" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="number" id="db-o-done-new" value="0" class="db-input" style="border:1px solid #34c759;"></td>
                      <td style='text-align:center;'><button onclick="addNewRowDirectDB('out')" style="background:#34c759; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-weight:900; cursor:pointer; width:100%;">➕ 신규등록</button></td>
                  </tr>`;

      res.rows.forEach((r) => {
        html += `<tr style='border-bottom:1px solid var(--border-color);'><td style='color:var(--text-sub); font-weight:bold;'>${r.id}</td>
                          <td><input type="text" id="db-o-comp-${r.id}" value="${_esc(r.company || "")}" class="db-input"></td>
                          <td><input type="number" id="db-o-pal-${r.id}" value="${r.pal || 0}" class="db-input"></td>
                          <td><input type="number" id="db-o-box-${r.id}" value="${r.box || 0}" class="db-input"></td>
                          <td><input type="text" id="db-o-date-${r.id}" value="${r.outbound_date || ""}" class="db-input"></td>
                          <td><input type="text" id="db-o-etc-${r.id}" value="${_esc(r.etc || "")}" class="db-input"></td>
                          <td><input type="text" id="db-o-cre-${r.id}" value="${r.created_at || ""}" class="db-input"></td>
                          <td><input type="number" id="db-o-sort-${r.id}" value="${r.sort_idx || 0}" class="db-input"></td>
                          <td><input type="number" id="db-o-done-${r.id}" value="${r.isDone || 0}" class="db-input"></td>
                          <td style='text-align:center;'><button onclick="saveFullRowDB(${r.id})" class="db-btn-save">저장</button><button onclick="deleteRowDirectFromDB(${r.id})" class="db-btn-del">삭제</button></td></tr>`;
      });
    } else {
      // 📥 입고 테이블 렌더링
      html += `<table style='width:100%; border-collapse:collapse; font-size:0.85em; text-align:left; min-width: 1350px; table-layout: fixed;'>
                      <colgroup><col style='width: 60px;'><col style='width: 130px;'><col style='width: 60px;'><col style='width: 100px;'><col style='width: 100px;'><col style='width: 80px;'><col style='width: 80px;'><col style='width: 100px;'><col style='width: 120px;'><col style='width: 140px;'><col style='width: 60px;'><col style='width: 80px;'><col style='width: 60px;'><col style='width: 120px;'></colgroup>
                      <thead style='background:var(--bg-color); color:var(--text-sub); border-bottom:1px solid var(--border-color);'><tr>
                          ${th("id", "ID")} ${th("bl_number", "bl_number")} ${th("pallets", "pallets")} ${th("eta", "eta")} ${th("receive_date", "receive_date")} ${th("fwd", "fwd")} ${th("s_type", "s_type")} ${th("invoice", "invoice")} ${th("remarks", "remarks")} ${th("last_updated", "last_updated")} ${th("sort_idx", "sort")} ${th("status", "status")} ${th("is_ai_modified", "AI")} <th style='text-align:center;'>명령</th>
                      </tr></thead><tbody>`;

      // 항상 첫 줄에 뜨는 신규 데이터 주입 폼
      html += `<tr style='background:rgba(52,199,89,0.08); border-bottom:2px solid #34c759;'>
                      <td style='color:#34c759; font-weight:900; text-align:center;'>NEW</td>
                      <td><input type="text" id="db-i-bl-new" placeholder="B/L번호 (필수)" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="number" id="db-i-pal-new" placeholder="0" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-eta-new" placeholder="YYYY-MM-DD" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-date-new" placeholder="YYYY-MM-DD" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-fwd-new" placeholder="FWD" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-stype-new" placeholder="TYPE" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-inv-new" placeholder="INVOICE" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-rem-new" placeholder="비고 입력" class="db-input" style="border:1px solid #34c759;"></td>
                      <td style="color:var(--text-sub); text-align:center; font-size:0.9em;">(자동 각인)</td>
                      <td><input type="number" id="db-i-sort-new" value="999" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="text" id="db-i-stat-new" value="입고대기" class="db-input" style="border:1px solid #34c759;"></td>
                      <td><input type="number" id="db-i-ai-new" value="0" class="db-input" style="border:1px solid #34c759;"></td>
                      <td style='text-align:center;'><button onclick="addNewRowDirectDB('in')" style="background:#34c759; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-weight:900; cursor:pointer; width:100%;">➕ 신규등록</button></td>
                  </tr>`;

      res.rows.forEach((r) => {
        html += `<tr style='border-bottom:1px solid var(--border-color);'><td style='color:var(--text-sub); font-weight:bold;'>${r.id}</td>
                          <td><input type="text" id="db-i-bl-${r.id}" value="${_esc(r.bl_number || "")}" class="db-input"></td>
                          <td><input type="number" id="db-i-pal-${r.id}" value="${r.pallets || 0}" class="db-input"></td>
                          <td><input type="text" id="db-i-eta-${r.id}" value="${r.eta || ""}" class="db-input"></td>
                          <td><input type="text" id="db-i-date-${r.id}" value="${r.receive_date || ""}" class="db-input"></td>
                          <td><input type="text" id="db-i-fwd-${r.id}" value="${_esc(r.fwd || "")}" class="db-input"></td>
                          <td><input type="text" id="db-i-stype-${r.id}" value="${_esc(r.s_type || "")}" class="db-input"></td>
                          <td><input type="text" id="db-i-inv-${r.id}" value="${_esc(r.invoice || "")}" class="db-input"></td>
                          <td><input type="text" id="db-i-rem-${r.id}" value="${_esc(r.remarks || "")}" class="db-input"></td>
                          <td><input type="text" id="db-i-upd-${r.id}" value="${r.last_updated || ""}" class="db-input"></td>
                          <td><input type="number" id="db-i-sort-${r.id}" value="${r.sort_idx || 0}" class="db-input"></td>
                          <td><input type="text" id="db-i-stat-${r.id}" value="${_esc(r.status || "")}" class="db-input"></td>
                          <td><input type="number" id="db-i-ai-${r.id}" value="${r.is_ai_modified || 0}" class="db-input"></td>
                          <td style='text-align:center;'><button onclick="saveFullRowDB(${r.id})" class="db-btn-save">저장</button><button onclick="deleteRowDirectFromDB(${r.id})" class="db-btn-del">삭제</button></td></tr>`;
      });
    }
    html += `</tbody></table>`;
    container.innerHTML = html;

    _renderPager(pager, res, "changeDbPage", "changeDbPage");
  });
}

function refreshAdminList() {
  const container = document.getElementById("masterAdminListContainer");
  if (!container) return;
  container.innerHTML =
    "<div style='color:var(--text-sub); text-align:center; padding:15px; font-weight:800;'>보안 세션 확인 중...</div>";

  apiCall({ source: "vercel", action: "GET_ADMIN_LIST" }).then(function (res) {
    if (res === null || !res.success || !res.list) {
      container.innerHTML = "<div style='color:var(--text-sub); padding:10px;'>목록 수집 실패</div>";
      return;
    }
    container.innerHTML = "";

    // 검색어 + 상태 필터 적용 (클라이언트)
    const kw = (document.getElementById("adminSearchKeyword")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("adminStatusFilter")?.value || "";
    let list = res.list;
    if (kw) list = list.filter((u) => (u.admin_id + " " + (u.admin_name || "")).toLowerCase().includes(kw));
    if (statusFilter === "active") list = list.filter((u) => u.status !== "LOCKED");
    else if (statusFilter === "locked") list = list.filter((u) => u.status === "LOCKED");

    // 건수 요약
    const total = res.list.length;
    const lockedTotal = res.list.filter((u) => u.status === "LOCKED").length;
    container.insertAdjacentHTML(
      "beforeend",
      `<div style="font-size:0.8em; color:var(--text-sub); font-weight:700; margin-bottom:10px;">전체 <b style="color:#0a84ff;">${total}</b>명 (활성 ${total - lockedTotal} · 비활성 ${lockedTotal})${kw || statusFilter ? ` · 검색결과 ${list.length}명` : ""}</div>`,
    );
    if (list.length === 0) {
      container.insertAdjacentHTML(
        "beforeend",
        "<div style='color:var(--text-sub); text-align:center; padding:20px;'>조건에 맞는 관리자가 없습니다.</div>",
      );
      return;
    }

    // 활성과 비활성(LOCKED) 그룹 분리
    const activeUsers = list.filter((u) => u.status !== "LOCKED");
    const lockedUsers = list.filter((u) => u.status === "LOCKED");

    // 로우 생성 헬퍼 (5번 요구사항: 모바일 찌그러짐 방지 2단 레이아웃)
    const buildCard = (item, isLocked) => {
      const card = document.createElement("div");
      const isMaster = item.admin_id.toLowerCase() === "admin" || item.admin_id.toLowerCase() === "silverscent";

      card.style = `display:flex; flex-direction:column; gap:10px; background:${isLocked ? "rgba(255,59,48,0.02)" : "var(--card-bg)"}; border:1px solid ${isLocked ? "rgba(255,59,48,0.15)" : "var(--border-color)"}; padding:14px; border-radius:14px; box-sizing:border-box; margin-bottom:6px; ${isLocked ? "opacity:0.75;" : ""}`;

      let actionArea = "";
      if (isMaster) {
        actionArea = `<span style='color:#0a84ff; font-size:0.85em; font-weight:800;'>🔒 System Admin</span>`;
      } else if (isLocked) {
        actionArea = `
                          <button onclick="reactivateAdminAccount('${_argq(item.admin_id)}', '${_argq(item.admin_name)}')" style='flex:1; background:rgba(52,199,89,0.1); border:1px solid #34c759; color:#34c759; padding:8px; border-radius:8px; font-weight:800; font-size:0.85em; cursor:pointer;'>♻️ 복구</button>
                          <button onclick="hardDeleteAdminAccount('${_argq(item.admin_id)}', '${_argq(item.admin_name)}')" style='flex:1; background:rgba(255,59,48,0.1); border:1px solid #ff3b30; color:#ff3b30; padding:8px; border-radius:8px; font-weight:900; font-size:0.85em; cursor:pointer;'>완전삭제</button>
                      `;
      } else {
        actionArea = `
                          <button onclick="resetAdminPassword('${_argq(item.admin_id)}', '${_argq(item.admin_name)}')" style='flex:1; background:rgba(255,159,10,0.1); border:1px solid #ff9f0a; color:#ff9f0a; padding:8px; border-radius:8px; font-weight:800; font-size:0.85em; cursor:pointer;'>비번초기화</button>
                          <button onclick="deleteAdminAccount('${_argq(item.admin_id)}', '${_argq(item.admin_name)}')" style='flex:1; background:rgba(255,59,48,0.1); border:1px solid #ff3b30; color:#ff3b30; padding:8px; border-radius:8px; font-weight:800; font-size:0.85em; cursor:pointer;'>비활성화</button>
                      `;
      }

      const statusBadge = isLocked
        ? `<span style="font-size:0.7em; color:#ff3b30; border:1px solid #ff3b30; padding:2px 4px; border-radius:4px; font-weight:bold;">비활성</span>`
        : "";

      card.innerHTML = `
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                          <div>
                              <div style='font-weight:900; color:${isLocked ? "var(--text-sub)" : "var(--text-main)"}; font-size:1.02em; display:flex; align-items:center; gap:6px; ${isLocked ? "text-decoration:line-through;" : ""}'>
                                  ${_esc(item.admin_name)} <span style='font-size:0.85em; font-weight:500; color:var(--text-sub);'>(${_esc(item.admin_id)})</span> ${statusBadge}
                              </div>
                              <div style='font-size:0.8em; color:var(--text-sub); margin-top:4px;'>등급: ${item.role === "SYSTEM" ? "System Admin" : "일반 관리자"}</div>
                              <div style='font-size:0.75em; color:var(--text-sub); margin-top:3px;'>🕒 최근 접속: ${item.last_login_at ? String(item.last_login_at).substring(0, 16).replace("T", " ") : "기록 없음"}</div>
                          </div>
                          <button onclick="showAdminConnInfo('${_argq(item.admin_id)}', '${_argq(item.admin_name)}')" style="flex-shrink:0; background:rgba(10,132,255,0.1); border:1px solid #0a84ff; color:#0a84ff; border-radius:6px; padding:6px 10px; font-size:0.8em; cursor:pointer; font-weight:900; white-space:nowrap;">📡 접속확인</button>
                      </div>
                      <div style='display:flex; width:100%; gap:8px; margin-top:4px;'>${actionArea}</div>
                  `;
      return card;
    };

    // ① 정상 계정 리스트 먼저 주입
    activeUsers.forEach((u) => container.appendChild(buildCard(u, false)));

    // ② 4번 요구사항: 비활성 계정이 존재할 때만 중간 구분선 장착
    if (lockedUsers.length > 0) {
      const divider = document.createElement("div");
      divider.style =
        "text-align:center; margin:25px 0 15px 0; font-size:0.8em; color:#ff3b30; font-weight:800; display:flex; align-items:center; gap:10px; user-select:none;";
      divider.innerHTML = `<div style="flex:1; border-bottom:1px dashed rgba(255,59,48,0.25)"></div> 🛑 비활성화된 관리자 계정 이력 <div style="flex:1; border-bottom:1px dashed rgba(255,59,48,0.25)"></div>`;
      container.appendChild(divider);

      // ③ 비활성 계정 리스트 하단 주입
      lockedUsers.forEach((u) => container.appendChild(buildCard(u, true)));
    }
  });
}

function bindBioAuthEvents() {
  const bioSubmitBtn = document.getElementById("bioSubmitBtn");
  const bioCancelBtn = document.getElementById("bioCancelBtn");
  const bioPwInput = document.getElementById("bioConfirmPwInput");

  // 연결 확인용 로그 (콘솔에서 확인 가능)

  if (bioCancelBtn) {
    bioCancelBtn.onclick = function () {
      closeBioPwModal();
    };
  }
  if (bioPwInput) {
    bioPwInput.onkeypress = function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (bioSubmitBtn) bioSubmitBtn.click(); // 엔터 시 등록 버튼 클릭 강제 트리거
      }
    };
  }

  if (bioSubmitBtn) {
    bioSubmitBtn.onclick = null; // 인라인 클릭 잔재 완벽 파괴

    bioSubmitBtn.onclick = function (e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation(); // 사파리 중복 버블링 차단
      }

      // 1️⃣ [보안 가드] iOS PWA 환경에서 생체인증 API 존재 여부 검사
      if (!window.navigator.credentials || !window.navigator.credentials.create) {
        alert(
          "⚠️ 현재 웹앱(PWA) 독립 실행 환경에서 iOS 생체 인증 API가 제한되어 있습니다.\n\n💡 해결책: 홈 화면 앱 대신 사파리(Safari) 브라우저 앱을 열고 직접 접속하여 패스키를 등록해 주세요.",
        );
        return;
      }

      const pwInput = document.getElementById("bioConfirmPwInput");
      let adminPw = pwInput ? pwInput.value.trim() : "";
      if (!adminPw) {
        showToast("비밀번호를 입력해 주세요.", 2000);
        return;
      }

      let adminId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id");

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      window.crypto.getRandomValues(userId);

      // 2️⃣ [즉사 방지] 동기식 TypeError까지 완벽하게 잡아내기 위한 강력한 try-catch 구문
      try {
        window.navigator.credentials
          .create({
            publicKey: {
              challenge: challenge.buffer,
              rp: { name: "Coloplast 시스템", id: window.location.hostname },
              user: { id: userId.buffer, name: adminId, displayName: adminId },
              pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -257 },
              ],
              authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
              timeout: 60000,
            },
          })
          .then(function (credential) {
            if (!credential) throw new Error("패스키 토큰 취득 실패");

            const modal = document.getElementById("bioPwConfirmModal");
            if (modal) modal.style.display = "none";

            showToast("서버 보안 검증 중...", 0);

            // 후속 암호화 처리를 위한 IIFE 구동
            (async function () {
              const res = await apiCall({ source: "vercel", action: "LOGIN", data: { id: adminId, pw: adminPw } });
              if (res === null) {
                showToast("⚠️ 서버 연결에 실패했습니다.", 2500);
                return;
              }
              if (res.success) {
                localStorage.setItem("bio_registered", "true");
                localStorage.setItem("bio_id", adminId);
                localStorage.setItem("bio_token", res.session_token || "");
                const tg = document.getElementById("toggleBioAuth");
                if (tg) tg.checked = true;
                showToast("✅ 생체 인증(패스키)이 기기에 안전하게 등록되었습니다.", 2500);
                if (pwInput) pwInput.value = "";
              } else {
                alert(
                  "비밀번호가 일치하지 않습니다. 등록이 취소됩니다.\n(※ 기기에 방금 저장된 패스키는 무효 처리되므로 삭제 권장)",
                );
                const toggle = document.getElementById("toggleBioAuth");
                if (toggle) toggle.checked = false;
              }
            })();
          })
          .catch(function (err) {
            console.warn("패스키 생성 프로미스 거부:", err);
            alert(
              "⚠️ 생체 인증 거부 및 실패: " + err.message + "\n(도메인 보안 정책 또는 IP 주소 접속 여부를 확인하세요)",
            );
            const toggle = document.getElementById("toggleBioAuth");
            if (toggle) toggle.checked = false;
          });
      } catch (syncErr) {
        // 패스키 창 옵션 빌드 중 즉시 에러가 터졌을 때 구출
        alert("⚠️ 패스키 내부 엔진 가동 즉시 에러: " + syncErr.message);
      }
    };
  }
}

function initNativeBottomSheet() {
  document.querySelectorAll(".overlay-modal").forEach((modal) => {
    const box = modal.querySelector(".modal-box");
    if (!box) return;

    // 🚨 핵심: 쪼그만 손잡이뿐만 아니라 헤더 전체 가로 영역을 타겟으로 잡음
    const handle = box.querySelector(".bottom-sheet-handle");
    const header = box.querySelector(".modal-header");

    const startDrag = (e) => {
      // 인풋창이나 버튼을 누른 경우는 텍스트 입력/클릭을 위해 드래그 무시
      if (e.target && ["INPUT", "TEXTAREA", "BUTTON", "SELECT"].includes(e.target.tagName)) return;

      // 모달 내용물이 아래로 스크롤되어 있는 상태면 드래그 무시 (맨 위일 때만 닫기 허용)
      if (box.scrollTop > 5) return;

      swipeModalVars.activeBox = box;
      swipeModalVars.activeModal = modal;
      swipeModalVars.startY = e.type.includes("touch") ? e.touches[0].clientY : e.clientY;
      swipeModalVars.currentY = swipeModalVars.startY;
      swipeModalVars.isDragging = true;
      swipeModalVars.startTime = Date.now();

      // 드래그 중에는 부드럽게 손가락을 따라오도록 트랜지션 해제
      box.style.transition = "none";
    };

    const attach = (el) => {
      if (!el) return;
      el.addEventListener("touchstart", startDrag, { passive: true });
      el.addEventListener("mousedown", startDrag);
      el.style.cursor = "grab";
    };

    // 손잡이, 헤더, 그리고 모달창의 맨 윗부분 빈 공간을 모두 드래그 패드로 지정!
    attach(handle);
    attach(header);
    box.addEventListener(
      "touchstart",
      (e) => {
        if (e.target === box) startDrag(e);
      },
      { passive: true },
    );
    box.addEventListener("mousedown", (e) => {
      if (e.target === box) startDrag(e);
    });
  });

  // 🚨 드래그 중인 손가락/마우스 움직임은 화면 전체(document)에서 절대 안 놓치고 캐치!
  const moveDrag = (e) => {
    if (!swipeModalVars.isDragging || !swipeModalVars.activeBox) return;
    let clientY = e.type.includes("touch") ? e.touches[0].clientY : e.clientY;
    let diff = clientY - swipeModalVars.startY;

    // 아래로 당길 때만 작동 (위로 올리면 고무줄처럼 튕기지 않고 단단하게 버팀)
    if (diff > 0) {
      if (e.cancelable) e.preventDefault(); // 브라우저 자체 스크롤 락 (화면 딸려 올라감 방지)
      swipeModalVars.activeBox.style.transform = `translateY(${diff}px)`;
      swipeModalVars.currentY = clientY;
    }
  };

  const endDrag = (e) => {
    if (!swipeModalVars.isDragging || !swipeModalVars.activeBox) return;
    swipeModalVars.isDragging = false;

    let diff = swipeModalVars.currentY - swipeModalVars.startY;
    let velocity = diff / (Date.now() - swipeModalVars.startTime); // 손가락 튕기는 속도 계산
    let box = swipeModalVars.activeBox;
    let modal = swipeModalVars.activeModal;

    // 손을 떼는 순간 쫀득한 스프링 애니메이션 복구
    box.style.transition = "transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)";

    // 속도가 빠르게 휙! 내리거나 (0.5), 절반 이상(120px) 푹 내렸으면 닫기
    if (velocity > 0.5 || diff > 120) {
      box.style.transform = "translateY(100%)";
      setTimeout(() => {
        modal.style.display = "none";
        box.style.transform = ""; // 다음번 열릴 때를 위해 원상복구
        // 스와이프로 닫아도 일정 파란 강조 제거 (닫기버튼·배경 클릭과 동일하게 통일)
        if (typeof clearClickedHighlight === "function") clearClickedHighlight();
      }, 300);
    } else {
      // 살짝 내리다 말았으면 다시 제자리로 튕겨 올라감
      box.style.transform = "translateY(0)";
      setTimeout(() => {
        box.style.transform = "";
      }, 300);
    }

    swipeModalVars.activeBox = null;
    swipeModalVars.activeModal = null;
  };

  // 글로벌 이벤트 리스너 부착
  document.addEventListener("touchmove", moveDrag, { passive: false });
  document.addEventListener("touchend", endDrag);
  document.addEventListener("touchcancel", endDrag);
  document.addEventListener("mousemove", moveDrag, { passive: false });
  document.addEventListener("mouseup", endDrag);
}

function refreshAuditLogs() {
  const timeline = document.getElementById("masterLogTimeline");
  const pager = document.getElementById("logMasterPaginationBar");
  if (!timeline) return;

  const startDate = document.getElementById("logStartDate") ? document.getElementById("logStartDate").value : "";
  const endDate = document.getElementById("logEndDate") ? document.getElementById("logEndDate").value : "";
  const keyword = document.getElementById("logKeyword") ? document.getElementById("logKeyword").value.trim() : "";
  const limit = document.getElementById("logMasterLimit") ? document.getElementById("logMasterLimit").value : 50;
  const actGroup = document.getElementById("logActGroup") ? document.getElementById("logActGroup").value : "";

  timeline.innerHTML =
    "<div style='color:var(--text-sub); text-align:center; padding:15px; font-weight:800;'>보안 로그 동기화 및 검색 중...</div>";
  if (pager) pager.innerHTML = "";

  apiCall({
    source: "vercel",
    action: "GET_AUDIT_LOGS",
    startDate: startDate,
    endDate: endDate,
    keyword: keyword,
    actGroup: actGroup,
    limit: Number(limit),
    page: logCurrentPage,
  }).then(function (res) {
    if (res === null || !res.success || !res.logs || res.logs.length === 0) {
      timeline.innerHTML =
        "<div style='color:var(--text-sub); text-align:center; padding:20px;'>검색 조건에 맞는 감사 로그가 없습니다.</div>";
      return;
    }

    timeline.innerHTML = "";
    // 결과 건수 요약
    const _s = (res.page - 1) * Number(limit) + 1;
    const _e = (res.page - 1) * Number(limit) + res.logs.length;
    timeline.insertAdjacentHTML(
      "beforeend",
      `<div style="font-size:0.8em; color:var(--text-sub); font-weight:700; margin-bottom:10px;">총 <b style="color:#0a84ff;">${res.totalCount}</b>건 중 ${_s}~${_e} 표시</div>`,
    );

    res.logs.forEach((log) => {
      const item = document.createElement("div");
      item.className = "audit-log-item";
      item.style =
        "padding-bottom:12px; border-bottom:1px solid var(--border-color); font-size:0.9em; box-sizing:border-box; margin-bottom:10px;";

      let rawDate = log.created_at || "";
      // "2026-05-18 13:45:00" 형태에서 년도(2026-)와 초(:00)를 떼어내고 "05.18 13:45"로 깔끔하게 포장
      let dateStr = rawDate.length >= 16 ? rawDate.substring(5, 16).replace("-", ".") : rawDate;

      item.innerHTML = `
                      <div style='display:flex; justify-content:space-between; margin-bottom:4px;'>
                          <span style='font-weight:900; color:#0a84ff;'>ID: ${_esc(log.admin_id)}</span>
                          <span style='font-size:0.85em; color:var(--text-sub);'>${dateStr}</span>
                      </div>
                      <div style='color:var(--text-main); font-weight:700;'>액션: <span style='color:var(--sun-color);'>${_esc(log.action_type)}</span></div>
                      <div style='color:var(--text-sub); font-size:0.88em; margin-top:2px; word-break:break-all;'>내역: ${_esc(log.description)}</div>
                  `;
      timeline.appendChild(item);
    });

    _renderPager(pager, res, "changeLogPage", "changeLogPage");
  });
}

function refreshConnLogs() {
  const timeline = document.getElementById("masterConnTimeline");
  const pager = document.getElementById("logConnPaginationBar");
  if (!timeline) return;

  const keyword = document.getElementById("logConnKeyword")
    ? document.getElementById("logConnKeyword").value.trim()
    : "";
  const limit = document.getElementById("logConnLimit") ? document.getElementById("logConnLimit").value : 100;
  const connType = document.getElementById("logConnType") ? document.getElementById("logConnType").value : "";
  const startDate = document.getElementById("logConnStart") ? document.getElementById("logConnStart").value : "";
  const endDate = document.getElementById("logConnEnd") ? document.getElementById("logConnEnd").value : "";

  timeline.innerHTML =
    "<div style='color:var(--text-sub); text-align:center; padding:15px; font-weight:800;'>접속망 트래킹 중... ⏳</div>";
  if (pager) pager.innerHTML = "";

  apiCall({
    source: "vercel",
    action: "GET_ALL_CONN_LOGS",
    keyword: keyword,
    connType: connType,
    startDate: startDate,
    endDate: endDate,
    limit: Number(limit),
    page: connLogCurrentPage,
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null || !res.success || !res.logs || res.logs.length === 0) {
      timeline.innerHTML =
        "<div style='color:var(--text-sub); text-align:center; padding:20px;'>검색 조건에 맞는 접속 로그가 없습니다.</div>";
      return;
    }

    const _s = (res.page - 1) * Number(limit) + 1;
    const _e = (res.page - 1) * Number(limit) + res.logs.length;
    let html = `<div style="font-size:0.8em; color:var(--text-sub); font-weight:700; padding:0 0 8px 5px;">총 <b style="color:#0a84ff;">${res.totalCount}</b>건 중 ${_s}~${_e} 표시</div>`;
    res.logs.forEach((log) => {
      let dateStr = log.created_at ? log.created_at.substring(5, 19).replace("-", ".") : "";
      let tColor = log.action_type === "GUEST" ? "#ff9f0a" : log.action_type === "AUTO_LOGIN" ? "#34c759" : "#0a84ff";
      let typeShort = log.action_type === "AUTO_LOGIN" ? "AUTO" : log.action_type;

      // 🚨 [IP 복원 패치] 자동로그인/GUEST 설명란에 IP가 없으면 강제로 붙여줌! (과거 데이터 호환)
      let desc = log.description || "";
      let ipStr = log.ip_address || "IP알수없음";
      if (!desc.includes("IP:")) {
        desc = `IP: ${ipStr} | ${desc}`;
      }

      // 🚨 말줄임표(ellipsis)를 완전히 해제해서 긴 내용이 스크롤되어 다 보이게 변경!
      html += `
                  <div style="display:flex; align-items:center; gap:8px; padding:10px 0; border-bottom:1px solid var(--border-color); font-size:0.9em; white-space:nowrap;">
                      <span style="color:var(--text-sub); font-family:monospace; width:110px; flex-shrink:0;">${dateStr}</span>
                      <span style="background:rgba(128,128,128,0.1); color:${tColor}; font-weight:900; width:50px; flex-shrink:0; text-align:center; padding:3px 0; border-radius:4px; font-size:0.85em;">${_esc(typeShort)}</span>
                      <span style="font-weight:900; color:var(--text-main); flex-shrink:0; width:80px; margin-left:8px;">${_esc(log.admin_id || "손님")}</span>
                      <span style="color:var(--text-sub); flex:1; margin-left:12px;">${_descWithIpLink(desc)}</span>
                  </div>`;
    });
    timeline.innerHTML = html;

    // ... (위쪽 코드는 그대로 유지) ...

    _renderPager(pager, res, "changeConnLogPage", "changeConnLogPage", { compact: true });
  });
}

function toggleAdmin() {
  if (isAdmin) {
    let savedId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id") || "관리자";
    let savedRole = localStorage.getItem("admin_role") || sessionStorage.getItem("admin_role");

    document.getElementById("myInfoAdminId").innerText = `ID: ${savedId}`;

    const roleTextElem = document.getElementById("myInfoAdminRole");
    const iconElem = document.getElementById("myInfoAdminIcon");

    const isMasterUser =
      savedId.toLowerCase() === "admin" ||
      savedId.toLowerCase() === "silverscent" ||
      (savedRole &&
        (savedRole.toUpperCase().includes("SUPER") ||
          savedRole.toUpperCase().includes("MASTER") ||
          savedRole.toUpperCase().includes("SYSTEM")));

    if (iconElem) {
      iconElem.innerText = "🧑‍💻";
      if (isMasterUser) {
        iconElem.style.background = "linear-gradient(135deg, #0a84ff, #005bb5)";
        iconElem.style.boxShadow = "0 4px 10px rgba(10, 132, 255, 0.3)";
      } else {
        iconElem.style.background = "linear-gradient(135deg, #34c759, #28a745)";
        iconElem.style.boxShadow = "0 4px 10px rgba(52, 199, 89, 0.3)";
      }
    }

    if (isMasterUser) {
      roleTextElem.innerText = "System Administrator";
      roleTextElem.style.color = "#0a84ff";
    } else {
      roleTextElem.innerText = "일반 관리자";
      roleTextElem.style.color = "var(--text-main)";
    }

    let isBioRegistered =
      localStorage.getItem("bio_registered") === "true" && localStorage.getItem("bio_id") === savedId;
    document.getElementById("toggleBioAuth").checked = isBioRegistered;

    let isAutoLogin = localStorage.getItem("auto_login") !== "false";
    document.getElementById("toggleAutoLogin").checked = isAutoLogin;

    document.getElementById("pwChangeFormContainer").style.display = "none";

    // 모달 열 때마다 마스터 권한 버튼 재확인 (첫 로그인 직후 표시 누락 방지)
    if (typeof checkMasterAuthButtonVisibility === "function") checkMasterAuthButtonVisibility();

    document.getElementById("myInfoModal").style.display = "flex";
    return;
  }

  if (localStorage.getItem("bio_registered") === "true" && window.PublicKeyCredential) {
    handleBioLogin();
    return;
  }
  openLoginModal();
}

async function saveFullRowDB(id) {
  let updateData = { rowId: id };

  if (currentType === "out") {
    updateData.company = document.getElementById(`db-o-comp-${id}`).value.trim();
    updateData.pal = Number(document.getElementById(`db-o-pal-${id}`).value.trim() || 0);
    updateData.box = Number(document.getElementById(`db-o-box-${id}`).value.trim() || 0);
    updateData.outbound_date = document.getElementById(`db-o-date-${id}`).value.trim();
    updateData.etc = document.getElementById(`db-o-etc-${id}`).value.trim();
    updateData.created_at = document.getElementById(`db-o-cre-${id}`).value.trim();
    updateData.sort_idx = Number(document.getElementById(`db-o-sort-${id}`).value.trim() || 0);
    updateData.isDone = Number(document.getElementById(`db-o-done-${id}`).value.trim() || 0);
  } else {
    updateData.bl_number = document.getElementById(`db-i-bl-${id}`).value.trim();
    updateData.pallets = Number(document.getElementById(`db-i-pal-${id}`).value.trim() || 0);
    updateData.eta = document.getElementById(`db-i-eta-${id}`).value.trim();
    updateData.receive_date = document.getElementById(`db-i-date-${id}`).value.trim();
    updateData.fwd = document.getElementById(`db-i-fwd-${id}`).value.trim();
    updateData.s_type = document.getElementById(`db-i-stype-${id}`).value.trim();
    updateData.invoice = document.getElementById(`db-i-inv-${id}`).value.trim();
    updateData.remarks = document.getElementById(`db-i-rem-${id}`).value.trim();
    updateData.last_updated = document.getElementById(`db-i-upd-${id}`).value.trim();
    updateData.sort_idx = Number(document.getElementById(`db-i-sort-${id}`).value.trim() || 0);
    updateData.status = document.getElementById(`db-i-stat-${id}`).value.trim();
    updateData.is_ai_modified = Number(document.getElementById(`db-i-ai-${id}`).value.trim() || 0);
  }

  if (!(await uiConfirm(`[ID: ${id}] 변경된 모든 컬럼 데이터를 덮어쓰시겠습니까?`))) return;

  showToast("⏳ DB 동기화 중...", 0);
  apiCall({
    source: "vercel",
    action: "UPDATE_RAW_ROW_FULL",
    updateData: updateData,
    type: currentType,
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 원본 데이터 업데이트 완료", 2000);
      searchRawDatabaseRows();
      if (typeof renderCalendar === "function") renderCalendar();
    } else {
      showToast("❌ 실패: " + res.msg, 2500);
    }
  });
}

async function addNewRowDirectDB(type) {
  if (!(await uiConfirm("입력하신 내용으로 DB에 신규 데이터를 강제 생성하시겠습니까?"))) return;

  let insertData = {};
  if (type === "out") {
    insertData = {
      company: document.getElementById("db-o-comp-new").value,
      pal: document.getElementById("db-o-pal-new").value,
      box: document.getElementById("db-o-box-new").value,
      outbound_date: document.getElementById("db-o-date-new").value,
      etc: document.getElementById("db-o-etc-new").value,
      sort_idx: document.getElementById("db-o-sort-new").value,
      isDone: document.getElementById("db-o-done-new").value,
    };
    if (!insertData.company) {
      showToast("⚠️ 업체명은 필수입니다.", 2000);
      return;
    }
  } else {
    insertData = {
      bl_number: document.getElementById("db-i-bl-new").value,
      pallets: document.getElementById("db-i-pal-new").value,
      eta: document.getElementById("db-i-eta-new").value,
      receive_date: document.getElementById("db-i-date-new").value,
      fwd: document.getElementById("db-i-fwd-new").value,
      s_type: document.getElementById("db-i-stype-new").value,
      invoice: document.getElementById("db-i-inv-new").value,
      remarks: document.getElementById("db-i-rem-new").value,
      sort_idx: document.getElementById("db-i-sort-new").value,
      status: document.getElementById("db-i-stat-new").value,
      is_ai_modified: document.getElementById("db-i-ai-new").value,
    };
    if (!insertData.bl_number) {
      showToast("⚠️ B/L 번호는 필수입니다.", 2000);
      return;
    }
  }

  apiCall({
    source: "vercel",
    action: "ADD_RAW_ROW_DIRECT",
    type: currentType,
    insertData: insertData,
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 신규 데이터 DB 삽입 완료!", 2000);
      searchRawDatabaseRows();
      if (typeof renderCalendar === "function") renderCalendar();
    } else {
      showToast("오류 발생: " + res.msg, 3000);
    }
  });
}

function handleLogin() {
  const idElem = document.getElementById("adminIdInput");
  const pwElem = document.getElementById("adminPwInput");
  if (!idElem || !pwElem) return;
  const id = idElem.value.trim();
  const pw = pwElem.value.trim();
  if (!id || !pw) {
    showToast("⚠️ 아이디와 비밀번호를 모두 입력하세요.", 2000);
    return;
  }

  // 🚨 [UX 패치] 버튼 중복 터치 방지 및 로딩 표시
  const loginBtn = document.querySelector('#adminLoginModal button[onclick="handleLogin()"]');
  let originalBtnText = "로그인";
  if (loginBtn) {
    originalBtnText = loginBtn.innerHTML;
    loginBtn.innerHTML = "⏳ 확인 중...";
    loginBtn.style.pointerEvents = "none";
    loginBtn.style.opacity = "0.7";
  }

  apiCall({ source: "vercel", action: "LOGIN", data: { id, pw } }).then(function (res) {
    if (loginBtn) {
      loginBtn.innerHTML = originalBtnText;
      loginBtn.style.pointerEvents = "auto";
      loginBtn.style.opacity = "1";
    }
    if (res === null) {
      showToast(`❌ 통신 오류가 발생했습니다.`, 2500);
      return;
    }

    if (res.success) {
      window.isAdmin = true;
      isAdmin = true;
      saveAuthData(res.admin_id, res.role, true, res.session_token);
      if (res.session_token) window._sessionToken = res.session_token;

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

      document.getElementById("adminLoginModal").style.display = "none";
      showToast(`✅ ${res.name} 관리자님 환영합니다!`, 2000);
      if (typeof renderCalendar === "function") renderCalendar();
      if (typeof updateFooterUI === "function") updateFooterUI();
      if (typeof checkMasterAuthButtonVisibility === "function") checkMasterAuthButtonVisibility();
      if (typeof showAiFabIfAdmin === "function") showAiFabIfAdmin();
      // 로그인 후 연락처 포함 최신 CRM 재동기화 (비로그인 땐 연락처 빠진 상태였음)
      if (typeof syncCrmDataBackground === "function") syncCrmDataBackground();
      idElem.value = "";
      pwElem.value = "";
    } else {
      showToast(`❌ ${res.msg}`, 2500);
    }
  });
}

async function handleBioToggleChange(checkbox) {
  if (checkbox.checked) {
    if (!window.PublicKeyCredential) {
      alert("이 기기 브라우저에서는 생체 인증(WebAuthn)을 지원하지 않습니다.");
      checkbox.checked = false;
      return;
    }
    // 💡 구식 prompt 대신 예쁜 미니 모달을 띄워 비밀번호부터 안전하게 받아냅니다!
    document.getElementById("bioConfirmPwInput").value = "";
    document.getElementById("bioPwConfirmModal").style.display = "flex";
    setTimeout(() => document.getElementById("bioConfirmPwInput").focus(), 150);
  } else {
    let currentId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id");
    let bioId = localStorage.getItem("bio_id");

    if (localStorage.getItem("bio_registered") === "true" && currentId !== bioId) {
      showToast("⚠️ 본인 계정으로 등록된 생체 인증 정보가 아닙니다.", 2500);
      checkbox.checked = false;
      return;
    }

    if (await uiConfirm("생체 인증 로그인을 해제하시겠습니까?\n(※ 기기에 저장된 패스키는 브라우저 설정에서 직접 지워주세요)")) {
      localStorage.removeItem("bio_registered");
      localStorage.removeItem("bio_id");
      localStorage.removeItem("bio_token");
      showToast("🗑️ 생체 인증이 해제되었습니다.", 2000);
    } else {
      checkbox.checked = true;
    }
  }
}

async function executeMyPasswordChange() {
  const currentInput = document.getElementById("mySettingsCurrentPw");
  const newInput = document.getElementById("mySettingsNewPw");
  if (!currentInput || !newInput) return;

  const curPw = currentInput.value.trim();
  const newPw = newInput.value.trim();

  if (!curPw || !newPw) {
    showToast("⚠️ 현재 비밀번호와 새 비밀번호를 모두 입력하세요.", 2000);
    return;
  }
  if (curPw === newPw) {
    showToast("⚠️ 새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.", 2000);
    return;
  }
  if (!(await uiConfirm("정말 비밀번호를 변경하시겠습니까?"))) return;

  showToast("⏳ 보안 검증 및 변경 중...", 0);

  apiCall({
    source: "vercel",
    action: "CHANGE_MY_PASSWORD",
    data: { currentPw: curPw, newPw: newPw },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 비밀번호 변경 완료! 다음 로그인부터 적용됩니다.", 3000);
      currentInput.value = "";
      newInput.value = "";
      document.getElementById("myInfoModal").style.display = "none";
    } else {
      showToast(`❌ 변경 실패: ${res.msg}`, 3000);
    }
  });
}

function checkAndFetchHolidays(year) {
  const cacheKey = `holidays_${year}`;
  // 1. 일단 로컬 스토리지(캐시)에서 먼저 꺼내서 즉시 적용
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    Object.assign(window.yearlyHolidays, parsed);
    if (typeof renderCalendar === "function") renderCalendar();
  }

  // 2. 그 뒤에 백그라운드에서 최신 데이터를 긁어와서 캐시 업데이트
  apiCall({ source: "vercel", action: "GET_YEARLY_HOLIDAYS", year: year }).then((res) => {
    if (res && Array.isArray(res)) {
      const newHolidays = {};
      res.forEach((item) => {
        if (typeof item === "object") newHolidays[item.date] = item.name;
        else newHolidays[item] = true;
      });
      if (JSON.stringify(newHolidays) !== cached) {
        localStorage.setItem(cacheKey, JSON.stringify(newHolidays));
        Object.assign(window.yearlyHolidays, newHolidays);
        if (typeof renderCalendar === "function") renderCalendar();
      }
    }
  });
}

async function createNewAdminAccount() {
  const id = document.getElementById("newAdminId").value.trim();
  const name = document.getElementById("newAdminName").value.trim();
  const pw = document.getElementById("newAdminPw").value.trim();

  if (!id || !name || !pw) {
    showToast("⚠️ 모든 항목을 빠짐없이 입력하세요.", 2000);
    return;
  }

  if (!(await uiConfirm(`[${name}(${id})] 계정을 신규 운영 관리자로 등록합니까?`))) return;

  showToast("⏳ 원격 데이터베이스 동기화 중...", 0);
  apiCall({
    source: "vercel",
    action: "CREATE_ADMIN",
    data: { id, name, pw: pw },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 신규 관리자 계정이 활성화되었습니다.", 2000);
      document.getElementById("newAdminId").value = "";
      document.getElementById("newAdminName").value = "";
      document.getElementById("newAdminPw").value = "";
      refreshAdminList();
    } else {
      showToast(`❌ 오류: ${res.msg}`, 2500);
    }
  });
}

function saveAuthData(id, role, isSave, session_token) {
  const isAuto = localStorage.getItem("auto_login") !== "false";
  const targetStorage = isAuto ? localStorage : sessionStorage;
  const otherStorage = isAuto ? sessionStorage : localStorage;

  if (isSave) {
    otherStorage.removeItem("isAdmin");
    otherStorage.removeItem("admin_id");
    otherStorage.removeItem("admin_role");
    otherStorage.removeItem("session_token");
    targetStorage.setItem("isAdmin", "true");
    targetStorage.setItem("admin_id", id);
    targetStorage.setItem("admin_role", role);
    if (session_token) targetStorage.setItem("session_token", session_token);
  } else {
    localStorage.removeItem("isAdmin");
    localStorage.removeItem("admin_id");
    localStorage.removeItem("admin_role");
    localStorage.removeItem("session_token");
    sessionStorage.removeItem("isAdmin");
    sessionStorage.removeItem("admin_id");
    sessionStorage.removeItem("admin_role");
    sessionStorage.removeItem("session_token");
    // ⚠️ bio_registered/bio_id/bio_token 은 로그아웃해도 유지 (생체 재로그인용)
  }
}

function checkMasterAuthButtonVisibility() {
  const btn = document.getElementById("masterDashboardBtn");
  if (!btn) return;

  // 🚨 [핵심 패치] 자동로그인(ON/OFF) 상태에 따라 저장 위치가 다르므로 양쪽 모두 검사!
  let isAdminActive = localStorage.getItem("isAdmin") === "true" || sessionStorage.getItem("isAdmin") === "true";
  let adminId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id") || "";
  let role = localStorage.getItem("admin_role") || sessionStorage.getItem("admin_role") || "";

  const isMasterUser =
    adminId.toLowerCase() === "admin" ||
    adminId.toLowerCase() === "silverscent" ||
    role.toUpperCase().includes("SUPER") ||
    role.toUpperCase().includes("MASTER") ||
    role.toUpperCase().includes("SYSTEM");

  if (isAdminActive && isMasterUser) {
    btn.style.display = "block";
  } else {
    btn.style.display = "none";
  }
}

function renderOcrFilterBadges() {
  const container = document.getElementById("ocrFilterBadgeContainer");
  if (!container) return;
  if (globalOcrFilters.length === 0) {
    container.innerHTML =
      "<div style='color:var(--text-sub); font-size:0.85em; font-weight:800;'>등록된 단어가 없습니다.</div>";
    return;
  }

  let html = "";
  globalOcrFilters.forEach((word, idx) => {
    html += `<div style="display: inline-flex; align-items: center; gap: 6px; background: var(--card-bg); color: var(--text-main); padding: 6px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 800; border: 1px solid var(--border-color); box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                    <span>${word}</span>
                    <span onclick="removeOcrFilterWord(${idx})" style="color: #ff3b30; cursor: pointer; font-weight: 900; margin-left: 4px; padding: 0 2px; font-size: 1.1em;">✕</span>
                 </div>`;
  });
  container.innerHTML = html;
}

function executeLogout() {
  const logoutModal = document.getElementById("logoutConfirmModal");
  if (logoutModal) logoutModal.style.display = "none";

  const infoModal = document.getElementById("myInfoModal");
  if (infoModal) infoModal.style.display = "none";

  let adminId = localStorage.getItem("admin_id") || sessionStorage.getItem("admin_id");

  // 👇 🚨 [로그아웃 기록 전송] 내 폰의 메모리를 지우기 전에 서버로 먼저 알림!
  if (adminId) {
    apiCall({ source: "vercel", action: "LOG_LOGOUT", admin_id: adminId });
  }

  window.isAdmin = false;
  isAdmin = false;

  saveAuthData(null, null, false);

  // 🚨 서버로 문자가 날아갈 시간(0.1초)을 아주 잠깐 벌어준 뒤 새로고침!
  setTimeout(() => {
    location.reload();
  }, 100);
}

function editRowDirectFromDB(rowId, oldName) {
  let newName = prompt(`[ID: ${rowId}] 새로운 거래처명 또는 B/L 번호를 입력하세요:`, oldName);
  if (!newName || newName.trim() === "" || newName === oldName) return;

  showToast("⏳ 원본 데이터 수정 중...", 0);
  apiCall({
    source: "vercel",
    action: "UPDATE_RAW_ROW_DIRECT",
    rowId: rowId,
    type: currentType,
    newName: newName.trim(),
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 수정 완료!", 2000);
      searchRawDatabaseRows();
      if (typeof renderCalendar === "function") renderCalendar();
    } else {
      showToast("❌ 수정 실패", 2000);
    }
  });
}

function switchMasterTab(tabId) {
  document.querySelectorAll(".master-tab-content").forEach((el) => (el.style.display = "none"));
  document.querySelectorAll(".master-tab-btn").forEach((btn) => btn.classList.remove("active"));

  document.getElementById(`master-tab-${tabId}`).style.display = "block";
  const activeBtn = Array.from(document.querySelectorAll(".master-tab-btn")).find((b) =>
    b.getAttribute("onclick").includes(tabId),
  );
  if (activeBtn) activeBtn.classList.add("active");

  if (tabId === "audit-log") refreshAuditLogs();
  if (tabId === "conn-log") refreshConnLogs(); // 🚨 이 줄 추가!
  if (tabId === "db-mgr") searchRawDatabaseRows();
  // 👇 🚨 이 한 줄만 추가되었습니다!
  if (tabId === "filter-mgr") loadOcrFilterWords();
}

async function deleteRowDirectFromDB(rowId) {
  if (
    !(await uiConfirm(
      `⚠️ [초긴급 경고]\n데이터베이스 일련번호 [ID: ${rowId}] 로우를 영구 파기합니까?\n달력 동기화 데이터 꼬임 현상을 정밀 강제 수정할 때만 실행하세요.`,
      { danger: true },
    ))
  )
    return;

  showToast("💥 DB 로우 레벨 파괴 중...", 0);
  apiCall({
    source: "vercel",
    action: "DELETE_RAW_ROW_DIRECT",
    rowId: rowId,
    type: currentType,
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 원본 로우 파기 완료", 2000);
      searchRawDatabaseRows();
      if (typeof renderCalendar === "function") renderCalendar();
    } else {
      showToast("❌ 명령 거부됨", 2000);
    }
  });
}

function toggleNewAdminForm() {
  const form = document.getElementById("newAdminFormContainer");
  const btn = document.getElementById("toggleAdminFormBtn");
  if (!form || !btn) return;
  if (form.style.display === "none" || !form.style.display) {
    form.style.display = "block";
    btn.innerHTML = "❌ 발급 창 닫기";
    btn.style.background = "rgba(255,59,48,0.1)";
    btn.style.color = "#ff3b30";
    btn.style.borderColor = "#ff3b30";
  } else {
    form.style.display = "none";
    btn.innerHTML = "➕ 신규 어드민 계정 발급실 열기";
    btn.style.background = "rgba(10, 132, 255, 0.1)";
    btn.style.color = "#0a84ff";
    btn.style.borderColor = "#0a84ff";
  }
}

async function resetAdminPassword(id, name) {
  const newPw = prompt(`[${name}(${id})] 계정의 새로운 비밀번호를 입력하세요:`);
  if (!newPw || newPw.trim() === "") return;
  if (!(await uiConfirm(`정말 해당 계정의 비밀번호를 변경하시겠습니까?`))) return;

  showToast("⏳ 비밀번호 변경 중...", 0);
  apiCall({
    source: "vercel",
    action: "RESET_ADMIN_PW",
    data: { targetId: id, newPw: newPw },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) showToast("✅ 비밀번호가 성공적으로 초기화되었습니다.", 2000);
    else showToast(`❌ 오류: ${res.msg}`, 2500);
  });
}

async function hardDeleteAdminAccount(id, name) {
  if (
    !(await uiConfirm(
      `🚨 최후 경고: [${name}(${id})] 계정을 데이터베이스에서 완전히 삭제(Hard Delete)합니까?\n이 작업은 되돌릴 수 없으며 접속 기록 외 모든 정보가 파기됩니다!`,
      { danger: true },
    ))
  )
    return;
  showToast("💥 계정 영구 파기 중...", 0);
  apiCall({
    source: "vercel",
    action: "HARD_DELETE_ADMIN",
    data: { id: id },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("🗑️ 계정이 DB에서 완전히 파기되었습니다.", 2000);
      refreshAdminList();
    } else {
      showToast(`❌ 삭제 실패: ${res.msg}`, 3000);
    }
  });
}

function openLoginModal() {
  document.getElementById("adminPwInput").value = "";
  let idInput = document.getElementById("adminIdInput");
  if (idInput) idInput.value = "";

  const bioBtn = document.getElementById("btnBioLogin");
  if (bioBtn) bioBtn.style.display = localStorage.getItem("bio_registered") === "true" ? "block" : "none";

  document.getElementById("adminLoginModal").style.display = "flex";
  setTimeout(() => {
    if (idInput) idInput.focus();
    else document.getElementById("adminPwInput").focus();
  }, 150);
}

async function deleteAdminAccount(id, name) {
  if (!(await uiConfirm(`[확인] [${name}(${id})] 관리자 권한을 회수하고 계정을 비활성화 하시겠습니까?`))) return;
  showToast("⏳ 권한 회수 중...", 0);
  apiCall({
    source: "vercel",
    action: "DELETE_ADMIN",
    data: { id: id },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 계정이 비활성화 상태로 전환되었습니다.", 2000);
      refreshAdminList();
    } else {
      showToast(`❌ 처리 실패: ${res.msg}`, 3000);
    }
  });
}

async function reactivateAdminAccount(id, name) {
  if (!(await uiConfirm(`[${name}(${id})] 계정을 다시 활성화(ACTIVE) 복구하시겠습니까?`))) return;
  showToast("⏳ 계정 복구 중...", 0);
  apiCall({
    source: "vercel",
    action: "REACTIVATE_ADMIN",
    data: { id: id },
    admin_id: localStorage.getItem("admin_id"),
  }).then(function (res) {
    if (res === null) return;
    if (res.success) {
      showToast("✅ 관리자 계정이 활성화되었습니다.", 2000);
      refreshAdminList();
    } else {
      showToast(`❌ 복구 실패: ${res.msg}`, 3000);
    }
  });
}

function showToast(msg, duration = 2500) {
  if (msg.includes("중...") || msg.includes("완료")) return;

  const toast = document.getElementById("toast");
  toast.innerText = msg;
  toast.className = "show";
  if (window.toastTimer) clearTimeout(window.toastTimer);
  if (duration > 0) {
    window.toastTimer = setTimeout(() => {
      toast.className = toast.className.replace("show", "");
    }, duration);
  }
}

function toggleHoliday() {
  isShowHoliday = !isShowHoliday;
  localStorage.setItem("cal_show_holiday", isShowHoliday);

  const btn = document.getElementById("btnHolidayToggle");
  if (btn) {
    btn.innerHTML = isShowHoliday ? "🏖️ ON" : "🏖️ OFF";
    btn.style.color = isShowHoliday ? "#ff3b30" : "var(--text-sub)";
  }
  renderCalendar();
}

function setLoadingState(isLoading) {
  if (isLoading) activeRequests++;
  else activeRequests = Math.max(0, activeRequests - 1);

  const topFrame = document.querySelector(".top-wrapper");
  if (topFrame) {
    if (activeRequests > 0) topFrame.classList.add("syncing-glow");
    else topFrame.classList.remove("syncing-glow");
  }
}

function addOcrFilterWord() {
  const input = document.getElementById("newOcrFilterWord");
  const word = input ? input.value.trim() : "";
  if (!word) return;
  if (globalOcrFilters.includes(word)) {
    showToast("이미 등록된 단어입니다.", 1500);
    return;
  }

  globalOcrFilters.push(word);
  input.value = "";
  renderOcrFilterBadges();
  saveOcrFilterWordsToServer();
}

function _registerChartPlugins() {
  if (typeof Chart === "undefined") {
    // 아직 chart.js 로드 전이면 잠시 후 재시도
    return setTimeout(_registerChartPlugins, 50);
  }
  try {
    Chart.unregister(pieCenterTextPlugin, pieHybridLabelPlugin);
    Chart.register(pieCenterTextPlugin, pieHybridLabelPlugin);
  } catch (e) {}
}

function togglePwView() {
  const input = document.getElementById("adminPwInput");
  const icon = document.getElementById("pwToggleIcon");
  if (input.type === "password") {
    input.type = "text";
    icon.innerText = "🙈";
  } else {
    input.type = "password";
    icon.innerText = "👁️";
  }
}

function setDbSort(col) {
  if (dbSortCol === col) {
    dbSortDir = dbSortDir === "ASC" ? "DESC" : "ASC"; // 같은 컬럼 누르면 방향 전환
  } else {
    dbSortCol = col;
    dbSortDir = "ASC"; // 새 컬럼은 오름차순부터
  }
  dbCurrentPage = 1; // 정렬이 바뀌면 1페이지로 리셋
  searchRawDatabaseRows();
}

function _reopenDetailAfter(oldDate) {
  let d = oldDate === "미정" || !oldDate ? "pending" : parseInt(String(oldDate).split("-")[2], 10);
  let data = d === "pending" ? serverData.pendingItems : serverData.monthData[d] || [];
  if (data && data.length > 0) showModal(d);
}

function saveOcrFilterWordsToServer() {
  showToast("저장 중...", 0);
  apiCall({ source: "vercel", action: "SAVE_OCR_FILTERS", data: globalOcrFilters }).then(function (res) {
    if (res !== null && res.success) showToast("✅ 필터가 업데이트되었습니다.", 1500);
  });
}

function loadOcrFilterWords() {
  apiCall({ source: "vercel", action: "GET_OCR_FILTERS" }).then(function (res) {
    if (res === null) return;
    globalOcrFilters = Array.isArray(res) ? res : [];
    renderOcrFilterBadges();
  });
}

function handleCellClick(e, day) {
  if (isMultiMode) return;
  if (isLongPress) {
    setTimeout(() => {
      isLongPress = false;
    }, 100);
    return;
  }
  showModal(day);
}

async function removeOcrFilterWord(idx) {
  if (!(await uiConfirm(`'${globalOcrFilters[idx]}' 단어를 필터에서 삭제하시겠습니까?`))) return;
  globalOcrFilters.splice(idx, 1);
  renderOcrFilterBadges();
  saveOcrFilterWordsToServer();
}

function cancelPress() {
  if (isDragging) return;
  if (pressTimer) clearTimeout(pressTimer);
  if (pressTarget) {
    pressTarget.classList.remove("cell-pressing");
    pressTarget = null;
  }
}

function closeBioPwModal() {
  document.getElementById("bioPwConfirmModal").style.display = "none";
  document.getElementById("toggleBioAuth").checked = false;
}

function closeMasterDashboard() {
  document.getElementById("masterDashboardModal").style.transform = "translateX(0)";
}

function getSortIcon(col) {
  if (dbSortCol !== col) return "↕️";
  return dbSortDir === "ASC" ? "🔼" : "🔽";
}

function changeDbPage(direction) {
  dbCurrentPage += direction;
  searchRawDatabaseRows();
}

function dbPageResetAndSearch() {
  dbCurrentPage = 1;
  searchRawDatabaseRows();
}

function changePickerYear(offset) {
  tempPickerYear += offset;
  renderPicker();
}

function changeLogPage(dir) {
  logCurrentPage += dir;
  refreshAuditLogs();
}

function changeConnLogPage(dir) {
  connLogCurrentPage += dir;
  refreshConnLogs();
}

// ── 당겨서 새로고침 (Pull-to-Refresh, 원형 게이지 + 햅틱) ── 출고/입고 공통
(function initPullToRefresh() {
  let startY = 0,
    pulling = false,
    reached = false,
    el = null,
    ring = null,
    ic = null;
  const THRESH = 230; // 손가락 당김 임계값 (iOS 사파리 새로고침 느낌으로 길게)
  function ind() {
    if (!el) {
      el = document.createElement("div");
      el.id = "ptrIndicator";
      el.style.cssText =
        "position:fixed;top:8px;left:50%;z-index:99998;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--card-bg,#2a2c30);box-shadow:0 4px 14px rgba(0,0,0,0.3);transform:translate(-50%,-70px);transition:transform 0.18s cubic-bezier(0.2,0.8,0.2,1);pointer-events:none;";
      ring = document.createElement("div"); // 게이지 링 (conic-gradient)
      ring.style.cssText =
        "position:absolute;inset:0;border-radius:50%;background:conic-gradient(#0a84ff 0deg, rgba(128,128,128,0.25) 0deg);";
      const hole = document.createElement("div"); // 가운데 구멍(링 효과)
      hole.style.cssText = "position:absolute;inset:4px;border-radius:50%;background:var(--card-bg,#2a2c30);";
      ic = document.createElement("span"); // 화살표/스피너 아이콘
      ic.textContent = "↓";
      ic.style.cssText =
        "position:relative;z-index:1;font-weight:900;color:#0a84ff;font-size:1.1em;transition:transform 0.15s;";
      el.appendChild(ring);
      el.appendChild(hole);
      el.appendChild(ic);
      document.body.appendChild(el);
    }
    return el;
  }
  const blocked = (t) =>
    !t ||
    (t.closest &&
      (t.closest(".item-tag") ||
        t.closest(".overlay-modal") ||
        t.closest(".modal") ||
        t.closest("#dashboardModal") ||
        t.closest("#masterDashboardModal") ||
        t.closest(".pending-item")));

  document.addEventListener(
    "touchstart",
    (e) => {
      if (window.scrollY > 0 || blocked(e.target)) {
        pulling = false;
        return;
      }
      startY = e.touches[0].clientY;
      pulling = true;
      reached = false;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      let dy = e.touches[0].clientY - startY;
      const box = ind();
      if (dy <= 0) {
        box.style.transform = "translate(-50%,-70px)";
        return;
      }
      let pct = Math.min(dy / THRESH, 1); // 0~1 진행률
      let shown = Math.min(dy * 0.4, 80); // 고무줄 저항
      box.style.transition = "none";
      box.style.transform = `translate(-50%, ${Math.min(shown - 50, 18)}px)`;
      ring.style.background = `conic-gradient(#0a84ff ${pct * 360}deg, rgba(128,128,128,0.25) ${pct * 360}deg)`;
      ic.style.transform = pct >= 1 ? "rotate(180deg)" : "rotate(0deg)";
      if (pct >= 1 && !reached) {
        // 임계값 도달 순간: 햅틱 1회
        reached = true;
        if (navigator.vibrate) navigator.vibrate(20);
      } else if (pct < 1 && reached) {
        reached = false;
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (e) => {
      if (!pulling) return;
      pulling = false;
      let dy = e.changedTouches[0].clientY - startY;
      const box = ind();
      box.style.transition = "transform 0.18s cubic-bezier(0.2,0.8,0.2,1)";
      if (dy >= THRESH && window.scrollY <= 0 && typeof navMonth === "function") {
        ic.textContent = "↻";
        ic.style.transform = "";
        ic.style.animation = "spin 0.7s linear infinite";
        box.style.transform = "translate(-50%, 14px)";
        try {
          navMonth(0);
        } catch (err) {}
        setTimeout(() => {
          box.style.transform = "translate(-50%,-70px)";
          ic.style.animation = "";
          ic.textContent = "↓";
        }, 800);
      } else {
        box.style.transform = "translate(-50%,-70px)";
      }
      reached = false;
    },
    { passive: true },
  );
})();

// ── IP 클릭 팝업 ──────────────────────────────────────────────────────────────

// 설명 텍스트 중 'IP: x.x.x.x' 부분만 클릭 가능한 링크로 변환 (나머지는 _esc 처리)
function _descWithIpLink(desc) {
  if (!desc) return "";
  const m = desc.match(/IP:\s*([\d.a-f:]+)/i);
  if (!m) return _esc(desc);
  const ip = m[1];
  return (
    _esc(desc.slice(0, m.index)) +
    `IP: <span onclick="showIpInfo('${_argq(ip)}')" style="color:#0a84ff;cursor:pointer;text-decoration:underline dotted;font-weight:700;">${_esc(ip)}</span>` +
    _esc(desc.slice(m.index + m[0].length))
  );
}

const _ipInfoCache = new Map();

async function showIpInfo(ip) {
  if (!ip || ip === "IP알수없음") return;
  const prev = document.getElementById("ipInfoPopup");
  if (prev) prev.remove();
  const popup = document.createElement("div");
  popup.id = "ipInfoPopup";
  popup.style.cssText =
    "position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.55); padding:24px; box-sizing:border-box;";
  const safeIp = _esc(ip);
  popup.innerHTML = `<div style="background:var(--card-bg,#26282c); color:var(--text-main,#fff); width:100%; max-width:320px; border-radius:18px; padding:22px 20px 16px; box-shadow:0 12px 40px rgba(0,0,0,0.5);">
    <div style="font-size:1em; font-weight:900; color:#0a84ff; margin-bottom:14px;">🌐 IP 정보</div>
    <div id="ipInfoBody" style="font-size:0.9em; line-height:1.8;">조회 중...</div>
    <div style="display:flex; gap:8px; margin-top:16px;">
      <button onclick="window.open('https://whois.domaintools.com/${safeIp}','_blank')" style="flex:1; padding:11px; border:1px solid var(--border-color,#444); border-radius:10px; background:transparent; color:var(--text-main,#fff); font-weight:700; cursor:pointer; font-size:0.88em;">🔍 WHOIS</button>
      <button onclick="document.getElementById('ipInfoPopup').remove()" style="flex:1; padding:11px; border:none; border-radius:10px; background:#0a84ff; color:#fff; font-weight:800; cursor:pointer;">닫기</button>
    </div>
  </div>`;
  popup.addEventListener("click", (e) => { if (e.target === popup) popup.remove(); });
  document.body.appendChild(popup);

  const _showResult = (d) => {
    const body = document.getElementById("ipInfoBody");
    if (!body) return;
    if (d.error) {
      body.innerHTML = `<span style="color:var(--text-sub);">조회 실패: ${_esc(d.reason || "알 수 없음")}</span>`;
      return;
    }
    const rows = [
      ["🔍 IP", d.ip],
      ["🌍 국가", d.country_name ? `${d.country_name} (${d.country_code})` : null],
      ["📍 지역", [d.region, d.city].filter(Boolean).join(", ") || null],
      ["🏢 통신사", d.org || d.asn || null],
      ["🕐 시간대", d.timezone || null],
    ].filter(([, v]) => v);
    body.innerHTML = rows
      .map(([k, v]) => `<div style="display:flex; gap:8px;"><span style="color:var(--text-sub); min-width:70px;">${k}</span><span style="font-weight:700; word-break:break-all;">${_esc(String(v))}</span></div>`)
      .join("");
  };

  if (_ipInfoCache.has(ip)) { _showResult(_ipInfoCache.get(ip)); return; }

  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`);
    const body = document.getElementById("ipInfoBody");
    if (!r.ok) {
      if (body) body.innerHTML = r.status === 429
        ? `<span style="color:var(--text-sub);">요청 한도 초과 — 잠시 후 다시 시도해주세요</span>`
        : `<span style="color:var(--text-sub);">조회 실패 (HTTP ${r.status})</span>`;
      return;
    }
    const d = await r.json();
    if (!d.error) _ipInfoCache.set(ip, d);
    _showResult(d);
  } catch (e) {
    const body = document.getElementById("ipInfoBody");
    if (body) body.innerHTML = `<span style="color:var(--text-sub);">조회 실패: 네트워크 오류</span>`;
  }
}
