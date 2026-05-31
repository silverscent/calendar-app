// ── 0. 전역 변수 (이름 충돌 방지를 위해 fabDragging 사용)
window.fabDragging = false;

// ═══════════════════════════════════════════════
// ── 1. AI 질의 기능
// ═══════════════════════════════════════════════
function openAiQuery() {
    if (window.fabDragging) return;
    const modal = document.getElementById('aiQueryModal');
    if (!modal) return;
    modal.style.display = 'flex';
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
    if (input) { input.value = el.textContent; input.focus(); }
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
    const loading    = document.getElementById('ai-loading');
    const summary    = document.getElementById('ai-summary');
    const tableWrap  = document.getElementById('ai-table-wrap');
    const table      = document.getElementById('ai-data-table');
    const errorBox   = document.getElementById('ai-error');
    const sendBtn    = document.getElementById('ai-send-btn');
    if (!resultArea) return;

    resultArea.style.display = 'block';
    if (loading)   loading.style.display = 'block';
    if (summary)   summary.style.display = 'none';
    if (tableWrap) tableWrap.style.display = 'none';
    if (errorBox)  errorBox.style.display = 'none';
    if (sendBtn)   { sendBtn.disabled = true; sendBtn.textContent = '...'; }

    try {
        const adminId = localStorage.getItem('admin_id') || sessionStorage.getItem('admin_id');
        const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'AI_QUERY', admin_id: adminId, data: { question } })
        });
        const result = await res.json();
        if (loading) loading.style.display = 'none';

        if (!result.success) {
            if (errorBox) { errorBox.style.display = 'block'; errorBox.textContent = '⚠️ ' + (result.msg || '오류가 발생했습니다.'); }
            return;
        }

        if (summary) { summary.style.display = 'block'; summary.textContent = result.summary; }

        if (tableWrap) {
            tableWrap.style.display = 'block';
            const countEl = document.getElementById('ai-result-count');
            const sqlBox  = document.getElementById('ai-sql-box');
            if (countEl) countEl.textContent = result.count + '건 조회됨';
            if (sqlBox)  sqlBox.textContent = result.sql;

            if (result.rows && result.rows.length > 0) {
                const cols = Object.keys(result.rows[0]);
                let html = '<thead><tr>' + cols.map(c =>
                    '<th style="padding:8px 10px;text-align:left;border-bottom:1px solid #444;color:#aaa;white-space:nowrap;font-size:0.8em;">' + c + '</th>'
                ).join('') + '</tr></thead><tbody>';
                result.rows.forEach((row, i) => {
                    html += '<tr style="background:' + (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.03)') + '">';
                    cols.forEach(c => {
                        html += '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;color:#fff;font-size:0.85em;">' + (row[c] ?? '-') + '</td>';
                    });
                    html += '</tr>';
                });
                html += '</tbody>';
                if (table) table.innerHTML = html;
            } else {
                if (table) table.innerHTML = '<tr><td colspan="99" style="padding:20px;text-align:center;color:#888;">조회된 데이터가 없습니다.</td></tr>';
            }
        }
    } catch (e) {
        console.error('AI_QUERY 에러:', e);
        if (loading)  loading.style.display = 'none';
        if (errorBox) { errorBox.style.display = 'block'; errorBox.textContent = '⚠️ 네트워크 오류가 발생했습니다.'; }
    } finally {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '전송'; }
    }
}

// ═══════════════════════════════════════════════
// ── 2. FAB 메뉴 토글 (출고 전용)
// ═══════════════════════════════════════════════
function toggleFabMenu() {
    if (window.fabDragging) return; // 드래그 직후 메뉴 안 열리게
    const wrapper = document.getElementById('fabBtn');
    if (wrapper) wrapper.classList.toggle('open');
}

// ═══════════════════════════════════════════════
// ── 3. FAB 드래그 (가장자리 스냅 + 메뉴방향 자동전환)
// ═══════════════════════════════════════════════
function initDraggableFab() {
    const fabOut = document.getElementById('fabBtn');       // 출고: 부채꼴 메뉴 있음
    const fabIn  = document.getElementById('inboundAiFab'); // 입고: 단일 버튼

    if (fabOut) _attachDrag(fabOut, 'outboundFabPos', true);
    if (fabIn)  _attachDrag(fabIn,  'inboundFabPos', false);
}

