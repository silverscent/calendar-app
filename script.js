
console.log("script.js가 정상적으로 로드되었습니다.");
let isDragging = false; // 전역 변수로 관리
// ── 1. AI 질의 기능 ──────────────────────────────
function openAiQuery() {
    if (isDragging) return; // 드래그 중이었다면 무시
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

// ── 2. FAB 메뉴 토글 & 드래그 기능 ──────────────────────────────

// 스피드 다이얼 메뉴 토글
function toggleFabMenu() {
    const wrapper = document.getElementById('fabBtn');
    if (wrapper) wrapper.classList.toggle('open');
}

// 바탕 클릭 시 메뉴 접기
document.addEventListener('click', function(e) {
    const wrapper = document.getElementById('fabBtn');
    if (wrapper && wrapper.classList.contains('open') && !wrapper.contains(e.target)) {
        wrapper.classList.remove('open');
    }
});

// FAB 드래그 기능
function initDraggableFab() {
    // 입고 버튼 ID(inboundAiFab) 혹은 출고 버튼 ID(fabBtn) 중 존재하는 것을 찾음
    const fab = document.getElementById('inboundAiFab') || document.getElementById('fabBtn');
    if (!fab) return;

    // 2. 위치 불러오기 (ID별로 저장 위치를 구분하는 게 좋습니다)
    const storageKey = fab.id === 'fabBtn' ? 'outboundFabPosition' : 'aiFabPosition';
    const savedPos = JSON.parse(localStorage.getItem(storageKey));
    
    if (savedPos) {
        fab.style.left = savedPos.left;
        fab.style.top = savedPos.top;
        fab.style.right = savedPos.right;
        fab.style.bottom = savedPos.bottom;
    }

    let isDragging = false;
    let offset = { x: 0, y: 0 };

    fab.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 👈 이 줄이 핵심입니다! 새로고침 방지
        e.stopPropagation(); // 👈 이 코드가 새로고침을 막는 핵심입니다.
        isDragging = true;
        offset.x = e.clientX - fab.getBoundingClientRect().left;
        offset.y = e.clientY - fab.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        fab.style.left = (e.clientX - offset.x) + 'px';
        fab.style.top = (e.clientY - offset.y) + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        snapToEdge(fab, storageKey); // storageKey 전달
    });
}

function snapToEdge(fab, key) {
    const rect = fab.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    
    // 4방향과의 거리 계산
    const distLeft = rect.left;
    const distRight = winWidth - rect.right;
    const distTop = rect.top;
    const distBottom = winHeight - rect.bottom;
    
    const min = Math.min(distLeft, distRight, distTop, distBottom);

    // 1. 모든 위치값 초기화 (충돌 방지)
    fab.style.left = 'auto';
    fab.style.right = 'auto';
    fab.style.top = 'auto';
    fab.style.bottom = 'auto';

    // 2. 가장 가까운 쪽으로 고정
    if (min === distLeft) {
        fab.style.left = '10px';
    } else if (min === distRight) {
        fab.style.right = '10px';
    } else if (min === distTop) {
        fab.style.top = '10px';
    } else {
        fab.style.bottom = '10px';
    }

    // 위치 저장
    localStorage.setItem(key, JSON.stringify({
        left: fab.style.left, top: fab.style.top, 
        right: fab.style.right, bottom: fab.style.bottom
    }));
}

// ── 3. 초기화 ──────────────────────────────
function showAiFabIfAdmin() {
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    if (!adminId) return;

    // 입고 버튼
    const inboundFab = document.getElementById('inboundAiFab');
    if (inboundFab) {
        const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
        if (!isMulti) inboundFab.style.display = 'flex';
    }

    // 출고 스피드 다이얼
    const fabBtn = document.getElementById('fabBtn');
    const fabAiSub = document.getElementById('fab-sub-ai-wrap');
    if (fabBtn && fabAiSub) {
        fabBtn.style.display = 'block'; // 전체 다이얼을 보이게 함
        fabAiSub.style.display = 'flex'; // AI 버튼만 보이게 함
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initDraggableFab();
    showAiFabIfAdmin();
});