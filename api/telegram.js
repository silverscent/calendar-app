require('dotenv').config();
const mysql = require('mysql2/promise');

// 🧠 [관리자님의 '스마트 적출 & 다이나믹 포커스 엔진' 100% 이식]
function parseOcrLines(text) { 
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const cleanBL = v => String(v).replace(/[\s•·\-\*]/g, '');
    const isBL = v => /^(DSV|BUD|S)\d{6,8}$/i.test(cleanBL(v)) || cleanBL(v) === '발행전'; 
    const isPal = v => /^\d{1,3}$/.test(v); 
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v); 
    const isSType = v => /^(AIR|SEA)$/i.test(v); 
    const isFwd = v => /^[A-Za-z]+$/.test(v) && !isSType(v); 
    const isInvoice = v => /^\d{7,8}$/.test(v); 

    const rows = []; 
    let orphanInvoices = [];
    let orphanEtc = [];
    let activeRowIndex = 0; 

    const tokens = [];
    for (let i = 0; i < lines.length; i++) {
        let raw = lines[i];
        if (/^(안녕하세요|B\/?L|PAL|ETA|3PL\s*입고|Fwd|S\.?Type|Invoice|ETC|Free time)/i.test(raw)) continue;
        
        if (!isBL(raw) && raw.includes(' ')) {
            const parts = raw.split(/\s+/);
            const strongTokens = parts.filter(p => isDate(p) || isSType(p) || isInvoice(p) || isBL(p));
            if (strongTokens.length > 0 && parts.length <= 5) { 
                tokens.push(...parts); 
                continue; 
            }
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
            if (isPal(raw)) {
                if (!rows[curr].pal) { rows[curr].pal = raw; activeRowIndex = curr; assigned = true; break; }
            } else if (isDate(raw)) {
                if (!rows[curr].eta) { rows[curr].eta = raw; activeRowIndex = curr; assigned = true; break; }
                else if (!rows[curr].inDate) { rows[curr].inDate = raw; activeRowIndex = curr; assigned = true; break; }
            } else if (isSType(raw)) {
                if (!rows[curr].sType) { rows[curr].sType = raw.toUpperCase(); activeRowIndex = curr; assigned = true; break; }
            } else if (isFwd(raw)) {
                if (!rows[curr].fwd) { rows[curr].fwd = raw; activeRowIndex = curr; assigned = true; break; }
            } else { break; }
            curr++;
        }

        if (!assigned) {
            if (isInvoice(raw)) {
                rows[activeRowIndex].invoices.push(raw);
            } else if (!isPal(raw) && !isDate(raw) && !isSType(raw) && !isFwd(raw)) {
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

// 🚀 [Vercel 메인 API 라우터]
export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    try {
        const body = req.body;
        const message = body?.message;
        if (!message) return res.status(200).send('OK'); 

        const chatId = message.chat.id;
        
        // 🔥 [패치] 일반 사진(photo)과 고해상도 원본 파일(document) 모두 낚아채기
        let fileId = null;
        if (message.photo && message.photo.length > 0) {
            fileId = message.photo[message.photo.length - 1].file_id;
        } else if (message.document && message.document.mime_type && message.document.mime_type.startsWith('image/')) {
            fileId = message.document.file_id;
        }

        // 사진이나 이미지 파일이 아니면 쿨하게 무시
        if (!fileId) return res.status(200).send('OK'); 

        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const visionApiKey = process.env.GOOGLE_VISION_API_KEY;

        console.log(`\n📸 [1/5] 사진 수신 완료`);

        // 1. 텔레그램 사진 다운로드 & Base64 인코딩
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`);
        const imgBuffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(imgBuffer).toString('base64');

        console.log(`🔍 [2/5] Google Vision API 판독 중...`);

        // 2. 구글 비전 API 호출 (단순 API KEY 방식)
        const visionRes = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{ image: { content: base64Image }, features: [{ type: 'TEXT_DETECTION' }] }]
            })
        });
        const visionData = await visionRes.json();
        const extractedText = visionData.responses[0]?.fullTextAnnotation?.text || "";

        if (!extractedText) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: "⚠ 이미지에서 텍스트를 찾을 수 없습니다." })
            });
            return res.status(200).send('OK');
        }

        console.log(`📄 [3/5] OCR 완료. 관리자 파싱 엔진 가동!`);

        // 3. 관리자님의 파싱 엔진 적용
        const parsedRows = parseOcrLines(extractedText);
        if (parsedRows.length === 0) return res.status(200).send('OK');

        console.log(`💾 [4/5] 파싱 성공 (${parsedRows.length}행). TiDB 저장 시도...`);

       // 4. TiDB 저장 (DB 연결 및 쿼리 실행)
        const pool = mysql.createPool(process.env.DATABASE_URL);
        
        try {
            const imageUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
            const currentTime = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            
            await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [imageUrl, imageUrl]);
            await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [currentTime, currentTime]);
        } catch (dbErr) {
            console.error("🔥 OCR 이미지/시간 DB 저장 실패:", dbErr);
        }

        let resultMsg = `✨ V2 엔진 자동 파싱 완료 (${parsedRows.length}행)\n`;
        
        for (const r of parsedRows) {
            let finalBL = r.bl;
            let isPreIssue = (finalBL === '발행전');
            
            // 발행전일 경우, 덮어쓰기 증발을 막기 위해 인보이스를 붙임
            if (isPreIssue) {
                finalBL = r.invoice ? `발행전_${r.invoice}` : `발행전_${Date.now()}`;
            }

            let dbDate = r.inDate ? r.inDate : null;
            let dbEta = r.eta ? r.eta : null;

            let exist = [];
            
            // 🚨 [추적 1순위] 인보이스 + 날짜로 찾기 (가장 정확함)
            if (r.invoice) {
                [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? AND receive_date <=> ? LIMIT 1`, [r.invoice, dbDate]);
            }
            
            // 🚨 [추적 2순위] B/L번호 + 날짜로 찾기
            if (exist.length === 0) {
                [exist] = await pool.query(`SELECT id FROM inbound WHERE bl_number = ? AND receive_date <=> ? LIMIT 1`, [finalBL, dbDate]);
            }
            
            // 🚨 [추적 3순위: 구버전 호환] 지금 들어온 게 '발행전'인데 못 찾았다면?
            // -> 과거에 이름표 없이 덜렁 '발행전'으로만 등록된 고아 데이터를 찾아냅니다!
            if (exist.length === 0 && isPreIssue) {
                [exist] = await pool.query(`SELECT id FROM inbound WHERE bl_number = '발행전' AND receive_date <=> ? LIMIT 1`, [dbDate]);
            }

            if (exist.length > 0) {
                // 🎯 덮어쓰기 (거슬리던 AI 뱃지 로직 완벽 삭제!)
                // 기존에 '발행전'이었던 이름도 '발행전_INV123'으로 깔끔하게 업데이트 됩니다.
                await pool.query(
                    `UPDATE inbound SET bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, eta=? WHERE id=?`,
                    [finalBL, r.pal, r.etc, r.sType, r.fwd, r.invoice, dbEta, exist[0].id]
                );
            } else {
                // 🎯 신규 생성 (여기서도 AI 뱃지 삭제!)
                await pool.query(
                    `INSERT INTO inbound (bl_number, pallets, receive_date, status, s_type, fwd, invoice, eta, remarks) 
                     VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, ?)`,
                    [finalBL, r.pal, dbDate, r.sType, r.fwd, r.invoice, dbEta, r.etc]
                );
            }
            
            resultMsg += `• ${finalBL} | ${r.pal}PAL | ${r.inDate||'미정'}\n`;
        }

        console.log(`✅ [5/5] TiDB 저장 완료! 텔레그램 알림 전송`);

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: resultMsg })
        });

        res.status(200).send('OK');

    } catch (error) {
        console.error("❌ 시스템 처리 중 치명적 에러:", error);
        
        try {
            if (req.body?.message?.chat?.id) {
                await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: req.body.message.chat.id, text: `🔥 서버 에러 발생! 원인:\n${error.message}` })
                });
            }
        } catch(e) {} 

        res.status(500).send('Server Error');
    }
}