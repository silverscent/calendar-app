
// ── [전역 변수 설정] ──
let isDragging = false;
let startX, startY; // 드래그 시작 위치 확인용

// ── 1. AI 질의 기능 ──────────────────────────────
function openAiQuery() {
    if (isDragging) return; // 드래그 중이었다면 클릭 방지
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

// ── 2. FAB 드래그 및 메뉴 토글 기능 ──────────────────────────────

function toggleFabMenu() {
    const wrapper = document.getElementById('fabBtn');
    if (wrapper) wrapper.classList.toggle('open');
}

function initDraggableFab() {
    const fab = document.getElementById('inboundAiFab') || document.getElementById('fabBtn');
    if (!fab) return;

    const storageKey = fab.id === 'fabBtn' ? 'outboundFabPosition' : 'aiFabPosition';
    const savedPos = JSON.parse(localStorage.getItem(storageKey));
    
    if (savedPos) {
        fab.style.left = savedPos.left;
        fab.style.top = savedPos.top;
        fab.style.right = savedPos.right;
        fab.style.bottom = savedPos.bottom;
    }

    let offset = { x: 0, y: 0 };

    fab.addEventListener('mousedown', (e) => {
        isDragging = false; // 누를 땐 드래그 아님
        startX = e.clientX;
        startY = e.clientY;
        offset.x = e.clientX - fab.getBoundingClientRect().left;
        offset.y = e.clientY - fab.getBoundingClientRect().top;
    });

    document.addEventListener('mousemove', (e) => {
        // 이동 거리가 5px 이상이면 드래그 시작으로 간주
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        
        if (dx > 5 || dy > 5) {
            isDragging = true;
            fab.style.left = (e.clientX - offset.x) + 'px';
            fab.style.top = (e.clientY - offset.y) + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            snapToEdge(fab, storageKey);
            isDragging = false; // 드래그 끝
        }
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

// ── 3. 초기화 (버튼 표시) ──────────────────────────────
function showAiFabIfAdmin() {
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    const inboundFab = document.getElementById('inboundAiFab');
    const fabBtn = document.getElementById('fabBtn');

    if (!adminId) {
        if(inboundFab) inboundFab.style.display = 'none';
        if(fabBtn) fabBtn.style.display = 'none';
        return;
    }

    if (inboundFab) inboundFab.style.display = 'flex';
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