// ── 0. 전역 변수 설정 (브라우저 어디서든 접근 가능하도록 window 객체 사용)
window.isDragging = false;

// ── 1. AI 질의 기능 ──────────────────────────────
function openAiQuery() {
    if (window.isDragging) return; 
    const modal = document.getElementById('aiQueryModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('ai-question-input')?.focus(), 300);
    }
}

function closeAiQuery() {
    const modal = document.getElementById('aiQueryModal');
    if (modal) modal.style.display = 'none';
}

function setAiQuestion(el) {
    const input = document.getElementById('ai-question-input');
    if (input) {
        input.value = el.textContent;
        input.focus();
    }
}

function toggleAiSql() {
    const box = document.getElementById('ai-sql-box');
    const toggle = document.getElementById('ai-sql-toggle');
    if (!box || !toggle) return;
    
    if (box.style.display === 'none') {
        box.style.display = 'block';
        toggle.textContent = 'SQL 숨기기 ▴';
    } else {
        box.style.display = 'none';
        toggle.textContent = 'SQL 보기 ▾';
    }
}

async function runAiQuery() {
    const inputEl = document.getElementById('ai-question-input');
    if (!inputEl || !inputEl.value.trim()) return;
    const question = inputEl.value.trim();

    const resultArea = document.getElementById('ai-result-area');
    const loading = document.getElementById('ai-loading');
    const summary = document.getElementById('ai-summary');
    const tableWrap = document.getElementById('ai-table-wrap');
    const table = document.getElementById('ai-data-table');
    const errorBox = document.getElementById('ai-error');
    const sendBtn = document.getElementById('ai-send-btn');

    resultArea.style.display = 'block';
    loading.style.display = 'block';
    summary.style.display = 'none';
    tableWrap.style.display = 'none';
    errorBox.style.display = 'none';
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    try {
        const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
        const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'AI_QUERY', admin_id: adminId, data: { question } })
        });
        const result = await res.json();
        loading.style.display = 'none';

        if (!result.success) {
            errorBox.style.display = 'block';
            errorBox.textContent = '⚠️ ' + (result.msg || '오류가 발생했습니다.');
            return;
        }

        summary.style.display = 'block';
        summary.textContent = result.summary;

        if (result.rows && result.rows.length > 0) {
            tableWrap.style.display = 'block';
            document.getElementById('ai-result-count').textContent = `${result.count}건 조회됨`;
            document.getElementById('ai-sql-box').textContent = result.sql;

            const cols = Object.keys(result.rows[0]);
            let html = `<thead><tr>${cols.map(c => `<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #333; color:#888; white-space:nowrap;">${c}</th>`).join('')}</tr></thead><tbody>`;
            result.rows.forEach((row, i) => {
                html += `<tr style="background:${i%2===0?'transparent':'rgba(255,255,255,0.02)'}">`;
                cols.forEach(c => { html += `<td style="padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.05); white-space:nowrap; color:#fff;">${row[c] ?? '-'}</td>`; });
                html += '</tr>';
            });
            html += '</tbody>';
            table.innerHTML = html;
        } else {
            tableWrap.style.display = 'block';
            document.getElementById('ai-result-count').textContent = '0건';
            table.innerHTML = `<tr><td style="padding:16px; text-align:center; color:#888;">조회된 데이터가 없습니다.</td></tr>`;
        }
    } catch(e) {
        loading.style.display = 'none';
        errorBox.style.display = 'block';
        errorBox.textContent = '⚠️ 네트워크 오류가 발생했습니다.';
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '전송';
    }
}

// ── 2. FAB 메뉴 토글 ──────────────────────────────
function toggleFabMenu() {
    const wrapper = document.getElementById('fabBtn');
    if (wrapper) wrapper.classList.toggle('open');
}

// initDraggableFab 함수 바로 위에 추가하세요.
function loadPosition(fab, key) {
    const saved = localStorage.getItem(key);
    if (!saved) return;

    const pos = JSON.parse(saved);
    fab.style.left = pos.left;
    fab.style.top = pos.top;
    fab.style.right = pos.right;
    fab.style.bottom = pos.bottom;
    fab.style.position = pos.position;
}

