// ── 0. 전역 변수
window.isDragging = false;

// ═══════════════════════════════════════════════
// ── 1. AI 질의 기능
// ═══════════════════════════════════════════════
function openAiQuery() {
    if (window.isDragging) return;
    const modal = document.getElementById('aiQueryModal');
    if (!modal) return;
    modal.style.display = 'flex';
    // 결과 초기화
    const resultArea = document.getElementById('ai-result-area');
    if (resultArea) resultArea.style.display = 'none';
    setTimeout(() => document.getElementById('ai-question-input')?.focus(), 300);
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

    const resultArea  = document.getElementById('ai-result-area');
    const loading     = document.getElementById('ai-loading');
    const summary     = document.getElementById('ai-summary');
    const tableWrap   = document.getElementById('ai-table-wrap');
    const table       = document.getElementById('ai-data-table');
    const errorBox    = document.getElementById('ai-error');
    const sendBtn     = document.getElementById('ai-send-btn');
    if (!resultArea) return;

    // 초기화
    resultArea.style.display = 'block';
    if (loading)   { loading.style.display = 'block'; }
    if (summary)   { summary.style.display = 'none'; }
    if (tableWrap) { tableWrap.style.display = 'none'; }
    if (errorBox)  { errorBox.style.display = 'none'; }
    if (sendBtn)   { sendBtn.disabled = true; sendBtn.textContent = '...'; }

    try {
        const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
        const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'AI_QUERY',
                admin_id: adminId,
                data: { question }
            })
        });
        const result = await res.json();

        if (loading) loading.style.display = 'none';

        if (!result.success) {
            if (errorBox) {
                errorBox.style.display = 'block';
                errorBox.textContent = '⚠️ ' + (result.msg || '오류가 발생했습니다.');
            }
            return;
        }

        // 요약 표시
        if (summary) {
            summary.style.display = 'block';
            summary.textContent = result.summary;
        }

        // 테이블 표시
        if (tableWrap) {
            tableWrap.style.display = 'block';
            const countEl = document.getElementById('ai-result-count');
            const sqlBox  = document.getElementById('ai-sql-box');
            if (countEl) countEl.textContent = `${result.count}건 조회됨`;
            if (sqlBox)  sqlBox.textContent = result.sql;

            if (result.rows && result.rows.length > 0) {
                const cols = Object.keys(result.rows[0]);
                let html = `<thead><tr>${cols.map(c =>
                    `<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #444;color:#aaa;white-space:nowrap;font-size:0.8em;">${c}</th>`
                ).join('')}</tr></thead><tbody>`;
                result.rows.forEach((row, i) => {
                    html += `<tr style="background:${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.03)'}">`;
                    cols.forEach(c => {
                        html += `<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;color:#fff;font-size:0.85em;">${row[c] ?? '-'}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody>';
                if (table) table.innerHTML = html;
            } else {
                if (table) table.innerHTML = `<tr><td colspan="99" style="padding:20px;text-align:center;color:#888;">조회된 데이터가 없습니다.</td></tr>`;
            }
        }

    } catch (e) {
        console.error('AI_QUERY 에러:', e);
        if (loading)  loading.style.display = 'none';
        if (errorBox) {
            errorBox.style.display = 'block';
            errorBox.textContent = '⚠️ 네트워크 오류가 발생했습니다.';
        }
    } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '전송'; }
    }
}

// ═══════════════════════════════════════════════
// ── 2. FAB 메뉴 토글 (출고 전용)
// ═══════════════════════════════════════════════
function toggleFabMenu() {
    const wrapper = document.getElementById('fabBtn');
    if (wrapper) wrapper.classList.toggle('open');
}

// ═══════════════════════════════════════════════
// ── 3. FAB 드래그 기능 (화면 가장자리 고정 스냅)
// ═══════════════════════════════════════════════
function initDraggableFab() {
    // 출고: fabBtn / 입고: inboundAiFab — 각 페이지에 맞는 것만 존재함
    const fabOut = document.getElementById('fabBtn');
    const fabIn  = document.getElementById('inboundAiFab');

    if (fabOut) _attachDrag(fabOut, 'outboundFabPos');
    if (fabIn)  _attachDrag(fabIn,  'inboundFabPos');
}

