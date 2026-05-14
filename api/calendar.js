require('dotenv').config();
const mysql = require('mysql2/promise');

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pool = mysql.createPool(process.env.DATABASE_URL);

        if (req.method === 'GET') {
            const { type, year, month, action } = req.query;

            // 🚨 [초고속 튜닝 1] 연간 통계 구간 검색 적용 (YEAR 함수 제거)
            if (action === 'yearlyStats') {
                let rows = [];
                const startYear = `${year}-01-01`;
                const endYear = `${parseInt(year) + 1}-01-01`;

                if (type === 'out') {
                    [rows] = await pool.query(`SELECT outbound_date, pal, box, etc, company, isDone FROM outbound WHERE outbound_date >= ? AND outbound_date < ?`, [startYear, endYear]);
                } else {
                    [rows] = await pool.query(`SELECT receive_date, pallets, s_type, remarks, bl_number FROM inbound WHERE receive_date >= ? AND receive_date < ?`, [startYear, endYear]);
                }

                let monthly = Array.from({length: 12}, () => ({ pal: 0, box: 0, details: {} }));
                let compStats = {};

                rows.forEach(r => {
                    let dateVal = type === 'out' ? r.outbound_date : r.receive_date;
                    if (!dateVal) return;
                    let d = new Date(dateVal);
                    let mIdx = d.getMonth(); 
                    
                    if (type === 'out') {
                        let name = r.company;
                        let cleanName = (name || "").replace(/\[TASK\]/gi, "").trim();
                        let isTask = (name || "").toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(cleanName);
                        if (!isTask) {
                            let p = parseInt(r.pal) || 0; let b = parseInt(r.box) || 0;
                            monthly[mIdx].pal += p; monthly[mIdx].box += b;
                            if (!monthly[mIdx].details[cleanName]) monthly[mIdx].details[cleanName] = { pal: 0, box: 0 };
                            monthly[mIdx].details[cleanName].pal += p; monthly[mIdx].details[cleanName].box += b;
                            if (!compStats[cleanName]) compStats[cleanName] = { pal: 0, box: 0 };
                            compStats[cleanName].pal += p; compStats[cleanName].box += b;
                        }
                    } else {
                        let p = parseInt(r.pallets) || 0;
                        monthly[mIdx].pal += p;
                        let sLabel = r.s_type === 'AIR' ? '✈️ 항공 (AIR)' : '🚢 해상 (SEA)';
                        
                        if (!monthly[mIdx].details[sLabel]) monthly[mIdx].details[sLabel] = { pal: 0, box: 0 };
                        monthly[mIdx].details[sLabel].pal += p;
                        
                        if (!compStats[sLabel]) compStats[sLabel] = { pal: 0, box: 0 };
                        compStats[sLabel].pal += p;
                    }
                });
                return res.status(200).json({ success: true, year: parseInt(year), monthly: monthly, comp: compStats });
            }

            let formattedData = { year: parseInt(year), month: parseInt(month), monthData: {}, pendingItems: [] };

            // 🚨 [초고속 튜닝 2] 월간 달력 데이터 구간 검색 적용 (MONTH 함수 제거)
            const m = parseInt(month);
            const y = parseInt(year);
            const startYmd = `${y}-${String(m).padStart(2, '0')}-01`;
            const endYmd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

            if (type === 'out') {
                const [monthRows] = await pool.query(`SELECT * FROM outbound WHERE outbound_date >= ? AND outbound_date < ? ORDER BY sort_idx ASC, id ASC`, [startYmd, endYmd]);
                const [pendingRows] = await pool.query(`SELECT * FROM outbound WHERE outbound_date IS NULL ORDER BY sort_idx ASC, id ASC`);
                monthRows.forEach(row => {
                    const day = new Date(row.outbound_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ id: row.id, company: row.company, pal: row.pal, box: row.box, etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
                });
                pendingRows.forEach(row => { formattedData.pendingItems.push({ id: row.id, company: row.company, pal: row.pal, box: row.box, etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 }); });
            } else {
                const [monthRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date >= ? AND receive_date < ? ORDER BY sort_idx ASC, id ASC`, [startYmd, endYmd]);
                const [pendingRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`);
                monthRows.forEach(row => {
                    const day = new Date(row.receive_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, isDone: row.status === '완료', isAi: row.is_ai_modified === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
                });
                pendingRows.forEach(row => { formattedData.pendingItems.push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, isDone: row.status === '완료', isAi: row.is_ai_modified === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 }); });
            }
            return res.status(200).json(formattedData);
        }

        if (req.method === 'POST') {
    const body = req.body;
    const payload = typeof body === 'string' ? JSON.parse(body) : body; 
    const { domain, action, data, token, compName, colorIdx, year } = payload;

    // ✅ 1. 이 줄이 무조건 가장 먼저 있어야 합니다! (기존 로직이 쓰는 함수)
    const parseJSON = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return val; } };

    // ✅ 2. 그 다음이 바로 로그인 로직입니다.
    if (action === 'LOGIN') {
        try {
            const { id, pw } = data; 
            
            // DB 조회
            const [rows] = await pool.query(
                "SELECT admin_id, password_hash, admin_name, role FROM admins WHERE admin_id = ? AND status = 'ACTIVE'",
                [id]
            );

            // 임시 평문 비교
            if (rows.length === 0 || rows[0].password_hash !== pw) {
                return res.status(200).json({ success: false, msg: '아이디 또는 비밀번호가 틀립니다.' });
            }

            const user = rows[0];

            // 로그인 기록
            await pool.query(
                "INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'LOGIN', '시스템 관리자 로그인 성공')",
                [user.admin_id]
            );

            return res.status(200).json({ 
                success: true, 
                admin_id: user.admin_id, 
                role: user.role, 
                name: user.admin_name 
            });

        } catch (error) {
            console.error("로그인 에러:", error);
            // 에러 발생 시 프론트로 메시지 전달
            return res.status(200).json({ success: false, msg: '로그인 처리 중 서버 오류가 발생했습니다.' });
        }
    }

    // ... (이 아래부터는 기존 입/출고 업데이트 등 본섭 로직 유지) ...

    // --- 기존 로직 그대로 유지 ---
    const parseJSON = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return val; } };
    // ... (이하 입출고 업데이트, 삭제 로직 등) ...
}

        // ====================================================================
        // 🚨 [OCR 전용 하이패스] 이중 포장 파쇄기 + 텔레그램 이미지 실시간 심폐소생!
        // ====================================================================
        if (action === 'getLastOcrImageUrl' || action === 'GET_LAST_OCR_IMAGE') {
            try {
                await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);
                let finalUrl = "";
                let fileId = null;

                if (rows.length > 0) {
                    let val = rows[0].setting_value;
                    
                    // 1단계: 글씨면 일단 JSON 상자인지 확인하고 까버림
                    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
                    
                    // 2단계: 까봤더니 상자(Object)면 그 안의 알맹이(.url)와 고유번호(.fileId)를 쏙 빼옴
                    if (typeof val === 'object' && val !== null) { 
                        finalUrl = val.url || ""; 
                        fileId = val.fileId || null;
                    }
                    // 3단계: 애초에 그냥 생짜 글씨였으면 그대로 씀
                    else if (typeof val === 'string') { finalUrl = val; }

                    // 🚨 4단계 [핵심 심폐소생]: fileId가 있으면 텔레그램 서버에 1시간짜리 싱싱한 새 주소를 발급받음!
                    if (fileId) {
                        try {
                            const botToken = process.env.TELEGRAM_BOT_TOKEN;
                            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
                            const fileData = await fileRes.json();
                            
                            if (fileData.ok) {
                                // 싱싱한 새 주소로 덮어쓰기
                                finalUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                                
                                // (선택) 다음 번 호출 속도를 위해 갱신된 주소를 DB에도 조용히 업데이트
                                if (typeof val === 'object') {
                                    val.url = finalUrl;
                                    await pool.query(`UPDATE system_settings SET setting_value = ? WHERE setting_key = 'last_ocr_image'`, [JSON.stringify(val)]);
                                }
                            }
                        } catch(apiErr) {
                            console.error("🔥 텔레그램 새 이미지 주소 발급 실패:", apiErr);
                        }
                    }
                }
                
                // 프론트엔드가 헷갈리지 않게 깔끔하게 전달
                return res.status(200).json({ url: finalUrl, success: true });
            } catch(e) {
                console.error("🔥 OCR 이미지 로딩 에러:", e);
                return res.status(200).json({ url: "", success: false });
            }
        }

        if (action === 'getOcrLastTimeStr' || action === 'GET_OCR_LAST_TIME') {
            try {
                await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_time'`);
                let finalTime = "최근 처리내역 없음";
                if (rows.length > 0) {
                    let val = rows[0].setting_value;
                    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
                    
                    if (typeof val === 'object' && val !== null) { finalTime = val.time || "최근 처리내역 없음"; }
                    else if (typeof val === 'string') { finalTime = val; }
                }
                return res.status(200).json({ time: finalTime, success: true });
            } catch(e) {
                return res.status(200).json({ time: "최근 처리내역 없음", success: false });
            }
        }
        // ====================================================================

            // 🚨 [여기에 추가!] 텔레그램 봇이 던져주는 OCR 이미지와 시간을 DB에 저장하는 통로!
            if (action === 'SAVE_OCR_INFO') {
                const urlVal = data?.url || '';
                const timeVal = data?.time || '';
                
                // system_settings 테이블이 없을 수도 있으니 안전하게 생성부터 합니다.
                await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
                
                // 데이터 덮어쓰기 저장!
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [urlVal, urlVal]);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [timeVal, timeVal]);
                
                return res.status(200).json({ success: true });
            }
            // 🚨 [여기에 딱 추가!] 검수용 데이터 요청 처리
            if (action === 'GET_LAST_OCR_DATA') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'LAST_OCR_DATA'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : []);
            }

            if (action === 'GET_COMP_INFO_DB') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            if (action === 'SAVE_COMP_INFO_DB') { const jsonStr = JSON.stringify(data); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            if (action === 'GET_GLOBAL_COLORS') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            if (action === 'SAVE_GLOBAL_COLOR') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {}; colors[compName] = colorIdx; const jsonStr = JSON.stringify(colors); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('GLOBAL_COMPANY_COLORS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            
// [calendar.js] 공휴일 정보 
if (action === 'GET_YEARLY_HOLIDAYS') {
    const y = year || new Date().getFullYear();
    const apiKey = process.env.HOLIDAY_API_KEY;
    if (apiKey) {
        try {
            const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${y}&ServiceKey=${apiKey}&_type=json&numOfRows=100`;
            const response = await fetch(url);
            const json = await response.json();
            if (json?.response?.body?.items?.item) {
                const items = Array.isArray(json.response.body.items.item) ? json.response.body.items.item : [json.response.body.items.item];
                
                return res.status(200).json(items.map(h => {
                    const d = String(h.locdate);
                    let holidayName = h.dateName || "";
                    
                    // 🚨 [핵심 추가] '대체공휴일' 글자가 포함되어 있으면 '대체'로 줄임
                    if (holidayName.includes("대체공휴일")) {
                        holidayName = holidayName.replace("대체공휴일", "대체");
                    }

                    return {
                        date: `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`,
                        name: holidayName 
                    };
                }));
            }
        } catch (e) { console.error("🔥 공휴일 API 에러:", e); }
    }
    // API 실패 시 기본 공휴일도 형식 통일
    const baseHolidays = [
        {date:`${y}-01-01`, name:"신정"}, {date:`${y}-03-01`, name:"삼일절"}, {date:`${y}-05-05`, name:"어린이날"},
        {date:`${y}-06-06`, name:"현충일"}, {date:`${y}-08-15`, name:"광복절"}, {date:`${y}-10-03`, name:"개천절"},
        {date:`${y}-10-09`, name:"한글날"}, {date:`${y}-12-25`, name:"성탄절"}
    ];
    return res.status(200).json(baseHolidays);
}

            if (domain === 'out') {
    const targetName = data?.oldComp;
    const newName = data?.newComp || targetName;
    const targetDate = data?.oldDate === '미정' ? null : data?.oldDate;
    const newDate = data?.newDate === '미정' ? null : data?.newDate;
    const targetPal = data?.oldPal || '';
    const targetBox = data?.oldBox || '';

    if (action === 'DONE' || action === 'UNDO_DONE') {
        await pool.query(
            `UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
            [action === 'DONE' ? 1 : 0, targetName, targetDate, targetPal, targetBox]
        );
    } 
    else if (action === 'DELETE') {
        await pool.query(
            `DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
            [targetName, targetDate, targetPal, targetBox]
        );
    } 
    else if (action === 'EDIT') {
        await pool.query(
            `UPDATE outbound SET outbound_date = ?, company = ?, pal = ?, box = ?, etc = ? 
             WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
            [newDate, newName, data?.newPal || '', data?.newBox || '', data?.newEtc || '', targetName, targetDate, targetPal, targetBox]
        );
    } else if (action === 'ADD') { 
                    // 🚨 [출고 중복 방지] 봇 방언(bl, comp, date) 완벽 호환 엔진
                    let reqComp = (data?.newComp || data?.company || data?.comp || '').trim();
                    let reqDateOut = data?.newDate !== undefined ? data?.newDate : (data?.date !== undefined ? data?.date : data?.outbound_date);
                    if (reqDateOut === '미정' || reqDateOut === '' || !reqDateOut) reqDateOut = null;
                    else if (typeof reqDateOut === 'string' && reqDateOut.length > 10) reqDateOut = reqDateOut.substring(0, 10);
                    
                    let reqPalOut = data?.newPal || data?.pal || '';
                    let reqBoxOut = data?.newBox || data?.box || '';
                    let reqEtcOut = data?.newEtc || data?.etc || '';

                    const [exist] = await pool.query(`SELECT id FROM outbound WHERE TRIM(company) = ? AND outbound_date <=> ?`, [reqComp, reqDateOut]);
                    if (exist.length > 0) {
                        // 중복이면 무조건 기존 스케줄에 덮어쓰기!
                        await pool.query(`UPDATE outbound SET pal = ?, box = ?, etc = ? WHERE id = ?`, [reqPalOut, reqBoxOut, reqEtcOut, exist[0].id]);
                    } else {
                        // 없으면 신규 생성
                        await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`, [reqComp, reqPalOut, reqBoxOut, reqDateOut, reqEtcOut]); 
                    }
                }
    else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
        for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
            let tDate = dateStr === '미정' ? null : dateStr;
            for (const item of orderList) {
                if (item.id) {
                    await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                } else {
                    await pool.query(
                        `UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [item.sortIdx, item.company, tDate, item.pal, item.box]
                    );
                }
            }
        }
    } 
    else if (action === 'MULTI_DELETE' && data?.items) {
        for (const it of data.items) {
            const tDate = it.dateStr === '미정' ? null : it.dateStr;
            await pool.query(
                `DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                [it.comp, tDate, it.pal, it.box]
            );
        }
    } 
    else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
        const isDoneVal = action === 'MULTI_DONE' ? 1 : 0;
        for (const it of data.items) {
            const tDate = it.dateStr === '미정' ? null : it.dateStr;
            await pool.query(
                `UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                [isDoneVal, it.comp, tDate, it.pal, it.box]
            );
        }
    }
}
            else {
                // 🚢 [8, 9번 해결] 입고 다중선택/수정 시 ID 최우선으로 매핑!
                const newName = data?.newComp || data?.newBL;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    const statusVal = action === 'DONE' ? '완료' : '입고대기';
                    if (data?.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, data.id]);
                    else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                } else if (action === 'DELETE') {
                    if (data?.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [data.id]);
                    else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                } else if (action === 'EDIT') {
                    if (data?.id) {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE id=?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data.id]);
                    } else {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE bl_number=? AND receive_date<=>?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    }
                } else if (action === 'ADD') {
                    // 🚨 [입고 중복 방지] 봇 방언 호환 및 인보이스(발행전) 덮어쓰기 엔진
                    let reqBl = (data?.newBL || data?.bl || data?.newComp || data?.company || data?.bl_number || '').trim();
                    let reqDate = data?.newDate !== undefined ? data?.newDate : (data?.date !== undefined ? data?.date : data?.receive_date);
                    if (reqDate === '미정' || reqDate === '' || !reqDate) reqDate = null;
                    else if (typeof reqDate === 'string' && reqDate.length > 10) reqDate = reqDate.substring(0, 10);
                    
                    let reqInvoice = (data?.newInvoice || data?.invoice || '').trim();
                    let reqPal = data?.newPal || data?.pal || data?.pallets || '';
                    let reqSType = data?.newSType || data?.sType || data?.s_type || '';
                    let reqFwd = data?.newFwd || data?.fwd || '';
                    let reqEtc = data?.newEtc || data?.etc || data?.remarks || '';

                    let exist = [];
                    // 1순위: 인보이스 번호 + 날짜로 기존 데이터 찾기 (발행전 이름 바뀌는 것 대응)
                    if (reqInvoice !== '') {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? AND receive_date <=> ?`, [reqInvoice, reqDate]);
                    }
                    // 2순위: 인보이스가 없으면 B/L 번호 + 날짜로 찾기
                    if (exist.length === 0 && reqBl !== '') {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? AND receive_date <=> ?`, [reqBl, reqDate]);
                    }

                    if (exist.length > 0) {
                        // 중복이면 무조건 기존 스케줄 최신화 + AI 뱃지 ON!
                        await pool.query(`UPDATE inbound SET bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, is_ai_modified=1 WHERE id=?`, 
                            [reqBl, reqPal, reqEtc, reqSType, reqFwd, reqInvoice, exist[0].id]);
                    } else {
                        // 아예 새로운 데이터면 신규 생성
                        await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, 1)`, 
                            [reqBl, reqPal, reqDate, reqEtc, reqSType, reqFwd, reqInvoice]);
                    }
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`, [item.sortIdx, item.company, tDate, item.pal]);
                        }
                    }
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        if (it.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [it.id]);
                        else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const statusVal = action === 'MULTI_DONE' ? '완료' : '입고대기';
                    for (const it of data.items) {
                        if (it.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, it.id]);
                        else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                }
            }
            return res.status(200).json({ success: true, msg: '작업 완료' });
        }
    } catch (error) {
        console.error("🔥 API 에러:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};