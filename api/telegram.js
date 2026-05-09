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
    const chatId = message.chat.id;
    const text = message.text || '';
    const pool = mysql.createPool(process.env.DATABASE_URL);

    // 👑 관리자 여부 철통 검증
    const isAdmin = String(chatId) === String(process.env.ADMIN_TELEGRAM_USER_ID);

    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS processed_images (unique_id VARCHAR(100) PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        // =================================================================
        // 🔓 퍼블릭(공용) 관문
        // =================================================================
        if (text.startsWith('/help') || text.startsWith('/도움')) {
            const helpMsg = `🤖 3PL 입/출고 알림 봇 사용 안내\n\n[ 📥 입고 스케줄 ]\n📦 /입고 (또는 /today)\n- 오늘 기준 입고 예정 건 조회\n\n📅 /이번주, /다음주, /저번주\n- 주차별 입고 스케줄 요약 브리핑\n\n🗓️ /달력 [월] (예: /달력 3)\n- 월간 입고 스케줄을 한눈에 보는 캘린더\n\n[ 🚚 출고 스케줄 ]\n🗓️ /출고달력 [월] (예: /출고달력 3)\n- 월간 용차/출고 스케줄 캘린더`;
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
                const startOfThisWeek = new Date(today);
                startOfThisWeek.setDate(today.getDate() - day);
                
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
            
            const sStr = getKstDateStr(startDate);
            const eStr = getKstDateStr(endDate);
            
            const [rows] = await pool.query(`SELECT * FROM inbound WHERE receive_date BETWEEN ? AND ? ORDER BY receive_date ASC`, [sStr, eStr]);
            
            let msg = `📅 [${title} 입고 스케줄 요약]\n(${sStr} ~ ${eStr})\n\n`;
            if (rows.length === 0) msg += `등록된 입고 일정이 없습니다.\n`;
            else {
                let currentD = '';
                rows.forEach(r => {
                    let dStr = formatDbDateShort(r.receive_date);
                    if (currentD !== dStr) { msg += `\n🔽 ${dStr}\n`; currentD = dStr; }
                    let mark = r.status === '완료' ? ' [완료]' : '';
                    let etc = r.remarks ? ` [${r.remarks}]` : '';
                    msg += ` • ${r.bl_number} ${r.pallets}p (${r.s_type})${mark}${etc}\n`;
                });
            }
            await sendTgMsg(chatId, msg);
            return res.status(200).send('OK');
        }

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
            
            let calStr = `[ 📋 ${month}월 ${isOutbound ? '출고' : '입고'} 스케줄 요약 ]\n\n`;
            let pendingCount = 0; let pendingStr = '';
            
            if (isOutbound) {
                const [rows] = await pool.query(`SELECT outbound_date, company, pal, box, isDone, etc FROM outbound WHERE YEAR(outbound_date) = ? AND MONTH(outbound_date) = ? ORDER BY outbound_date ASC`, [year, month]);
                const [pendings] = await pool.query(`SELECT company, pal, box, etc FROM outbound WHERE outbound_date IS NULL OR outbound_date = '미정'`);
                
                let currentD = ''; let dailyPal = 0; let dailyStr = '';
                rows.forEach(r => {
                    let dStr = formatDbDateShort(r.outbound_date);
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
                const [pendings] = await pool.query(`SELECT bl_number, pallets, s_type, remarks FROM inbound WHERE status = '입고대기' OR receive_date IS NULL OR receive_date = '미정'`);
                
                let currentD = ''; let dailyPal = 0; let dailyStr = '';
                rows.forEach(r => {
                    let dStr = formatDbDateShort(r.receive_date);
                    if (currentD !== dStr) {
                        if (currentD !== '') calStr += `📦 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                        currentD = dStr; dailyPal = 0; dailyStr = '';
                    }
                    dailyPal += parseInt(r.pallets) || 0;
                    let mark = r.status === '완료' ? ' [완료]' : ''; let etcStr = r.remarks ? ` [${r.remarks}]` : '';
                    dailyStr += ` • ${r.bl_number} ${r.pallets}p (${r.s_type})${mark}${etcStr}\n`;
                });
                if (currentD !== '') calStr += `📦 ${currentD} - 총 ${dailyPal}p\n${dailyStr}\n`;
                if (rows.length === 0) calStr += `등록된 입고 일정이 없습니다.\n\n`;

                pendingCount = pendings.length;
                pendings.forEach(p => { pendingStr += ` • ${p.bl_number} ${p.pallets}p (${p.s_type})${p.remarks ? ' ['+p.remarks+']' : ''}\n`; });
            }

            calStr += `⚠️ 일정 미정/대기 (${pendingCount}건)\n${pendingStr}`;

            const btnText = isOutbound ? "📅 출고 달력 크게 보기" : "📥 입고 달력 크게 보기";
            const btnUrl = isOutbound ? "https://calendar-app-two-gules.vercel.app/" : "https://calendar-app-two-gules.vercel.app/inbound.html";
            
            await sendTgMsg(chatId, calStr, [[ { text: btnText, url: btnUrl } ]]);
            return res.status(200).send('OK');
        }

        // =================================================================
        // 🔒 관리자(Admin) 전용 관문
        // =================================================================
        const isImageUpload = (message.photo && message.photo.length > 0) || (message.document && message.document.mime_type?.startsWith('image/'));
        const adminCmdList = ['/?', '/status', '/dup', '/cancel', '/ocr', '/test', '/reparse'];
        const isAdminCmd = adminCmdList.some(cmd => text.startsWith(cmd));

        if (isAdminCmd || isImageUpload) {
            if (!isAdmin) {
                await sendTgMsg(chatId, "🚫 시스템 접근 거부: 관리자 전용 기능입니다. 권한이 없습니다.");
                return res.status(200).send('OK');
            }

            if (text.startsWith('/?')) {
                const adminHelpMsg = `📘 [관리자 전용 시스템 봇 매뉴얼]\n\n📸 이미지 처리\n[사진 전송] : OCR 대기열 등록\n/ocr : DB 자동 등록\n/test : AI 결과 텍스트 확인\n/reparse : 마지막 사진 재파싱\n/cancel : 대기열 취소\n\n⚙️ 시스템 관리\n/dup on|off|reset : 중복 차단 설정\n/status : 봇 & DB 상태 확인`;
                await sendTgMsg(chatId, adminHelpMsg);
                return res.status(200).send('OK');
            }

            if (text.startsWith('/status')) {
                let dbStatus = "🔴 연결 실패";
                try { await pool.query('SELECT 1'); dbStatus = "🟢 정상 연결됨"; } catch(e) {}
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                let queueStatus = rows.length > 0 ? "🟡 1장 대기 중" : "⚪ 비어있음";
                const [dupRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'DUP_OPTION'`);
                let dupStatus = (dupRows.length > 0 && dupRows[0].setting_value === 'OFF') ? "🔓 허용" : "🔒 차단";
                await sendTgMsg(chatId, `📊 [관리자 시스템 보고]\n\nTiDB 데이터: ${dbStatus}\nOCR 대기열: ${queueStatus}\n중복 방지: ${dupStatus}\nAI 엔진: Gemini 2.5 Flash 🟢`);
                return res.status(200).send('OK');
            }

            if (text.startsWith('/dup')) {
                if (text.includes('on')) {
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('DUP_OPTION', 'ON') ON DUPLICATE KEY UPDATE setting_value='ON'`);
                    await sendTgMsg(chatId, '🔒 중복 이미지 차단 모드 활성화');
                } else if (text.includes('off')) {
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('DUP_OPTION', 'OFF') ON DUPLICATE KEY UPDATE setting_value='OFF'`);
                    await sendTgMsg(chatId, '🔓 중복 이미지 허용 모드 활성화');
                } else if (text.includes('reset')) {
                    await pool.query(`DELETE FROM processed_images`);
                    await sendTgMsg(chatId, '♻ 중복 이미지 기록을 모두 초기화했습니다.');
                }
                return res.status(200).send('OK');
            }

            if (isImageUpload) {
                let fileId = null; let uniqueId = null;
                if (message.photo && message.photo.length > 0) {
                    const p = message.photo[message.photo.length - 1];
                    fileId = p.file_id; uniqueId = p.file_unique_id;
                } else if (message.document && message.document.mime_type?.startsWith('image/')) {
                    fileId = message.document.file_id; uniqueId = message.document.file_unique_id;
                }

                if (fileId) {
                    const [dupRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'DUP_OPTION'`);
                    let blockDup = (dupRows.length === 0 || dupRows[0].setting_value !== 'OFF');
                    
                    if (blockDup) {
                        const [exist] = await pool.query(`SELECT 1 FROM processed_images WHERE unique_id = ?`, [uniqueId]);
                        if (exist.length > 0) {
                            await sendTgMsg(chatId, `⚠️ 이미 처리된 이미지입니다. (중복 차단)\n강제로 처리하려면 '/dup off' 입력 후 다시 올려주세요.`);
                            return res.status(200).send('OK');
                        }
                    }

                    const jsonData = JSON.stringify({ id: fileId, uniqueId: uniqueId });
                    await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('PENDING_IMAGE_DATA', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonData, jsonData]);
                    await sendTgMsg(chatId, `📥 [이미지 대기열 등록 완료]\n\n▶️ DB에 즉시 반영: /ocr\n🧪 AI 결과 미리보기: /test\n❌ 처리 취소: /cancel`);
                    return res.status(200).send('OK');
                }
            }

            if (text.startsWith('/cancel')) {
                await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                await sendTgMsg(chatId, `🗑️ 대기열 이미지가 취소되었습니다.`);
                return res.status(200).send('OK');
            }

            const isTest = text.startsWith('/test');
            const isReparse = text.startsWith('/reparse');
            
            if (text.startsWith('/ocr') || isTest || isReparse) {
                let targetFileId = null; let targetUniqueId = null; let fullUrl = '';

                if (isReparse) {
                    const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);
                    if (rows.length === 0 || !rows[0].setting_value) {
                        await sendTgMsg(chatId, `⚠️ 재처리할 이전 이미지가 없습니다.`); return res.status(200).send('OK');
                    }
                    const pData = safeGetJson(rows[0].setting_value);
                    fullUrl = pData.url || "";
                } else {
                    const [pendingRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                    if (pendingRows.length === 0 || !pendingRows[0].setting_value) {
                        await sendTgMsg(chatId, `⚠️ 대기 중인 이미지가 없습니다. 사진을 먼저 올려주세요.`); return res.status(200).send('OK');
                    }
                    
                    const pData = safeGetJson(pendingRows[0].setting_value);
                    targetFileId = pData.id; 
                    targetUniqueId = pData.uniqueId || null;

                    if (!isTest) await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_DATA'`);
                }

                await sendTgMsg(chatId, isReparse ? `🔁 마지막 이미지 재파싱을 시작합니다...` : `🔄 이미지 다운로드 및 판독을 시작합니다...`);

                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                if (!isReparse) {
                    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
                    const fileData = await fileRes.json();
                    fullUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                }

                if (!fullUrl) {
                    await sendTgMsg(chatId, `⚠ 이미지 주소를 읽어오는 데 실패했습니다.`); return res.status(200).send('OK');
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

                if (!extractedText) {
                    await sendTgMsg(chatId, `⚠ 이미지에서 텍스트를 찾을 수 없습니다.`); return res.status(200).send('OK');
                }

                const parsedResult = parseOcrLinesLocal(extractedText);
                if (parsedResult.length === 0) {
                    await sendTgMsg(chatId, `⚠ 인식된 데이터가 없습니다.`); return res.status(200).send('OK');
                }

                await sendTgMsg(chatId, `🤖 Gemini AI가 데이터의 문맥을 분석하고 교정 중입니다...`);

                let finalRows = parsedResult; let aiSuccess = false;
                try {
                    const prompt = `너는 물류 데이터베이스 전문 AI 관리자야.
[원본 텍스트]
${extractedText}
[기존 파싱 결과]
${JSON.stringify(parsedResult)}

[임무 및 규칙]
1. 기존 파싱 결과에서 빠진 B/L 항목이 있다면 원본을 보고 채워 넣어.
2. OCR 오타를 문맥에 맞게 논리적으로 수정해.
3. 원본에 '발행 전' 또는 '발행전'이라고 적힌 항목은 'B/L번호'를 의미해. 절대 ETC 등 다른 열로 밀어내지 말고, 반드시 첫 번째 열(B/L번호)에 "발행전" 이라고 입력해.
4. 오직 [bl, pal, eta, inDate, fwd, sType, invoice, etc] 키를 가진 JSON 객체 배열만 출력해. (마크다운 금지)`;

                    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.0, responseMimeType: "application/json" } })
                    });
                    
                    if (!geminiRes.ok) throw new Error(`API 통신 에러 (${geminiRes.status})`);

                    const geminiJson = await geminiRes.json();
                    if (geminiJson.candidates && geminiJson.candidates.length > 0) {
                        let aiText = geminiJson.candidates[0].content.parts[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
                        const aiData = JSON.parse(aiText);
                        if (Array.isArray(aiData) && aiData.length > 0) { finalRows = aiData; aiSuccess = true; }
                        else throw new Error("AI 배열 파괴 오류");
                    } else throw new Error("AI 응답 없음");
                } catch (e) { 
                    console.error("Gemini 교정 에러:", e);
                    await sendTgMsg(chatId, `⚠️ AI 교정 실패 (기본 파싱 데이터로 안전하게 강제 진행합니다):\n${e.message}`);
                }

                let resultMsg = isTest ? `🧪 [테스트 모드 결과] DB 저장 안됨\n` : `✨ [DB 반영 완료]\n`;
                resultMsg += aiSuccess ? `(AI 스마트 교정 적용 / ${finalRows.length}행)\n` : `(정규식 기본 파싱 보존 / ${finalRows.length}행)\n`;
                finalRows.forEach(r => { resultMsg += `• ${r.bl} | ${r.pal}PAL | ${r.inDate || '미정'}\n`; });

                if (isTest) {
                    await sendTgMsg(chatId, resultMsg); return res.status(200).send('OK');
                }

                let updateCount = 0; let insertCount = 0;
                for (const r of finalRows) {
                    let bl = String(r.bl || '').replace(/[\s•·\-\*]/g, '');
                    let pal = parseInt(r.pal) || 0;
                    let inDate = r.inDate || null;
                    let fwd = r.fwd || '';
                    let sType = String(r.sType || '').toUpperCase();
                    let invoice = r.invoice || '';
                    let etc = r.etc || '';
                    let eta = r.eta || null;
                    let isAiVal = aiSuccess ? 1 : 0; 

                    let exist = [];
                    if (invoice) {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? LIMIT 1`, [invoice]);
                    }
                    if (exist.length === 0 && bl !== '발행전' && bl !== '') {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? LIMIT 1`, [bl]);
                    }

                    if (exist.length > 0) {
                        await pool.query(
                            `UPDATE inbound SET bl_number=?, pallets=?, receive_date=?, remarks=?, s_type=?, fwd=?, invoice=?, eta=?, is_ai_modified=? WHERE id=?`,
                            [bl, pal, inDate, etc, sType, fwd, invoice, eta, isAiVal, exist[0].id]
                        );
                        updateCount++;
                    } else {
                        await pool.query(
                            `INSERT INTO inbound (bl_number, pallets, receive_date, status, s_type, fwd, invoice, eta, remarks, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, ?, ?)`,
                            [bl, pal, inDate, sType, fwd, invoice, eta, etc, isAiVal]
                        );
                        insertCount++;
                    }
                }

                resultMsg += `\n(신규 ${insertCount}건 / 덮어쓰기 ${updateCount}건)`;
                await sendTgMsg(chatId, resultMsg);

                try {
                    const currentKeys = finalRows.map(r => String(r.bl || '').replace(/[\s•·\-\*]/g, ''));
                    const [pendingRowsInDb] = await pool.query(`SELECT bl_number, pallets, remarks FROM inbound WHERE status = '입고대기' OR receive_date IS NULL OR receive_date = '미정'`);

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
                } catch (orphanErr) { console.error("고아 데이터 감지 에러:", orphanErr); }

                if (!isReparse && targetUniqueId) {
                    await pool.query(`INSERT IGNORE INTO processed_images (unique_id) VALUES (?)`, [targetUniqueId]);
                }

                const currentTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
                const timeStr = `${currentTime.getMonth() + 1}월${currentTime.getDate()}일 ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
                const jsonUrl = JSON.stringify({ url: fullUrl });
                const jsonTime = JSON.stringify({ time: timeStr });
                
                // 🚨 [새로 추가된 핵심 1줄] 표(Table)로 그릴 데이터도 JSON으로 포장해서 DB에 저장!
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