function _attachDrag(fab, storageKey) {
    // 저장된 위치 복원
    _restorePos(fab, storageKey);

    let startX, startY, startLeft, startTop;
    let dragged = false;
    const DRAG_THRESHOLD = 6; // px — 이 이상 움직여야 드래그로 인식

    // ── 터치 이벤트
    fab.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        const rect = fab.getBoundingClientRect();
        startLeft = rect.left;
        startTop  = rect.top;
        dragged = false;
        window.isDragging = false;
    }, { passive: true });

    fab.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        if (!dragged && Math.sqrt(dx*dx + dy*dy) > DRAG_THRESHOLD) {
            dragged = true;
            window.isDragging = true;
            _setAbsolute(fab);
        }
        if (!dragged) return;
        e.preventDefault();

        const maxX = window.innerWidth  - fab.offsetWidth;
        const maxY = window.innerHeight - fab.offsetHeight;
        fab.style.left = Math.max(0, Math.min(startLeft + dx, maxX)) + 'px';
        fab.style.top  = Math.max(0, Math.min(startTop  + dy, maxY)) + 'px';
    }, { passive: false });

    fab.addEventListener('touchend', () => {
        if (dragged) {
            _snapToEdge(fab);
            _savePos(fab, storageKey);
        }
        setTimeout(() => { window.isDragging = false; }, 100);
    });

    // ── 마우스 이벤트 (PC)
    fab.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 👈 이 줄 추가
        startX = e.clientX;
        startY = e.clientY;
        const rect = fab.getBoundingClientRect();
        startLeft = rect.left;
        startTop  = rect.top;
        dragged = false;
        window.isDragging = false;

        const onMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!dragged && Math.sqrt(dx*dx + dy*dy) > DRAG_THRESHOLD) {
                dragged = true;
                window.isDragging = true;
                _setAbsolute(fab);
            }
            if (!dragged) return;
            const maxX = window.innerWidth  - fab.offsetWidth;
            const maxY = window.innerHeight - fab.offsetHeight;
            fab.style.left = Math.max(0, Math.min(startLeft + dx, maxX)) + 'px';
            fab.style.top  = Math.max(0, Math.min(startTop  + dy, maxY)) + 'px';
        };
        const onUp = () => {
            if (dragged) {
                _snapToEdge(fab);
                _savePos(fab, storageKey);
            }
            setTimeout(() => { window.isDragging = false; }, 100);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function _setAbsolute(fab) {
    const rect = fab.getBoundingClientRect();
    fab.style.setProperty('position', 'fixed', 'important');
    fab.style.setProperty('left', rect.left + 'px', 'important');
    fab.style.setProperty('top', rect.top + 'px', 'important');
    fab.style.setProperty('right', 'auto', 'important');
    fab.style.setProperty('bottom', 'auto', 'important');
}

function _snapToEdge(fab) {
    const rect  = fab.getBoundingClientRect();
    const cx    = rect.left + rect.width / 2;
    const snapX = cx < window.innerWidth / 2
        ? 12
        : window.innerWidth - fab.offsetWidth - 12;
    const safeY = Math.max(12, Math.min(rect.top, window.innerHeight - fab.offsetHeight - 12));
    fab.style.setProperty('left', snapX + 'px', 'important');
    fab.style.setProperty('top', safeY + 'px', 'important');
    fab.style.setProperty('right', 'auto', 'important');
    fab.style.setProperty('bottom', 'auto', 'important');
}

function _restorePos(fab, key) {
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
        const pos = JSON.parse(saved);
        const l = parseInt(pos.left);
        const t = parseInt(pos.top);
        if (isNaN(l) || isNaN(t)) return;
        if (l < 0 || l > window.innerWidth - 20) return;
        if (t < 0 || t > window.innerHeight - 20) return;
        fab.style.setProperty('position', 'fixed', 'important');
        fab.style.setProperty('left', pos.left, 'important');
        fab.style.setProperty('top', pos.top, 'important');
        fab.style.setProperty('right', 'auto', 'important');
        fab.style.setProperty('bottom', 'auto', 'important');
    } catch(e) {}
}
function _savePos(fab, key) {
    localStorage.setItem(key, JSON.stringify({
        left: fab.style.left,
        top:  fab.style.top
    }));
}


// ═══════════════════════════════════════════════
// ── 4. 관리자 확인 후 FAB 표시
// ═══════════════════════════════════════════════
function showAiFabIfAdmin() {
    // window.isAdmin은 로그인 성공 시 HTML 내부에서 세팅됨
    // localStorage/sessionStorage 는 자동로그인 복원 시 세팅됨
    const isAdminFlag =
        window.isAdmin === true ||
        localStorage.getItem('isAdmin') === 'true' ||
        sessionStorage.getItem('isAdmin') === 'true';

    // ── 출고 페이지 (fabBtn)
    const fabBtn = document.getElementById('fabBtn');
    if (fabBtn) {
        if (isAdminFlag) {
            const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
            if (!isMulti) fabBtn.style.display = 'flex';
            // AI 서브버튼 표시
            const aiSub = document.getElementById('fab-sub-ai-wrap');
            if (aiSub) aiSub.style.display = 'flex';
        }
    }

    // ── 입고 페이지 (inboundAiFab)
    const inboundFab = document.getElementById('inboundAiFab');
    if (inboundFab) {
        if (isAdminFlag) {
            const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
            if (!isMulti) inboundFab.style.display = 'flex';
        } else {
            inboundFab.style.display = 'none';
        }
    }
}

// ═══════════════════════════════════════════════
// ── 5. 초기화
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    initDraggableFab();
    showAiFabIfAdmin();
});