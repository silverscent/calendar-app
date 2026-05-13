require('dotenv').config();
const mysql = require('mysql2/promise');

// 텔레그램 메시지 전송 헬퍼
async function sendTgMsg(chatId, text, inlineKeyboard = null) {
    try {
        const payload = { chat_id: chatId, text: text };
        if (inlineKeyboard) payload.reply_markup = { inline_keyboard: inlineKeyboard };

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch(e) { console.error("텔레그램 전송 에러:", e); }
}

// 🇰🇷 한국 시간 기준 날짜 포맷 함수
function getKstDateStr(dateObj) {
    const kst = new Date(dateObj.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
    return `${kst.getFullYear()}-${String(kst.getMonth()+1).padStart(2,'0')}-${String(kst.getDate()).padStart(2,'0')}`;
}

// 🛡️ DB 날짜 안전 변환기
function formatDbDateShort(dbDate) {
    if (!dbDate) return "미정";
    if (dbDate instanceof Date) return `${String(dbDate.getMonth() + 1).padStart(2, '0')}/${String(dbDate.getDate()).padStart(2, '0')}`;
    if (typeof dbDate === 'string' && dbDate.length >= 10) return dbDate.substring(5, 10).replace('-', '/');
    return String(dbDate);
}

// 🛡️ DB JSON 안전 파싱기
function safeGetJson(val) {
    if (typeof val === 'object' && val !== null) return val;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch(e) {}
    }
    return { id: val, url: val, time: val };
}

export default async function handler(req, res) {
    if (req.method !== 'POST' || !req.body.message) return res.status(200).send('OK');

    const message = req.body.message;
    
    // 💡 텔레그램 API 분리 수신!
    const chatId = message.chat.id;         // 💬 답장을 보낼 '방 번호' (단톡방이면 마이너스)
    const senderId = message.from.id;       // 👤 메시지를 보낸 '사람 고유번호' (불변)
    
    const text = message.text || '';
    const pool = mysql.createPool(process.env.DATABASE_URL);

    // 👑 [핵심 보안] 방 번호(chatId)가 아닌 보낸 사람(senderId)을 검사합니다!
    const isAdmin = String(senderId) === String(process.env.ADMIN_TELEGRAM_USER_ID);

    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS processed_images (unique_id VARCHAR(100) PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        // =================================================================
        // 🔓 퍼블릭(공용) 관문 (오리지널 텔레그램 양식 100% 복원!)
        // =================================================================
        if (text.startsWith('/help') || text.startsWith('/도움')) {
            const helpMsg = `🤖 3PL 입/출고 알림 봇 사용 안내\n\n[ 📥 입고 스케줄 ]\n📦 /입고 (또는 /today)\n- 오늘 기준 입고 예정 건 조회\n\n📅 /이번주, /다음주, /저번주\n- 주차별 입고 스케줄 요약 브리핑\n\n🗓️ /달력 [월] (예: /달력 3)\n- 월간 입고 스케줄을 한눈에 보는 캘린더\n\n[ 🚚 출고 스케줄 ]\n📤 /출고\n- 일일 출고 대기 리스트 및 랙(Rack) 점유율 확인\n\n🗓️ /출고달력 [월] (예: /출고달력 3)\n- 월간 용차/출고 스케줄 캘린더`;
            await sendTgMsg(chatId, helpMsg);
            return res.status(200).send('OK');
        }

        const cmdList = ['/입고', '/today', '/이번주', '/thisweek', '/다음주', '/nextweek', '/저번주', '/lastweek'];
        if (cmdList.includes(text.split(' ')[0])) {
            const today = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
            today.setHours(0,0,0,0);
            
            let startDate, endDate, title;
            const cmd = text.split(' ')[0];
            if (cmd === '/입고' || cmd === '/today') {
                startDate = new Date(today); endDate = new Date(today); title = '오늘';
            } else {
                const day = today.getDay();
                const startOfThisWeek = new Date(today); startOfThisWeek.setDate(today.getDate() - day);
                
                if (cmd === '/이번주' || cmd === '/thisweek') {
                    startDate = new Date(startOfThisWeek);
                    endDate = new Date(startOfThisWeek); endDate.setDate(endDate.getDate() + 6);
                    title = '이번 주';
                } else if (cmd === '/다음주' || cmd === '/nextweek') {
                    startDate = new Date(startOfThisWeek); startDate.setDate(startDate.getDate() + 7);
                    endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
                    title = '다음 주';
                } else if (cmd === '/저번주' || cmd === '/lastweek') {
                    startDate = new Date(startOfThisWeek); startDate.setDate(startDate.getDate() - 7);
                    endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
                    title = '지난주';
                }
            }
            
            // 🚨 [오리지널 복원] 단순 검색이 아닙니다. 과거 10일 치를 가져와서 '주말 이월'을 계산합니다!
            let fetchStart = new Date(startDate);
            fetchStart.setDate(fetchStart.getDate() - 10);
            const fetchStartStr = getKstDateStr(fetchStart);
            const eStr = getKstDateStr(endDate);
            const dayNames = ["일","월","화","수","목","금","토"];
            
            const [rawRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date BETWEEN ? AND ? ORDER BY receive_date ASC`, [fetchStartStr, eStr]);
            
            let rows = [];
            rawRows.forEach(r => {
                let origDate = new Date(r.receive_date);
                let adjDate = new Date(origDate);
                
                // 💡 [핵심 엔진] 토요일(6)이나 일요일(0)이면 월요일로 날짜를 밀어버림!
                while(adjDate.getDay() === 0 || adjDate.getDay() === 6) {
                    adjDate.setDate(adjDate.getDate() + 1);
                }
                
                // 밀린 날짜가 우리가 찾는 기간(예: 오늘) 안에 들어오면 화면에 표시!
                if (adjDate >= startDate && adjDate <= endDate) {
                    r.isMoved = (origDate.getTime() !== adjDate.getTime());
                    r.origDateStr = formatDbDateShort(r.receive_date);
                    r.adjDateStr = formatDbDateShort(adjDate);
                    r.sortDate = adjDate;
                    rows.push(r);
                }
            });
            // 이월된 날짜 기준으로 재정렬
            rows.sort((a, b) => a.sortDate - b.sortDate);
            
            let msg = '';
            
            if (title === '오늘') {
                const todayStr = `${getKstDateStr(startDate)}, ${dayNames[startDate.getDay()]}`;
                msg = `🚨 3PL 입고 알림 🚨 (${todayStr})\n••••••••••••••••••••••••••••••`;
                
                if (rows.length === 0) {
                    msg += `\n📭 오늘 입고 예정 데이터가 없습니다.`;
                } else {
                    msg += `\n📌 오늘 입고 항목 : ${rows.length}건\n------------------------------`;
                    let totalPalToday = 0;
                    
                    rows.forEach((r, idx) => {
                        totalPalToday += parseInt(r.pallets) || 0;
                        let sTypeRaw = String(r.s_type || '').toUpperCase();
                        let sType = sTypeRaw === "AIR" ? "탑차량" : (sTypeRaw === "SEA" ? "컨테이너" : sTypeRaw);
                        let sTypeIcon = sTypeRaw === "AIR" ? "✈️" : (sTypeRaw === "SEA" ? "🚢" : "");
                        
                        // 🚨 이월 꼬리표 추가!
                        let movedText = r.isMoved ? `🔁 휴무일 이월: ${r.origDateStr} → ${r.adjDateStr}\n` : '';
                        
                        msg += `\n${idx + 1}️⃣ B/L #: ${r.bl_number}\n` +
                               `📦 PAL       : ${r.pallets}\n` +
                               `${sTypeIcon} 배송방식  : ${sType}\n` +
                               `${movedText}` +
                               `🧾 Invoice#  : ${r.invoice || ''}`;
                        if (r.remarks) msg += `\n✏️ ETC       : ${r.remarks}`;
                        msg += `\n------------------------------`;
                    });
                    msg += `\n📊 오늘 총 PAL 수: ${totalPalToday}\n••••••••••••••••••••••••••••••`;
                }
            } else {
                msg = `📦 ${title} 3PL 입고 요약\n(${getKstDateStr(startDate)} ~ ${eStr})\n••••••••••••••••••••••••\n`;
                
                if (rows.length === 0) {
                    msg += `\n📭 해당 기간 입고 예정 없음`;
                } else {
                    let map = {};
                    rows.forEach(r => {
                        let dStr = `${r.adjDateStr} (${dayNames[r.sortDate.getDay()]})`;
                        if (!map[dStr]) map[dStr] = [];
                        map[dStr].push(r);
                    });
                    
                    Object.keys(map).forEach(dateKey => {
                        const items = map[dateKey];
                        const totalPal = items.reduce((sum, item) => sum + (parseInt(item.pallets) || 0), 0);
                        
                        msg += `\n📅 ${dateKey} – ${items.length}건 / PAL ${totalPal}\n`;
                        items.forEach(it => {
                            let sTypeRaw = String(it.s_type || '').toUpperCase();
                            let sType = sTypeRaw === "AIR" ? "✈️ 탑차량" : (sTypeRaw === "SEA" ? "🚢 컨테이너" : sTypeRaw);
                            let movedText = it.isMoved ? `  🔁 휴무일 이월 (${it.origDateStr} → ${it.adjDateStr})\n` : '';
                            
                            msg += `• ${it.bl_number} | ${it.pallets} | ${sType}\n${movedText}`;
                        });
                    });
                }
            }
            
            await sendTgMsg(chatId, msg);
            return res.status(200).send('OK');
        }

        // 🚨 원본 Code.gs 양식: [일일 출고 및 랙 현황] (누락된 명령어 복구!)
        if (text === '/출고') {
            const todayStr = getKstDateStr(new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"})));
            const [rows] = await pool.query(`SELECT outbound_date, company, pal, box, isDone, etc FROM outbound WHERE isDone = 0`);
            
            let todayCargoList = []; let todayTaskList = [];
            let pendingCargoList = []; let pendingTaskList = [];
            let futureGroups = {}; 
            
            let mainRackPallets = 0; let otherLocationPallets = 0; 
            const RACK_CAPA = 48; // 기본 랙 최대 용량
            
            rows.forEach(r => {
                let company = String(r.company).trim();
                let etc = String(r.etc).trim();
                let pCount = parseInt(r.pal) || 0;
                let bCount = parseInt(r.box) || 0;
                
                let rawDateStr = "미정";
                if (r.outbound_date && r.outbound_date !== "미정") {
                    let dDate = new Date(r.outbound_date);
                    rawDateStr = `${dDate.getFullYear()}-${String(dDate.getMonth() + 1).padStart(2, '0')}-${String(dDate.getDate()).padStart(2, '0')}`;
                }

                const isOtherLocation = /(구역|창고|도크|바닥|외부|별도|야드)/.test(etc);
                let isTaskMode = company.toUpperCase().startsWith('[TASK]') || /OC|IC|폐기|반품|제작|하프|점검|휴무|야근/i.test(company);
                
                if (!isTaskMode) {
                    if (isOtherLocation) otherLocationPallets += pCount;
                    else mainRackPallets += pCount;
                }

                let cleanCompany = company.replace(/\[TASK\]/gi, '').trim();
                let etcText = etc ? ` 📍${etc}` : '';
                let qtyText = '';
                
                if (!isTaskMode) {
                    if (pCount > 0 && bCount > 0) qtyText = ` | ${pCount}P (${bCount}B)`;
                    else if (pCount > 0) qtyText = ` | ${pCount}P`;
                    else if (bCount > 0) qtyText = ` | ${bCount}B`;
                }

                let itemStr = '';
                if (isTaskMode) {
                    itemStr = ` 📌 [작업] ${cleanCompany}${qtyText}${etcText}`;
                } else {
                    let icon = rawDateStr === "미정" ? "📦" : "🚛";
                    itemStr = ` ${icon} ${cleanCompany}${qtyText}${etcText}`;
                }

                if (rawDateStr === todayStr) { 
                    if (isTaskMode) todayTaskList.push(itemStr); else todayCargoList.push(itemStr);
                } else if (rawDateStr === "미정") {
                    if (isTaskMode) pendingTaskList.push(itemStr); else pendingCargoList.push(itemStr);
                } else {
                    if (!futureGroups[rawDateStr]) futureGroups[rawDateStr] = { cargo: [], tasks: [] };
                    if (isTaskMode) futureGroups[rawDateStr].tasks.push(itemStr); else futureGroups[rawDateStr].cargo.push(itemStr);
                }
            });

            let msg = `🚚 [일일 출고 및 랙 현황]\n━━━━━━━━━━━━━━━━━━━━━\n`;
            const remain = RACK_CAPA - mainRackPallets;
            let statusIcon = remain <= 5 ? "🚨" : (remain <= 15 ? "🟡" : "🟢");
            
            msg += `${statusIcon} 현재 메인 랙(Rack) 점유율\n📊 적재량: ${mainRackPallets} / ${RACK_CAPA} PAL\n👉 (메인 랙 잔여: ${remain} PAL 여유)\n`;
            if (otherLocationPallets > 0) msg += `📦 타 구역 별도보관: 총 ${otherLocationPallets} PAL\n`;
            msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            msg += `📦 [오늘 출고 확정 리스트]\n`;
            if (todayCargoList.length === 0 && todayTaskList.length === 0) {
                msg += `• 예정된 출고/작업이 없습니다.\n`;
            } else {
                if (todayCargoList.length > 0) msg += todayCargoList.join('\n') + '\n';
                if (todayTaskList.length > 0) msg += todayTaskList.join('\n') + '\n';
            }
            
            msg += `━━━━━━━━━━━━━━━━━━━━━\n📅 [주간 출고 & 작업 타임라인]\n\n`;
            
            let sortedDates = Object.keys(futureGroups).sort();
            let hasFuture = false;
            const dayNames = ["일","월","화","수","목","금","토"];
            sortedDates.forEach(d => {
                hasFuture = true;
                let dateObj = new Date(d);
                let weekStr = dayNames[dateObj.getDay()];
                msg += `🔽 ${dateObj.getMonth() + 1}/${dateObj.getDate()} (${weekStr})\n`;
                let g = futureGroups[d];
                if (g.cargo.length > 0) msg += g.cargo.join('\n') + '\n';
                if (g.tasks.length > 0) msg += g.tasks.join('\n') + '\n';
                msg += '\n';
            });

            if (pendingCargoList.length > 0 || pendingTaskList.length > 0) {
                hasFuture = true;
                msg += `⏳ [일정 미정 (대기 및 보류)]\n`;
                if (pendingCargoList.length > 0) msg += pendingCargoList.join('\n') + '\n';
                if (pendingTaskList.length > 0) msg += pendingTaskList.join('\n') + '\n';
            }
            if (!hasFuture) msg += `• 예정된 대기 일정이 없습니다.\n`;

            await sendTgMsg(chatId, msg, [[ { text: "📅 출고 달력 크게 보기", url: "https://calendar-app-two-gules.vercel.app/" } ]]);
            return res.status(200).send('OK');
        }

        // 🚨 원본 Code.gs 양식: [월간 캘린더 요약 폼 + 요일 추가 복원]
        if (text.startsWith('/달력') || text.startsWith('/calendar') || text.startsWith('/출고달력') || text.startsWith('/용차달력')) {
            const isOutbound = text.includes('출고') || text.includes('용차');
            const parts = text.trim().split(/\s+/);
            
            let targetDate = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
            if (parts[1]) {
                const m = parseInt(parts[1], 10);
                if (m >= 1 && m <= 12) targetDate.setMonth(m - 1);
                else { await sendTgMsg(chatId, `⚠️ 월 형식이 잘못되었습니다.`); return res.status(200).send('OK'); }
            }
            
            const year = targetDate.getFullYear();
            const month = targetDate.getMonth() + 1;
            const dayNames = ["일","월","화","수","목","금","토"]; // 원본 요일 출력용
            
            let calStr = `[ 📋 ${month}월 ${isOutbound ? '출고' : '입고'} 스케줄 요약 ]\n\n`;
            let pendingCount = 0; let pendingStr = '';
            
            if (isOutbound) {
                const [rows] = await pool.query(`SELECT outbound_date, company, pal, box, isDone, etc FROM outbound WHERE YEAR(outbound_date) = ? AND MONTH(outbound_date) = ? ORDER BY outbound_date ASC`, [year, month]);
                
                // 🚨 [패치 완료] 출고 완료되지 않은(isDone=0) 항목 중 날짜가 없는 것만 추출
                const [pendings] = await pool.query(`SELECT company, pal, box, etc FROM outbound WHERE isDone = 0 AND (outbound_date IS NULL OR outbound_date = '미정')`);
                
                let currentD = ''; let dailyPal = 0; let dailyStr = '';
                rows.forEach(r => {
                    let dDate = new Date(r.outbound_date);
                    let dStr = `${month}/${String(dDate.getDate()).padStart(2, '0')}(${dayNames[dDate.getDay()]})`;
                    
                    if (currentD !== dStr) {
                        if (currentD !== '') calStr += `🚚 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                        currentD = dStr; dailyPal = 0; dailyStr = '';
                    }
                    dailyPal += parseInt(r.pal) || 0;
                    let mark = r.isDone ? ' (완료)' : ''; let etcStr = r.etc ? ` [${r.etc}]` : '';
                    dailyStr += ` • ${r.company} ${r.pal}p (${r.box}b)${mark}${etcStr}\n`;
                });
                if (currentD !== '') calStr += `🚚 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                if (rows.length === 0) calStr += `등록된 출고 일정이 없습니다.\n\n`;

                pendingCount = pendings.length;
                pendings.forEach(p => { pendingStr += ` • ${p.company} ${p.pal}p (${p.box}b)${p.etc ? ' ['+p.etc+']' : ''}\n`; });
            } else {
                const [rows] = await pool.query(`SELECT receive_date, bl_number, pallets, s_type, status, remarks FROM inbound WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY receive_date ASC`, [year, month]);
                
                // 🚨 [패치 완료] OR를 AND와 괄호()로 묶어 '날짜가 없는 대기 상태'만 완벽하게 필터링!
                const [pendings] = await pool.query(`SELECT bl_number, pallets, s_type, remarks FROM inbound WHERE status = '입고대기' AND (receive_date IS NULL OR receive_date = '미정')`);
                
                let currentD = ''; let dailyPal = 0; let dailyStr = '';
                rows.forEach(r => {
                    let dDate = new Date(r.receive_date);
                    let dStr = `${month}/${String(dDate.getDate()).padStart(2, '0')}(${dayNames[dDate.getDay()]})`;
                    
                    if (currentD !== dStr) {
                        if (currentD !== '') calStr += `📦 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                        currentD = dStr; dailyPal = 0; dailyStr = '';
                    }
                    dailyPal += parseInt(r.pallets) || 0;
                    let mark = r.status === '완료' ? ' [완료]' : ''; let etcStr = r.remarks ? ` [${r.remarks}]` : '';
                    let sTypeRaw = String(r.s_type || '').toUpperCase();
                    let sType = sTypeRaw === "AIR" ? "✈️ 탑차량" : (sTypeRaw === "SEA" ? "🚢 컨테이너" : sTypeRaw);
                    
                    dailyStr += ` • ${r.bl_number} ${r.pallets}p (${sType})${mark}${etcStr}\n`;
                });
                if (currentD !== '') calStr += `📦 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                if (rows.length === 0) calStr += `등록된 입고 일정이 없습니다.\n\n`;

                pendingCount = pendings.length;
                pendings.forEach(p => { 
                    let sTypeRaw = String(p.s_type || '').toUpperCase();
                    let sType = sTypeRaw === "AIR" ? "✈️ 탑차량" : (sTypeRaw === "SEA" ? "🚢 컨테이너" : sTypeRaw);
                    pendingStr += ` • ${p.bl_number} ${p.pallets}p (${sType})${p.remarks ? ' ['+p.remarks+']' : ''}\n`; 
                });
            }

            calStr += `⚠️ 일정 미정/대기 (${pendingCount}건)\n${pendingStr}`;
            const btnText = isOutbound ? "📅 출고 달력 크게 보기" : "📥 입고 달력 크게 보기";
            const btnUrl = isOutbound ? "https://calendar-app-two-gules.vercel.app/" : "https://calendar-app-two-gules.vercel.app/inbound.html";
            
            await sendTgMsg(chatId, calStr, [[ { text: btnText, url: btnUrl } ]]);
            return res.status(200).send('OK');
        }
        
     
        // =================================================================
        // 🔒 관리자(Admin) 전용 관문 (수동 제어 명령어 100% 복원!)
        // =================================================================
        const isImageUpload = (message.photo && message.photo.length > 0) || (message.document && message.document.mime_type?.startsWith('image/'));
        // 🚨 [패치 1] 누락되었던 관리자 명령어 리스트 대거 추가!
        const adminCmdList = ['/?', '/status', '/dup', '/cancel', '/ocr', '/test', '/reparse', '/완료', '/처리', '/일괄완료', '/용차', '/이동', '/위치', '/출고완료', '/용차완료', '/출고삭제', '/용차삭제'];
        const isAdminCmd = adminCmdList.some(cmd => text.startsWith(cmd));

        if (isAdminCmd || isImageUpload) {
            if (!isAdmin) {
                await sendTgMsg(chatId, "🚫 시스템 접근 거부: 관리자 전용 기능입니다. 권한이 없습니다.");
                return res.status(200).send('OK');
            }

            // 📘 [관리자 도움말]
            if (text.startsWith('/?')) {
                const adminHelpMsg = "📘 관리자 명령어 목록\n\n" +
                                     "[ 🚚 출고(용차) 및 랙 관리 ]\n" +
                                     "/용차 [업체] [박스] [파레트] [날짜] [비고]\n" +
                                     "- 출고 스케줄 등록/수정 (순서 무관)\n" +
                                     "- 예: /용차 쿠팡 120 3 0310 A구역\n\n" +
                                     "/이동 [업체] [장소]\n" +
                                     "- 파레트 보관 위치 변경 (예: /이동 쿠팡 바닥)\n\n" +
                                     "/출고완료 [업체]\n" +
                                     "- 상차 완료 처리 (랙 보관량에서 제외)\n\n" +
                                     "/출고삭제 [업체]\n" +         
                                     "- 취소/오입력된 대기 건 완전 삭제\n\n" + 
                                     "🟢 OCR 제어\n" +
                                     "[사진 전송] - OCR 대기열 등록\n" +
                                     "/ocr     - 대기 이미지 실행\n" +
                                     "/cancel  - 대기 이미지 취소\n" +
                                     "/reparse - 마지막 결과 재파싱\n" +
                                     "/test    - AI 교정 결과 가상 테스트\n\n" +
                                     "✅ 입고 수동 처리\n" +
                                     "/완료 [B/L|인보이스] [날짜]\n" +
                                     "- 예: /완료 BUD123 0304\n\n" +
                                     "/일괄완료 [날짜]\n" +
                                     "- 스케줄 누락 화물(미정) 일괄 처리\n\n" +
                                     "⚙️ 시스템 관리\n" +
                                     "/dup on | off - 중복 허용/차단\n" +
                                     "/dup reset    - 중복 기록 초기화\n" +
                                     "/status       - 봇 & DB 상태 확인";
                await sendTgMsg(chatId, adminHelpMsg);
                return res.status(200).send('OK');
            }

            // 📊 [상태 보고]
            if (text.startsWith('/status')) {
                let dbStatus = "🟢 정상";
                try { await pool.query('SELECT 1'); } catch(e) { dbStatus = "🔴 연결 실패"; }

                const [pendingRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                const [dupRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'DUP_OPTION'`);
                const [lastTimeRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_time'`);
                const [lastImgRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);

                let queueStatus = pendingRows.length > 0 ? "🖼 있음 (1건 대기)" : "— 없음";
                let dupStatus = (dupRows.length > 0 && String(dupRows[0].setting_value).includes('OFF')) ? "🔓 허용" : "🔒 차단";
                let lastTime = lastTimeRows.length > 0 ? safeGetJson(lastTimeRows[0].setting_value).time : "기록 없음";
                let lastImg = lastImgRows.length > 0 ? safeGetJson(lastImgRows[0].setting_value).url : "없음";

                const statusMsg = `⚙ OCR 봇 상태\n========================\n` +
                                  `🔎 DB 연결: ${dbStatus}\n` +
                                  `📌 대기 이미지: ${queueStatus}\n\n` +
                                  `🔒 중복 이미지: ${dupStatus}\n` +
                                  `🤖 AI 엔진: Gemini 2.5 Flash 🟢\n\n` +
                                  `🕒 마지막 OCR 시간\n${lastTime}\n\n` +
                                  `📁 최근 이미지 주소\n${lastImg}\n========================`;
                await sendTgMsg(chatId, statusMsg);
                return res.status(200).send('OK');
            }

            // ⚙️ [옵션 제어]
            if (text.startsWith('/dup')) {
                if (text.includes('on')) {
                    const val = '"ON"';
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('DUP_OPTION', ?) ON DUPLICATE KEY UPDATE setting_value=?`, [val, val]);
                    await sendTgMsg(chatId, '🔒 중복 이미지 차단 모드가 활성화되었습니다.');
                } else if (text.includes('off')) {
                    const val = '"OFF"';
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('DUP_OPTION', ?) ON DUPLICATE KEY UPDATE setting_value=?`, [val, val]);
                    await sendTgMsg(chatId, '🔓 중복 이미지 허용 모드가 활성화되었습니다.');
                } else if (text.includes('reset')) {
                    await pool.query(`DELETE FROM processed_images`);
                    await sendTgMsg(chatId, '♻ 중복 이미지 기록을 모두 초기화했습니다.');
                }
                return res.status(200).send('OK');
            }

            // 🚨 [패치 2] 입고 수동 완료 처리 복구 (/완료)
            if (text.startsWith('/완료') || text.startsWith('/처리')) {
                const parts = text.trim().split(/\s+/);
                if (parts.length < 2) {
                    await sendTgMsg(chatId, "⚠️ 사용법: /완료 [B/L 또는 인보이스] (옵션: 어제/0302)\n예시: /완료 BUD260143 0302");
                    return res.status(200).send('OK');
                }
                const targetStr = parts[1].toUpperCase().replace(/[\s•·\-\*]/g, '');
                const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                let dateToSet = new Date(now.getFullYear(), now.getMonth(), now.getDate());

                if (parts[2]) {
                    if (parts[2] === '어제') dateToSet.setDate(dateToSet.getDate() - 1);
                    else {
                        const match = parts[2].match(/^(\d{1,2})[-/]?(\d{1,2})$/);
                        if (match) dateToSet = new Date(now.getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]));
                        else { await sendTgMsg(chatId, "⚠️ 날짜 형식이 잘못되었습니다. (예: 어제, 0302)"); return res.status(200).send('OK'); }
                    }
                }
                const dateStr = getKstDateStr(dateToSet);

                let exist = [];
                if (targetStr !== '발행전') {
                    [exist] = await pool.query(`SELECT id, remarks, bl_number, invoice FROM inbound WHERE TRIM(bl_number) = ? OR TRIM(invoice) = ? ORDER BY id DESC LIMIT 1`, [targetStr, targetStr]);
                } else {
                    await sendTgMsg(chatId, "⚠️ '발행전'은 인보이스 번호로 검색해주세요! (예: /완료 25021455)");
                    return res.status(200).send('OK');
                }

                if (exist.length > 0) {
                    let etc = String(exist[0].remarks || '').trim();
                    if (!etc.includes('[수동완료]')) etc = etc ? etc + ' [수동완료]' : '[수동완료]';
                    await pool.query(`UPDATE inbound SET receive_date = ?, remarks = ?, status = '완료' WHERE id = ?`, [dateStr, etc, exist[0].id]);
                    let foundType = exist[0].bl_number === targetStr ? "B/L" : "인보이스";
                    await sendTgMsg(chatId, `✅ DB 수정 완료!\n[${targetStr}] 항목(${foundType})을 [${dateStr}] 일자로 입고 처리했습니다.`);
                } else await sendTgMsg(chatId, `❌ DB 검색 실패: [${targetStr}]에 해당하는 B/L이나 인보이스가 없습니다.`);
                return res.status(200).send('OK');
            }

            // 🚨 [패치 3] 누락 화물 일괄 완료 처리 복구 (/일괄완료)
            if (text.startsWith('/일괄완료')) {
                const parts = text.trim().split(/\s+/);
                const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                let dateToSet = new Date(now.getFullYear(), now.getMonth(), now.getDate());

                if (parts[1]) {
                    if (parts[1] === '어제') dateToSet.setDate(dateToSet.getDate() - 1);
                    else {
                        const match = parts[1].match(/^(\d{1,2})[-/]?(\d{1,2})$/);
                        if (match) dateToSet = new Date(now.getFullYear(), parseInt(match[1]) - 1, parseInt(match[2]));
                        else { await sendTgMsg(chatId, "⚠️ 날짜 형식이 잘못되었습니다. (예: /일괄완료 어제, /일괄완료 0302)"); return res.status(200).send('OK'); }
                    }
                }
                const dateStr = getKstDateStr(dateToSet);

                const [pendings] = await pool.query(`SELECT id, remarks FROM inbound WHERE status = '입고대기' AND (receive_date IS NULL OR receive_date = '미정')`);
                if (pendings.length === 0) {
                    await sendTgMsg(chatId, "⚠️ 현재 일괄 처리할 누락 화물(입고보류 등)이 DB에 없습니다.");
                    return res.status(200).send('OK');
                }

                for (const p of pendings) {
                    let etc = String(p.remarks || '').trim();
                    if (!etc.includes('[일괄완료]')) etc = etc ? etc + ' [일괄완료]' : '[일괄완료]';
                    await pool.query(`UPDATE inbound SET receive_date = ?, remarks = ?, status = '완료' WHERE id = ?`, [dateStr, etc, p.id]);
                }
                await sendTgMsg(chatId, `✅ 총 ${pendings.length}건의 누락 화물을 [${dateStr}] 일자로 일괄 입고 처리했습니다!\n이제 미입고 알림에 뜨지 않습니다.`);
                return res.status(200).send('OK');
            }

            // 🚨 [패치 4] 용차(출고) 수동 등록 및 수정 복구 (/용차)
            if (text.startsWith('/용차')) {
                const parts = text.trim().split(/\s+/).slice(1);
                if (parts.length === 0) {
                    await sendTgMsg(chatId, "⚠️ 사용법: /용차 [업체명] [박스] [파레트] [날짜] [비고]\n예시: /용차 쿠팡 120 3 0310 A구역");
                    return res.status(200).send('OK');
                }
                
                const company = parts[0]; 
                let dateStr = "미정"; let numbers = []; let etcParts = [];
                let explicitPal = null; let explicitBox = null;
                
                for (let i = 1; i < parts.length; i++) {
                    const p = parts[i];
                    let isDate = false; let mStr, dStr;
                    if (/^\d{4}$/.test(p)) {
                        const m = parseInt(p.substring(0,2), 10); const d = parseInt(p.substring(2,4), 10);
                        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) { isDate = true; mStr = m; dStr = d; }
                    } else if (/^(0?[1-9]|1[0-2])[-/]([0-2][0-9]|3[01])$/.test(p)) {
                        const match = p.match(/^(0?[1-9]|1[0-2])[-/]([0-2][0-9]|3[01])$/);
                        mStr = parseInt(match[1], 10); dStr = parseInt(match[2], 10); isDate = true;
                    }
                    
                    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                    if (isDate) { dateStr = `${now.getFullYear()}-${String(mStr).padStart(2, '0')}-${String(dStr).padStart(2, '0')}`; continue; }
                    if (p === '오늘') { dateStr = getKstDateStr(now); continue; }
                    if (p === '내일') { now.setDate(now.getDate()+1); dateStr = getKstDateStr(now); continue; }
                    
                    const numMatch = p.match(/^(\d+)(p|파|파레트|팔레트|b|박|박스|box)?$/i);
                    if (numMatch) {
                        const val = parseInt(numMatch[1], 10); const unit = numMatch[2] ? numMatch[2].toLowerCase() : '';
                        if (['p','파','파레트','팔레트'].includes(unit)) explicitPal = val;
                        else if (['b','박','박스','box'].includes(unit)) explicitBox = val;
                        else numbers.push(val);
                        continue;
                    }
                    etcParts.push(p);
                }
                
                let box = explicitBox !== null ? explicitBox : "";
                let pal = explicitPal !== null ? explicitPal : "";
                if (numbers.length === 2) {
                    if (pal === "") pal = Math.min(numbers[0], numbers[1]);
                    if (box === "") box = Math.max(numbers[0], numbers[1]);
                } else if (numbers.length === 1) {
                    if (pal === "" && box !== "") pal = numbers[0];
                    else if (box === "" && pal !== "") box = numbers[0];
                    else { box = numbers[0]; pal = ""; } 
                }
                
                const etcStr = etcParts.join(" ");
                const [exist] = await pool.query(`SELECT * FROM outbound WHERE company = ? AND isDone = 0 ORDER BY id DESC LIMIT 1`, [company]);
                
                if (exist.length > 0) {
                    let existingPal = exist[0].pal; let existingBox = exist[0].box;
                    if (numbers.length === 1 && explicitPal === null && explicitBox === null) {
                        if (existingPal !== "" && existingBox === "") { box = numbers[0]; pal = existingPal; }
                        else if (existingBox !== "" && existingPal === "") { pal = numbers[0]; box = existingBox; }
                        else { box = numbers[0]; pal = existingPal; }
                    } else if (pal === "" && box === "") { pal = existingPal; box = existingBox; }
                    else { if(pal === "") pal = existingPal; if(box === "") box = existingBox; }
                    
                    const finalDate = dateStr !== "미정" ? dateStr : exist[0].outbound_date;
                    const finalEtc = etcStr !== "" ? etcStr : exist[0].etc;
                    
                    await pool.query(`UPDATE outbound SET pal=?, box=?, outbound_date=?, etc=? WHERE id=?`, [pal, box, finalDate, finalEtc, exist[0].id]);
                    let msg = `🔄 [${company}] 데이터 덮어쓰기 완료!\n`;
                    if (pal === "" || box === "") msg += `⚠️ (주의) 박스나 파레트 수량이 누락되었습니다.\n`;
                    msg += `👉 ${pal}p / ${box ? box : '?'}b / ${finalDate || '미정'} ${finalEtc ? '['+finalEtc+']' : ''}`;
                    await sendTgMsg(chatId, msg);
                } else {
                    if (numbers.length === 1 && explicitPal === null && explicitBox === null) { pal = numbers[0]; }
                    await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, etc, isDone) VALUES (?, ?, ?, ?, ?, 0)`, [company, pal, box, dateStr === '미정' ? null : dateStr, etcStr]);
                    let msg = `✅ [${company}] 신규 출고 등록 완료!\n`;
                    if (pal === "" || box === "") msg += `⚠️ (주의) 박스나 파레트 수량이 누락되었습니다.\n`;
                    msg += `👉 ${pal ? pal+'p' : '?p'} / ${box ? box+'b' : '?b'} / ${dateStr} ${etcStr ? '['+etcStr+']' : ''}`;
                    await sendTgMsg(chatId, msg);
                }
                return res.status(200).send('OK');
            }

            // 🚨 [패치 5] 용차 이동/위치 지정 복구 (/이동)
            if (text.startsWith('/이동') || text.startsWith('/위치')) {
                const parts = text.trim().split(/\s+/);
                if (parts.length < 3) { 
                    await sendTgMsg(chatId, "⚠️ 사용법: /이동 [업체명] [장소]\n예시: /이동 쿠팡 바닥\n(메인 랙으로 원복 시: /이동 쿠팡 랙)");
                    return res.status(200).send('OK'); 
                }
                const company = parts[1]; const location = parts.slice(2).join(" ");
                
                const [exist] = await pool.query(`SELECT * FROM outbound WHERE company = ? AND isDone = 0 ORDER BY id DESC LIMIT 1`, [company]);
                if (exist.length > 0) {
                    let etc = String(exist[0].etc || '').replace(/\[(보관|이동):\s*[^\]]+\]/g, '').trim();
                    let newEtc = (location === '랙' || location === '메인랙') ? etc : etc + ` [이동: ${location}]`;
                    await pool.query(`UPDATE outbound SET etc=? WHERE id=?`, [newEtc.trim(), exist[0].id]);
                    
                    let msg = `🚚 [${company}] 파레트가 [${location}](으)로 이동 처리되었습니다.\n`;
                    if (/(구역|창고|도크|바닥|외부|별도|야드)/.test(location)) msg += `👉 (해당 파레트만큼 메인 랙(Rack) 여유 공간이 즉시 확보되었습니다!)`;
                    else msg += `👉 (다시 메인 랙(Rack) 점유율에 합산됩니다.)`;
                    await sendTgMsg(chatId, msg);
                } else await sendTgMsg(chatId, `❌ 대기 중인 [${company}] 차량이 없습니다.`);
                return res.status(200).send('OK');
            }

            // 🚨 [패치 6] 용차 완료 수동 처리 복구 (/출고완료)
            if (text.startsWith('/출고완료') || text.startsWith('/용차완료')) {
                const parts = text.trim().split(/\s+/);
                if (parts.length < 2) { 
                    await sendTgMsg(chatId, "⚠️ 사용법: /출고완료 [업체명]\n예시: /출고완료 쿠팡");
                    return res.status(200).send('OK'); 
                }
                const company = parts[1];
                
                const [exist] = await pool.query(`SELECT * FROM outbound WHERE company = ? AND isDone = 0 ORDER BY id DESC LIMIT 1`, [company]);
                if (exist.length > 0) {
                    let etc = String(exist[0].etc || '').trim();
                    let newEtc = etc ? etc + ' [출고완료]' : '[출고완료]';
                    await pool.query(`UPDATE outbound SET etc=?, isDone=1 WHERE id=?`, [newEtc, exist[0].id]);
                    await sendTgMsg(chatId, `🚚 [${company}] 출고 완료!\n(해당 파레트가 랙(Rack) 보관량에서 제외되었습니다.)`);
                } else await sendTgMsg(chatId, `❌ 대기 중인 [${company}] 차량이 없습니다.`);
                return res.status(200).send('OK');
            }

            // 🚨 [패치 7] 잘못된 용차 내역 영구 삭제 복구 (/출고삭제)
            if (text.startsWith('/출고삭제') || text.startsWith('/용차삭제')) {
                const parts = text.trim().split(/\s+/);
                if (parts.length < 2) { 
                    await sendTgMsg(chatId, "⚠️ 사용법: /출고삭제 [업체명]\n예시: /출고삭제 쿠팡");
                    return res.status(200).send('OK'); 
                }
                const company = parts[1];
                
                const [exist] = await pool.query(`SELECT id FROM outbound WHERE company = ? AND isDone = 0 ORDER BY id DESC LIMIT 1`, [company]);
                if (exist.length > 0) {
                    await pool.query(`DELETE FROM outbound WHERE id=?`, [exist[0].id]);
                    await sendTgMsg(chatId, `🗑️ [${company}] 대기 중인 출고 스케줄이 DB에서 완전히 삭제되었습니다.`);
                } else await sendTgMsg(chatId, `❌ 삭제 실패: 현재 대기 중인 [${company}] 차량이 없습니다.`);
                return res.status(200).send('OK');
            }

            // 📥 [이미지 대기열] 원본 가이드 메시지 복원
            if (isImageUpload) {
            // ... (기존 코드와 이어집니다) ...
                let fileId = null; let uniqueId = null;
                if (message.photo && message.photo.length > 0) {
                    const p = message.photo[message.photo.length - 1];
                    fileId = p.file_id; uniqueId = p.file_unique_id;
                } else if (message.document && message.document.mime_type?.startsWith('image/')) {
                    fileId = message.document.file_id; uniqueId = message.document.file_unique_id;
                }

                if (fileId) {
                    const [dupRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'DUP_OPTION'`);
                    let blockDup = (dupRows.length === 0 || !String(dupRows[0].setting_value).includes('OFF'));
                    if (blockDup) {
                        const [exist] = await pool.query(`SELECT 1 FROM processed_images WHERE unique_id = ?`, [uniqueId]);
                        if (exist.length > 0) {
                            await sendTgMsg(chatId, `⚠️ 이미 처리된 이미지입니다. (중복 차단)\n강제로 처리하려면 '/dup off' 입력 후 다시 올려주세요.`);
                            return res.status(200).send('OK');
                        }
                    }

                    const jsonData = JSON.stringify({ id: fileId, uniqueId: uniqueId });
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('PENDING_IMAGE_DATA', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonData, jsonData]);
                    const guideMsg = "📥 이미지가 대기열에 등록되었습니다.\n\n▶️ 실제 DB 반영: /ocr\n🧪 가상 테스트 (AI 검수만): /test\n❌ 대기열 취소: /cancel";
                    await sendTgMsg(chatId, guideMsg);
                    return res.status(200).send('OK');
                }
            }

            if (text.startsWith('/cancel')) {
                await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                await sendTgMsg(chatId, `🗑️ 대기 중인 이미지가 취소되었습니다.`);
                return res.status(200).send('OK');
            }

            const isTest = text.startsWith('/test');
            const isReparse = text.startsWith('/reparse');
            
            if (text.startsWith('/ocr') || isTest || isReparse) {
                let targetFileId = null; let targetUniqueId = null; let fullUrl = '';

                if (isReparse) {
                    const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);
                    if (rows.length === 0 || !rows[0].setting_value) {
                        await sendTgMsg(chatId, `⚠️ 재처리할 이전 이미지가 없습니다.`);
                        return res.status(200).send('OK');
                    }
                    const pData = safeGetJson(rows[0].setting_value);
                    fullUrl = pData.url || "";
                } else {
                    const [pendingRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                    if (pendingRows.length === 0 || !pendingRows[0].setting_value) {
                        await sendTgMsg(chatId, `⚠️ 대기 중인 이미지가 없습니다. 사진을 먼저 올려주세요.`);
                        return res.status(200).send('OK');
                    }
                    const pData = safeGetJson(pendingRows[0].setting_value);
                    targetFileId = pData.id; targetUniqueId = pData.uniqueId || null;
                    if (!isTest) await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                }

                await sendTgMsg(chatId, isReparse ? `🔁 마지막 이미지 재파싱을 시작합니다...` : `🔄 이미지 다운로드 및 판독을 시작합니다...`);
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                if (!isReparse) {
                    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
                    const fileData = await fileRes.json();
                    fullUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                }

                const imgRes = await fetch(fullUrl);
                const imgBuffer = await imgRes.arrayBuffer();
                const base64Image = Buffer.from(imgBuffer).toString('base64');

                const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ requests: [{ image: { content: base64Image }, features: [{ type: 'TEXT_DETECTION' }] }] })
                });
                const visionData = await visionRes.json();
                const extractedText = visionData.responses[0]?.fullTextAnnotation?.text || "";
                if (!extractedText) { await sendTgMsg(chatId, `⚠️ 텍스트를 찾을 수 없습니다.`); return res.status(200).send('OK'); }

                const parsedResult = parseOcrLinesLocal(extractedText);
                if (parsedResult.length === 0) { await sendTgMsg(chatId, `⚠️ 인식된 데이터가 없습니다.`); return res.status(200).send('OK'); }

                await sendTgMsg(chatId, `🤖 AI가 데이터를 분석 중입니다...`);
                let finalRows = parsedResult; let aiSuccess = false;
                try {
                    const prompt = `너는 물류 데이터베이스 전문 AI 관리자야.\n[원본 텍스트]\n${extractedText}\n[기존 파싱 결과]\n${JSON.stringify(parsedResult)}\n\n[임무 및 규칙]\n1. 기존 파싱 결과에서 빠진 B/L 항목이 있다면 원본을 보고 채워 넣어.\n2. OCR 오타를 문맥에 맞게 논리적으로 수정해.\n3. 원본에 '발행 전' 또는 '발행전'이라고 적힌 항목은 'B/L번호'를 의미해.\n절대 ETC 등 다른 열로 밀어내지 말고, 반드시 첫 번째 열(B/L번호)에 "발행전" 이라고 입력해.\n4. 오직 [bl, pal, eta, inDate, fwd, sType, invoice, etc] 키를 가진 JSON 객체 배열만 출력해. (마크다운 금지)`;
                    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.0, responseMimeType: "application/json" } })
                    });
                    const geminiJson = await geminiRes.json();
                    if (geminiJson.candidates && geminiJson.candidates.length > 0) {
                        let aiText = geminiJson.candidates[0].content.parts[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
                        const aiData = JSON.parse(aiText);
                        if (Array.isArray(aiData) && aiData.length > 0) { finalRows = aiData; aiSuccess = true; }
                    }
                } catch (e) { await sendTgMsg(chatId, `⚠️ AI 서버 통신 오류 감지. 안전을 위해 기본 파싱 데이터로 진행합니다.`); }

                // ✨ [최종 결과 메시지] 원본 양식 복원
                let resultHeader = isTest ? `🧪 [안전 테스트] AI 교정 결과 미리보기\n` : (aiSuccess ? `✨ 최종 DB 반영 완료 (AI 스마트 교정)\n` : `✅ 최종 DB 반영 완료 (기본 파싱 보존)\n`);
                let resultList = "";
                finalRows.forEach(r => { resultList += `• ${r.bl} | ${r.pal}PAL | ${r.inDate || '미정'}\n`; });

                if (isTest) {
                    await sendTgMsg(chatId, resultHeader + resultList + `\n💡 (위 데이터는 AI 교정 결과입니다. 완벽하다면 /ocr 을 눌러 확정하세요!)`);
                    return res.status(200).send('OK');
                }

                // DB 저장 로직
                let updateCount = 0; let insertCount = 0;
                for (const r of finalRows) {
                    let bl = String(r.bl || '').replace(/[\s•·\-\*]/g, '');
                    let pal = parseInt(r.pal) || 0;
                    let inDate = r.inDate || null; let fwd = r.fwd || '';
                    let sType = String(r.sType || '').toUpperCase();
                    let invoice = r.invoice || ''; let etc = r.etc || '';
                    let eta = r.eta || null; let isAiVal = aiSuccess ? 1 : 0; 

                    let exist = [];
                    if (invoice) { [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? LIMIT 1`, [invoice]); }
                    if (exist.length === 0 && bl !== '발행전' && bl !== '') { [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? LIMIT 1`, [bl]); }

                    if (exist.length > 0) {
                        await pool.query(`UPDATE inbound SET bl_number=?, pallets=?, receive_date=?, remarks=?, s_type=?, fwd=?, invoice=?, eta=?, is_ai_modified=? WHERE id=?`, [bl, pal, inDate, etc, sType, fwd, invoice, eta, isAiVal, exist[0].id]);
                        updateCount++;
                    } else {
                        await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, s_type, fwd, invoice, eta, remarks, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, ?, ?)`, [bl, pal, inDate, sType, fwd, invoice, eta, etc, isAiVal]);
                        insertCount++;
                    }
                }

                await sendTgMsg(chatId, resultHeader + resultList + `\n(신규 ${insertCount}건 / 덮어쓰기 ${updateCount}건)`);

                // 🛡️ [스케줄 누락 감지] 원본 양식 복원
                try {
                    const currentKeys = finalRows.map(r => String(r.bl || '').replace(/[\s•·\-\*]/g, ''));
                    const [pendingRowsInDb] = await pool.query(`SELECT bl_number, pallets FROM inbound WHERE status = '입고대기' AND (receive_date IS NULL OR receive_date = '미정')`);
                    let orphans = [];
                    pendingRowsInDb.forEach(row => {
                        let dbKey = String(row.bl_number).replace(/[\s•·\-\*]/g, '');
                        if (!currentKeys.includes(dbKey)) orphans.push({ bl: row.bl_number, pal: row.pallets });
                    });
                    if (orphans.length > 0) {
                        let orphanMsg = `💡 [스케줄 누락 화물 감지]\n방금 올리신 이미지에는 없지만, 기존 DB에 '입고보류/미정' 상태인 화물이 ${orphans.length}건 있습니다.\n\n`;
                        orphans.forEach(o => orphanMsg += `• ${o.bl} (${o.pal} PAL)\n`);
                        orphanMsg += `\n입고가 완료되어 스케줄에서 빠진 것이라면, 웹앱 달력에서 터치하여 즉시 완료 처리해 주세요!`;
                        await sendTgMsg(chatId, orphanMsg);
                    }
                } catch (e) {}

                if (!isReparse && targetUniqueId) { await pool.query(`INSERT IGNORE INTO processed_images (unique_id) VALUES (?)`, [targetUniqueId]); }

                // 기록 저장
                const currentTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                const timeStr = `${currentTime.getMonth() + 1}월${currentTime.getDate()}일 ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
                const jsonUrl = JSON.stringify({ url: fullUrl, fileId: targetFileId });
                const jsonTime = JSON.stringify({ time: timeStr });
                const jsonDataStr = JSON.stringify(finalRows); 
                
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonUrl, jsonUrl]);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonTime, jsonTime]);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('LAST_OCR_DATA', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonDataStr, jsonDataStr]);
                
                return res.status(200).send('OK');
            }
        } 

    } catch (error) {
        console.error("🔥 시스템 에러:", error);
        await sendTgMsg(chatId, `🔥 에러 발생: ${error.message}`);
    }

    return res.status(200).send('OK');
}

