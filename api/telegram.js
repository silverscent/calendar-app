require('dotenv').config();
const mysql = require('mysql2/promise');

// 텔레그램 메시지 전송 헬퍼 함수
async function sendTgMsg(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text })
        });
    } catch(e) { console.error("텔레그램 전송 에러:", e); }
}

export default async function handler(req, res) {
    if (req.method !== 'POST' || !req.body.message) {
        return res.status(200).send('OK');
    }

    const message = req.body.message;
    const chatId = message.chat.id;
    const text = message.text || '';
    const pool = mysql.createPool(process.env.DATABASE_URL);

    try {
        // 시스템 설정 테이블 안전 보장
        await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);

        // =================================================================
        // 1. 관리자 헬프 및 상태 명령어 (/? , /help, /status)
        // =================================================================
        if (text.startsWith('/?') || text.startsWith('/help') || text.startsWith('/도움')) {
            const helpMsg = `📘 [3PL 시스템 봇 매뉴얼]\n\n📸 이미지 처리\n[사진 전송] : OCR 대기열에 등록\n/ocr : 대기열 사진 DB 자동 등록\n/test : AI 교정 결과 텍스트 확인\n/cancel : 대기열 사진 취소\n\n⚙️ 시스템 관리\n/? : 도움말\n/status : 봇 & DB 상태 확인\n\n※ 입출고 수동 처리는 [웹앱 달력]을 이용해 주세요.`;
            await sendTgMsg(chatId, helpMsg);
            return res.status(200).send('OK');
        }

        if (text.startsWith('/status')) {
            let dbStatus = "🔴 연결 실패";
            try { await pool.query('SELECT 1'); dbStatus = "🟢 정상 연결됨"; } catch(e) {}
            const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_ID'`);
            let queueStatus = rows.length > 0 ? "🟡 1장 대기 중" : "⚪ 대기열 비어있음";
            await sendTgMsg(chatId, `📊 [시스템 상태 보고]\n\nTiDB 데이터: ${dbStatus}\nOCR 대기열: ${queueStatus}\nAI 엔진: Gemini 2.5 Flash 🟢`);
            return res.status(200).send('OK');
        }

        // =================================================================
        // 2. 이미지 수신 -> 대기열(Queue) 등록
        // =================================================================
        let fileId = null;
        if (message.photo && message.photo.length > 0) {
            fileId = message.photo[message.photo.length - 1].file_id;
        } else if (message.document && message.document.mime_type && message.document.mime_type.startsWith('image/')) {
            fileId = message.document.file_id;
        }

        if (fileId) {
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('PENDING_IMAGE_ID', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [fileId, fileId]);
            await sendTgMsg(chatId, `📥 [이미지 대기열 등록 완료]\n\n▶️ DB에 즉시 반영: /ocr\n🧪 AI 결과 미리보기: /test\n❌ 처리 취소: /cancel`);
            return res.status(200).send('OK');
        }

        // =================================================================
        // 3. 대기열 취소 (/cancel)
        // =================================================================
        if (text.startsWith('/cancel')) {
            await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_ID'`);
            await sendTgMsg(chatId, `🗑️ 대기열 이미지가 취소되었습니다.`);
            return res.status(200).send('OK');
        }

        // =================================================================
        // 4. 핵심 OCR + Gemini AI 파이프라인 실행 (/ocr 또는 /test)
        // =================================================================
        if (text.startsWith('/ocr') || text.startsWith('/test')) {
            const isTest = text.startsWith('/test');
            
            // 1) 대기열에서 파일 가져오기
            const [pendingRows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'PENDING_IMAGE_ID'`);
            if (pendingRows.length === 0 || !pendingRows[0].setting_value) {
                await sendTgMsg(chatId, `⚠️ 대기 중인 이미지가 없습니다. 사진을 먼저 올려주세요.`);
                return res.status(200).send('OK');
            }
            const targetFileId = pendingRows[0].setting_value;

            // 실행 시 대기열 즉시 비우기 (연타 방지)
            if (!isTest) await pool.query(`DELETE FROM system_settings WHERE setting_key = 'PENDING_IMAGE_ID'`);
            await sendTgMsg(chatId, `🔄 이미지 다운로드 및 판독을 시작합니다...`);

            // 2) 텔레그램에서 사진 다운로드 & Base64 인코딩
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${targetFileId}`);
            const fileData = await fileRes.json();
            const fullUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;

            const imgRes = await fetch(fullUrl);
            const imgBuffer = await imgRes.arrayBuffer();
            const base64Image = Buffer.from(imgBuffer).toString('base64');

            // 3) 구글 Vision API 호출 (🚨 관리자님 기존 변수명 GOOGLE_VISION_API_KEY 로 복구 완료!)
            const visionApiKey = process.env.GOOGLE_VISION_API_KEY;
            const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requests: [{ image: { content: base64Image }, features: [{ type: 'TEXT_DETECTION' }] }] })
            });
            const visionData = await visionRes.json();
            const extractedText = visionData.responses[0]?.fullTextAnnotation?.text || "";

            if (!extractedText) {
                await sendTgMsg(chatId, `⚠ 이미지에서 텍스트를 찾을 수 없습니다.`);
                return res.status(200).send('OK');
            }

            // 4) 관리자님의 자체 정규식 파싱 적용
            const parsedResult = parseOcrLinesLocal(extractedText);
            if (parsedResult.length === 0) {
                await sendTgMsg(chatId, `⚠ 인식된 데이터가 없습니다.`);
                return res.status(200).send('OK');
            }

            await sendTgMsg(chatId, `🤖 Gemini AI가 데이터의 문맥을 분석하고 교정 중입니다...`);

            // 5) Gemini AI 자동 교정 적용
            let finalRows = parsedResult;
            let aiSuccess = false;
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
                const geminiJson = await geminiRes.json();
                
                if (geminiJson.candidates && geminiJson.candidates.length > 0) {
                    let aiText = geminiJson.candidates[0].content.parts[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const aiData = JSON.parse(aiText);
                    if (Array.isArray(aiData) && aiData.length > 0) {
                        finalRows = aiData;
                        aiSuccess = true;
                    }
                }
            } catch (e) { console.error("Gemini 교정 에러:", e); }

            // 6) 결과 메시지 출력
            let resultMsg = isTest ? `🧪 [테스트 모드 결과] DB 저장 안됨\n` : `✨ [DB 반영 완료]\n`;
            resultMsg += aiSuccess ? `(AI 스마트 교정 적용 / ${finalRows.length}행)\n` : `(AI 지연: 정규식 기본 파싱 / ${finalRows.length}행)\n`;
            finalRows.forEach(r => { resultMsg += `• ${r.bl} | ${r.pal}PAL | ${r.inDate || '미정'}\n`; });

            if (isTest) {
                await sendTgMsg(chatId, resultMsg);
                return res.status(200).send('OK');
            }

            // 7) DB에 UPSERT (is_ai_modified 플래그 포함, 검색 로직 100% 유지)
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
                let isAiVal = aiSuccess ? 1 : 0; // AI 교정 여부

                let exist = [];
                // 인보이스가 있으면 우선 검색
                if (invoice) {
                    [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? AND receive_date <=> ? LIMIT 1`, [invoice, inDate]);
                }
                // 인보이스가 없고 B/L이 발행전이 아니면 검색
                if (exist.length === 0 && bl !== '발행전' && bl !== '') {
                    [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? AND receive_date <=> ? LIMIT 1`, [bl, inDate]);
                }

                if (exist.length > 0) {
                    await pool.query(
                        `UPDATE inbound SET bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, eta=?, is_ai_modified=? WHERE id=?`,
                        [bl, pal, etc, sType, fwd, invoice, eta, isAiVal, exist[0].id]
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

            // 8) 웹 달력용 최신 이미지 주소 저장
            const currentTime = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
            const timeStr = `${currentTime.getMonth() + 1}월${currentTime.getDate()}일 ${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
            const jsonUrl = JSON.stringify({ url: fullUrl });
            const jsonTime = JSON.stringify({ time: timeStr });
            
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonUrl, jsonUrl]);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonTime, jsonTime]);
            
            return res.status(200).send('OK');
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