// ── 3. FAB 드래그 기능 ──────────────────────────────
function initDraggableFab() {
    const fab = document.getElementById('inboundAiFab') || document.getElementById('fabBtn');
    if (!fab) return;

    const storageKey = fab.id === 'fabBtn' ? 'outboundFabPosition' : 'aiFabPosition';
    
    // 1. 저장된 위치 불러오기
    loadPosition(fab, storageKey);

    let isMouseDown = false;
    let offset = { x: 0, y: 0 };
    let startX = 0, startY = 0;

    fab.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        startX = e.clientX;
        startY = e.clientY;
        // 버튼 내부에서의 클릭 위치 계산
        offset.x = e.clientX - fab.getBoundingClientRect().left;
        offset.y = e.clientY - fab.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;

        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);

        if (dx > 5 || dy > 5) {
            window.isDragging = true;

            // 💡 핵심: 버튼의 이동 범위 제한 (화면 밖으로 나가지 못하게)
            const maxX = window.innerWidth - fab.offsetWidth;
            const maxY = window.innerHeight - fab.offsetHeight;

            // 마우스 위치에서 offset을 뺀 값이 0보다 작으면 0으로, 최대치보다 크면 최대치로 고정
            const newLeft = Math.max(0, Math.min(e.clientX - offset.x, maxX));
            const newTop = Math.max(0, Math.min(e.clientY - offset.y, maxY));

            fab.style.left = newLeft + 'px';
            fab.style.top = newTop + 'px';
            fab.style.right = 'auto'; // 고정값 해제
            fab.style.bottom = 'auto';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isMouseDown && window.isDragging) {
            savePosition(fab, storageKey);
        }
        isMouseDown = false;
        window.isDragging = false;
    });
}

// 기존 snapToEdge를 아래 코드로 완전히 교체하세요.
function savePosition(fab, key) {
    // 구석으로 이동시키는 로직을 모두 삭제했습니다.
    // 현재 스타일의 left, top, right, bottom 값을 그대로 저장만 합니다.
    const position = {
        left: fab.style.left,
        top: fab.style.top,
        right: fab.style.right,
        bottom: fab.style.bottom,
        position: 'fixed' // 위치 고정 방식 명시
    };
    localStorage.setItem(key, JSON.stringify(position));
    console.log("위치 저장됨:", position);
}

// ── 4. 초기화 ──────────────────────────────
function showAiFabIfAdmin() {
    // 1. 관리자 ID 확인
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    
    // 2. 디버깅 로그: 도대체 어떤 ID를 읽고 있는지 콘솔에 출력
    console.log("=== 디버깅: showAiFabIfAdmin 시작 ===");
    console.log("읽어온 admin_id 값:", adminId);

    const inboundFab = document.getElementById('inboundAiFab');
    const fabBtn = document.getElementById('fabBtn');

    // 3. 관리자 ID가 없을 때 '숨기는' 로직을 잠시 막아둡니다 (if문 주석 처리)
    if (!adminId) {
        console.warn("관리자 아이디가 감지되지 않았습니다. (하지만 테스트를 위해 버튼을 숨기지 않음)");
        // if (inboundFab) inboundFab.style.display = 'none'; // 주석 처리
        // if (fabBtn) fabBtn.style.display = 'none';         // 주석 처리
        return; 
    }

    console.log("관리자 권한 확인됨. 버튼 표시.");

    // (기존 표시 로직 그대로 유지)
    if (inboundFab) {
        const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
        if (!isMulti) inboundFab.style.display = 'flex';
    }

    if (fabBtn) {
        fabBtn.style.display = 'block'; 
        const fabAiSub = document.getElementById('fab-sub-ai-wrap');
        if(fabAiSub) fabAiSub.style.display = 'flex';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initDraggableFab();
    showAiFabIfAdmin();
});