// =================================================================
// 🧠 관리자님의 로컬 정규식 파싱 엔진 (원본 100% 동일)
// =================================================================
function parseOcrLinesLocal(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const cleanBL = v => String(v).replace(/[\s•·\-\*]/g, '');
    const isBL = v => /^(DSV|BUD|S)\d{6,8}$/i.test(cleanBL(v)) || cleanBL(v) === '발행전';
    const isPal = v => /^\d{1,3}$/.test(v); 
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v); 
    const isSType = v => /^(AIR|SEA)$/i.test(v);
    const isFwd = v => /^[A-Za-z]+$/.test(v) && !isSType(v); 
    const isInvoice = v => /^\d{7,8}$/.test(v); 

    const rows = [];
    let orphanInvoices = []; let orphanEtc = [];
    let activeRowIndex = 0; 

    const tokens = [];
    for (let i = 0; i < lines.length; i++) {
        let raw = lines[i];
        if (/^(안녕하세요|B\/?L|PAL|ETA|3PL\s*입고|Fwd|S\.?Type|Invoice|ETC|Free time)/i.test(raw)) continue;
        if (!isBL(raw) && raw.includes(' ')) {
            const parts = raw.split(/\s+/);
            const strongTokens = parts.filter(p => isDate(p) || isSType(p) || isInvoice(p) || isBL(p));
            if (strongTokens.length > 0 && parts.length <= 5) { tokens.push(...parts); continue; }
        }
        tokens.push(raw);
    }

    for (let raw of tokens) {
        if (isBL(raw)) {
            if (rows.length > 0) {
                let lastRow = rows[rows.length - 1];
                let hasData = lastRow.pal || lastRow.eta || lastRow.inDate || lastRow.sType || lastRow.fwd || lastRow.invoices.length > 0;
                if (hasData) {
                    rows.push({ bl: cleanBL(raw), pal: '', eta: '', inDate: '', fwd: '', sType: '', invoices: [...orphanInvoices], etc: [...orphanEtc] });
                    activeRowIndex = rows.length - 1; 
                    orphanInvoices = []; orphanEtc = [];
                    continue;
                }
            }
            rows.push({ bl: cleanBL(raw), pal: '', eta: '', inDate: '', fwd: '', sType: '', invoices: [...orphanInvoices], etc: [...orphanEtc] });
            orphanInvoices = []; orphanEtc = [];
            continue; 
        } 
        
        if (rows.length === 0) {
            let invMatch = raw.match(/\b\d{7,8}\b/g);
            if (invMatch && !isDate(raw)) {
                invMatch.forEach(inv => orphanInvoices.push(inv));
                let cleanEtc = raw.replace(/\b\d{7,8}\b/g, '').replace(/\s{2,}/g, ' ').trim();
                if (cleanEtc) orphanEtc.push(cleanEtc);
            } else if (isInvoice(raw)) { orphanInvoices.push(raw); } 
            else { orphanEtc.push(raw); }
            continue;
        }

        let assigned = false;
        let curr = activeRowIndex;
        while (curr < rows.length) {
            if (isPal(raw)) { if (!rows[curr].pal) { rows[curr].pal = raw; activeRowIndex = curr; assigned = true; break; } } 
            else if (isDate(raw)) {
                if (!rows[curr].eta) { rows[curr].eta = raw; activeRowIndex = curr; assigned = true; break; }
                else if (!rows[curr].inDate) { rows[curr].inDate = raw; activeRowIndex = curr; assigned = true; break; }
            } else if (isSType(raw)) { if (!rows[curr].sType) { rows[curr].sType = raw.toUpperCase(); activeRowIndex = curr; assigned = true; break; } } 
            else if (isFwd(raw)) { if (!rows[curr].fwd) { rows[curr].fwd = raw; activeRowIndex = curr; assigned = true; break; } } 
            else { break; }
            curr++;
        }

        if (!assigned) {
            if (isInvoice(raw)) { rows[activeRowIndex].invoices.push(raw); } 
            else if (!isPal(raw) && !isDate(raw) && !isSType(raw) && !isFwd(raw)) {
                let invMatch = raw.match(/\b\d{7,8}\b/g);
                if (invMatch) {
                    invMatch.forEach(inv => rows[activeRowIndex].invoices.push(inv));
                    let cleanEtc = raw.replace(/\b\d{7,8}\b/g, '').replace(/\s{2,}/g, ' ').trim();
                    if (cleanEtc) rows[activeRowIndex].etc.push(cleanEtc);
                } else { rows[activeRowIndex].etc.push(raw); }
            } else { rows[activeRowIndex].etc.push(raw); }
        }
    } 
    
    return rows.map(r => ({
        bl: r.bl, 
        pal: Number(r.pal) || 0, 
        eta: r.eta || '', 
        inDate: r.inDate || '', 
        fwd: r.fwd || '', 
        sType: r.sType || '', 
        invoice: r.invoices.join(', '), 
        etc: r.etc.join(' ')
    }));
}