function _attachDrag(fab, storageKey, hasMenu) {
    _restorePos(fab, storageKey, hasMenu);

    let startX, startY, baseStartLeft, baseStartTop, dragged = false;
    let offX = 0, offY = 0;   // wrapper(left/top) 와 버튼본체(.fab-main) 의 좌표 차이
    const THRESHOLD = 8;

    // 버튼 본체의 화면상 좌상단 좌표
    const getBaseRect = () => {
        const main = hasMenu ? fab.querySelector('.fab-main') : null;
        return main ? main.getBoundingClientRect() : fab.getBoundingClientRect();
    };

    let rafId = null;
    let pendingBaseLeft = 0, pendingBaseTop = 0;
    const applyMove = () => {
        rafId = null;
        const btn = _btnSize(fab, hasMenu);
        const PAD = 0;
        // 본체 기준으로 화면 경계 클램프
        const clampedBaseLeft = Math.max(PAD, Math.min(pendingBaseLeft, window.innerWidth  - btn.w - PAD));
        const clampedBaseTop  = Math.max(PAD, Math.min(pendingBaseTop,  window.innerHeight - btn.h - PAD));
        // wrapper 의 left/top = 본체 좌표 - offset (라벨이 왼/위로 뻗은 만큼 보정)
        fab.style.setProperty('left', (clampedBaseLeft - offX) + 'px', 'important');
        fab.style.setProperty('top',  (clampedBaseTop  - offY) + 'px', 'important');
    };

    const moveTo = (clientX, clientY) => {
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (!dragged && Math.sqrt(dx*dx + dy*dy) > THRESHOLD) {
            dragged = true;
            window.fabDragging = true;
            if (hasMenu) fab.classList.remove('open');
            // 드래그 확정 순간: 본체 기준 시작좌표 + offset 확정 후 left/top 모드로 전환
            const wrapRect = fab.getBoundingClientRect();
            const baseRect = getBaseRect();
            offX = baseRect.left - wrapRect.left;
            offY = baseRect.top  - wrapRect.top;
            baseStartLeft = baseRect.left;
            baseStartTop  = baseRect.top;
            fab.style.setProperty('position', 'fixed', 'important');
            fab.style.setProperty('right', 'auto', 'important');
            fab.style.setProperty('bottom', 'auto', 'important');
        }
        if (!dragged) return false;
        pendingBaseLeft = baseStartLeft + dx;
        pendingBaseTop  = baseStartTop  + dy;
        if (rafId === null) rafId = requestAnimationFrame(applyMove);
        return true;
    };

    const endDrag = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        if (dragged) {
            _snapToEdge(fab, hasMenu);
            _savePos(fab, storageKey);
        }
        setTimeout(() => { window.fabDragging = false; }, 150);
    };

    // 터치
    fab.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY;
        dragged = false; window.fabDragging = false;
    }, { passive: false });

    fab.addEventListener('touchmove', (e) => {
        e.stopPropagation();
        const t = e.touches[0];
        const moved = moveTo(t.clientX, t.clientY);
        if (moved) e.preventDefault();
    }, { passive: false });

    fab.addEventListener('touchend', (e) => { e.stopPropagation(); endDrag(); });
    fab.addEventListener('touchcancel', (e) => { e.stopPropagation(); endDrag(); });

    // 마우스 (PC)
    fab.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX; startY = e.clientY;
        dragged = false; window.fabDragging = false;

        const onMove = (e) => moveTo(e.clientX, e.clientY);
        const onUp = () => {
            endDrag();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // 클릭 처리 (입고 단일버튼만)
    if (!hasMenu) {
        fab.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.fabDragging) { e.preventDefault(); return; }
            openAiQuery();
        }, false);
    }
}

