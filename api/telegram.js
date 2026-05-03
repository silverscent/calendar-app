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
        if (!body?.message?.photo) return res.status(200).send('OK'); 

        const chatId = body.message.chat.id;
        const photo = body.message.photo[body.message.photo.length - 1];
        
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const visionApiKey = process.env.GOOGLE_VISION_API_KEY;

        console.log(`\n📸 [1/5] 사진 수신 완료`);

        // 1. 텔레그램 사진 다운로드 & Base64 인코딩
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`);
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
        
        let resultMsg = `✨ V2 엔진 자동 파싱 완료 (${parsedRows.length}행)\n`;
        
        for (const r of parsedRows) {
            // TiDB 구조에 맞게 기타 정보(Type, FWD, Invoice 등)를 예쁘게 압축
            let remarksStr = `[Type: ${r.sType||'-'}] [FWD: ${r.fwd||'-'}] [Inv: ${r.invoice||'-'}] [ETA: ${r.eta||'-'}] ${r.etc}`.trim();
            let dbDate = r.inDate ? r.inDate : null;

            await pool.query(
                `INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks) VALUES (?, ?, ?, '입고대기', ?)`,
                [r.bl, r.pal, dbDate, remarksStr]
            );
            
            resultMsg += `• ${r.bl} | ${r.pal}PAL | ${r.inDate||'미정'}\n`;
        }

        console.log(`✅ [5/5] TiDB 저장 완료! 텔레그램 알림 전송`);

        // 5. 완료 알림
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: resultMsg })
        });

        res.status(200).send('OK');

    } catch (error) {
        console.error("❌ 시스템 처리 중 치명적 에러:", error);
        res.status(500).send('Server Error');
    }
}