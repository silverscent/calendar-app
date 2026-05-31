// ── 1. AI 질의 기능 ──────────────────────────────
function openAiQuery() {
    const modal = document.getElementById('aiQueryModal');
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('ai-question-input').focus(), 300);
}

function closeAiQuery() {
    document.getElementById('aiQueryModal').style.display = 'none';
}

function setAiQuestion(el) {
    document.getElementById('ai-question-input').value = el.textContent;
    document.getElementById('ai-question-input').focus();
}

function toggleAiSql() {
    const box = document.getElementById('ai-sql-box');
    const toggle = document.getElementById('ai-sql-toggle');
    if (box.style.display === 'none') {
        box.style.display = 'block';
        toggle.textContent = 'SQL 숨기기 ▴';
    } else {
        box.style.display = 'none';
        toggle.textContent = 'SQL 보기 ▾';
    }
}

async function runAiQuery() {
    const question = document.getElementById('ai-question-input').value.trim();
    if (!question) return;

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

// ── 2. FAB 드래그 및 위치 저장 기능 ──────────────────────────────
function initDraggableFab() {
    const fab = document.getElementById('inboundAiFab');
    if (!fab) return;

    // 위치 불러오기
    const savedPos = JSON.parse(localStorage.getItem('aiFabPosition'));
    if (savedPos) {
        fab.style.left = savedPos.left;
        fab.style.top = savedPos.top;
        fab.style.right = savedPos.right;
        fab.style.bottom = savedPos.bottom;
    }

    let isDragging = false;
    let offset = { x: 0, y: 0 };

    fab.addEventListener('mousedown', (e) => {
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
        snapToEdge(fab);
    });
}

function snapToEdge(fab) {
    const rect = fab.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    const min = Math.min(rect.left, winWidth - rect.right, rect.top, winHeight - rect.bottom);

    if (min === rect.left) { fab.style.left = '10px'; fab.style.right = 'auto'; }
    else if (min === winWidth - rect.right) { fab.style.right = '10px'; fab.style.left = 'auto'; }
    else if (min === rect.top) { fab.style.top = '10px'; fab.style.bottom = 'auto'; }
    else { fab.style.bottom = '10px'; fab.style.top = 'auto'; }

    localStorage.setItem('aiFabPosition', JSON.stringify({
        left: fab.style.left, top: fab.style.top, right: fab.style.right, bottom: fab.style.bottom
    }));
}

// ── 3. 초기화 ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initDraggableFab();
    showAiFabIfAdmin();     // 👈 이 줄을 추가하세요!
    
    // 관리자 권한 체크 후 FAB 표시
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    const fab = document.getElementById('inboundAiFab');
    if (adminId && fab) {
        fab.style.display = 'flex'; // 혹은 block 등 스타일
    }
});

function showAiFabIfAdmin() {
    const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
    if (!adminId) return;

    // 1. 인덱스 페이지(또는 메인)용 처리
    const fabAiSub = document.getElementById('fab-sub-ai-wrap');
    if (fabAiSub) {
        fabAiSub.style.display = 'flex';
    }

    // 2. 인바운드 페이지용 처리
    const inboundFab = document.getElementById('inboundAiFab');
    if (inboundFab) {
        // isMultiMode 변수가 선언되어 있는지 확인하고, 아닐 때만 표시
        const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
        if (!isMulti) {
            inboundFab.style.display = 'flex';
        }
    }
}