function _btnSize(fab, hasMenu) {
    if (hasMenu) {
        const main = fab.querySelector('.fab-main');
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
    const main = fab.querySelector('.fab-main');
    const wrapRect = fab.getBoundingClientRect();
    const baseRect = main ? main.getBoundingClientRect() : wrapRect;
    // 본체 left - (wrapper left와의 차이) 보정: wrapper의 left를 본체 left에 맞춤
    // width:max-content + 라벨이 왼쪽으로 뻗은 경우 wrapRect.left가 라벨 끝이므로 그 차이만큼 빼줌
    const offsetX = baseRect.left - wrapRect.left;
    fab.style.setProperty('position', 'fixed', 'important');
    fab.style.setProperty('left', (baseRect.left - offsetX) + 'px', 'important');
    fab.style.setProperty('top', baseRect.top + 'px', 'important');
    fab.style.setProperty('right', 'auto', 'important');
    fab.style.setProperty('bottom', 'auto', 'important');
}

function _snapToEdge(fab, hasMenu) {
    const btn = _btnSize(fab, hasMenu);
    const wrapRect = fab.getBoundingClientRect();
    const main = hasMenu ? fab.querySelector('.fab-main') : null;
    const baseRect = main ? main.getBoundingClientRect() : wrapRect;

    // wrapper 와 본체의 좌표 차이 (라벨이 왼/위로 뻗은 만큼)
    const offX = baseRect.left - wrapRect.left;
    const offY = baseRect.top  - wrapRect.top;

    const cx = baseRect.left + btn.w / 2;
    const cy = baseRect.top  + btn.h / 2;
    const PAD = 12;

    const isLeft = cx < window.innerWidth / 2;

    // 본체 기준 세로 위치: 현재 위치 유지 + 화면 안으로 보정
    const baseTop = Math.max(PAD, Math.min(baseRect.top, window.innerHeight - btn.h - PAD));
    // wrapper 의 top = 본체 top - offY
    fab.style.setProperty('top', (baseTop - offY) + 'px', 'important');
    fab.style.setProperty('bottom', 'auto', 'important');

    if (isLeft) {
        // 왼쪽: 본체 좌상단이 PAD 에 오도록 → wrapper left = PAD - offX
        fab.style.setProperty('left', (PAD - offX) + 'px', 'important');
        fab.style.setProperty('right', 'auto', 'important');
    } else {
        // 오른쪽: 본체 우측이 화면 오른쪽 PAD 에 붙도록 right 고정
        // wrapper 오른쪽 끝과 본체 오른쪽 끝의 차이만큼 보정
        const offRight = wrapRect.right - baseRect.right;
        fab.style.setProperty('right', (PAD - offRight) + 'px', 'important');
        fab.style.setProperty('left', 'auto', 'important');
    }

    if (hasMenu) {
        fab.classList.toggle('snap-left',  isLeft);
        fab.classList.toggle('snap-right', !isLeft);
        const isBottom = cy > window.innerHeight / 2;
        fab.classList.toggle('snap-bottom', isBottom);
        fab.classList.toggle('snap-top', !isBottom);
    }
}

function _savePos(fab, key) {
    const isLeftSnap = fab.classList.contains('snap-left') || (fab.style.left && fab.style.left !== 'auto');
    localStorage.setItem(key, JSON.stringify({
        // 오른쪽 고정이면 right 값을, 왼쪽 고정이면 left 값을 저장
        side: (fab.style.right && fab.style.right !== 'auto') ? 'right' : 'left',
        left:  fab.style.left,
        right: fab.style.right,
        top:   fab.style.top,
        snapLeft:   fab.classList.contains('snap-left'),
        snapBottom: fab.classList.contains('snap-bottom')
    }));
}

function _restorePos(fab, key, hasMenu) {
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
        const pos = JSON.parse(saved);
        const t = parseInt(pos.top);
        if (isNaN(t)) return;
        // 세로 화면 밖이면 저장값 폐기
        if (t < 0 || t > window.innerHeight - 20) { localStorage.removeItem(key); return; }

        fab.style.setProperty('position', 'fixed', 'important');
        fab.style.setProperty('top', pos.top, 'important');
        fab.style.setProperty('bottom', 'auto', 'important');

        // side 정보로 좌우 고정 방식 복원
        if (pos.side === 'right' && pos.right && pos.right !== 'auto') {
            fab.style.setProperty('right', pos.right, 'important');
            fab.style.setProperty('left', 'auto', 'important');
        } else {
            const l = parseInt(pos.left);
            if (isNaN(l) || l < 0 || l > window.innerWidth - 20) { localStorage.removeItem(key); return; }
            fab.style.setProperty('left', pos.left, 'important');
            fab.style.setProperty('right', 'auto', 'important');
        }

        if (hasMenu) {
            fab.classList.toggle('snap-left',  !!pos.snapLeft);
            fab.classList.toggle('snap-right', !pos.snapLeft);
            fab.classList.toggle('snap-bottom', !!pos.snapBottom);
            fab.classList.toggle('snap-top', !pos.snapBottom);
        }
    } catch(e) { localStorage.removeItem(key); }
}

// ═══════════════════════════════════════════════
// ── 4. 관리자 확인 후 FAB 표시
// ═══════════════════════════════════════════════
function showAiFabIfAdmin() {
    const isAdminFlag =
        window.isAdmin === true ||
        localStorage.getItem('isAdmin') === 'true' ||
        sessionStorage.getItem('isAdmin') === 'true';

    const fabBtn = document.getElementById('fabBtn');
    if (fabBtn && isAdminFlag) {
        const isMulti = (typeof isMultiMode !== 'undefined' && isMultiMode);
        if (!isMulti) fabBtn.style.display = 'flex';
        const aiSub = document.getElementById('fab-sub-ai-wrap');
        if (aiSub) aiSub.style.display = 'flex';
    }

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