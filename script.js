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

// ── 3. FAB 드래그 기능 ──────────────────────────────
function initDraggableFab() {
    const fab = document.getElementById('inboundAiFab') || document.getElementById('fabBtn');
    if (!fab) return;

    const storageKey = fab.id === 'fabBtn' ? 'outboundFabPosition' : 'aiFabPosition';
    
    let isMouseDown = false; // 💡 핵심: 마우스 클릭 상태 확인용 변수
    let offset = { x: 0, y: 0 };
    let startX = 0, startY = 0;

    // 1. 마우스를 눌렀을 때
    fab.addEventListener('mousedown', (e) => {
        isMouseDown = true; // 드래그 시작!
        startX = e.clientX;
        startY = e.clientY;
        offset.x = e.clientX - fab.getBoundingClientRect().left;
        offset.y = e.clientY - fab.getBoundingClientRect().top;
    });

    // 2. 마우스를 움직일 때
    document.addEventListener('mousemove', (e) => {
        // 💡 중요: 마우스를 누른 상태(isMouseDown)가 아니면 여기서 즉시 중단!
        if (!isMouseDown) return; 

        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);

        // 5px 이상 움직여야 드래그로 간주
        if (dx > 5 || dy > 5) {
            window.isDragging = true; // 전역 드래그 상태 업데이트
            fab.style.left = (e.clientX - offset.x) + 'px';
            fab.style.top = (e.clientY - offset.y) + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }
    });

    // 3. 마우스 버튼을 뗐을 때
    document.addEventListener('mouseup', () => {
        if (isMouseDown && window.isDragging) {
            snapToEdge(fab, storageKey);
        }
        isMouseDown = false;    // 드래그 종료
        window.isDragging = false;
    });
}

function snapToEdge(fab, key) {
    const rect = fab.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    
    const distLeft = rect.left;
    const distRight = winWidth - rect.right;
    const distTop = rect.top;
    const distBottom = winHeight - rect.bottom;
    const min = Math.min(distLeft, distRight, distTop, distBottom);

    fab.style.left = 'auto'; fab.style.right = 'auto';
    fab.style.top = 'auto'; fab.style.bottom = 'auto';

    if (min === distLeft) fab.style.left = '10px';
    else if (min === distRight) fab.style.right = '10px';
    else if (min === distTop) fab.style.top = '10px';
    else fab.style.bottom = '10px';

    localStorage.setItem(key, JSON.stringify({
        left: fab.style.left, top: fab.style.top, 
        right: fab.style.right, bottom: fab.style.bottom
    }));
}

// ── 4. 초기화 ──────────────────────────────
function showAiFabIfAdmin() {
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    const inboundFab = document.getElementById('inboundAiFab');
    const fabBtn = document.getElementById('fabBtn');

    if (!adminId) {
        if (inboundFab) inboundFab.style.display = 'none';
        if (fabBtn) fabBtn.style.display = 'none';
        return; 
    }

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