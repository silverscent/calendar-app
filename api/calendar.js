require('dotenv').config();
const mysql = require('mysql2/promise');

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pool = mysql.createPool(process.env.DATABASE_URL);

        // ✅ 공통 함수는 안전하게 상단에 한 번만 선언
        const parseJSON = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return val; } };
        // 🚨 [신규 안전망] DB 다이렉트 수정 시 빈칸("")이 들어오면 MySQL 에러가 나지 않도록 NULL로 변환
        const safeDate = (v) => (!v || v === '' || v === 'null' || v === '미정') ? null : v;

        if (req.method === 'GET') {
            const { type, year, month, action } = req.query;

            // 🚨 [초고속 튜닝 1] 연간 통계
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

            // 🚨 [초고속 튜닝 2] 월간 달력 데이터
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

        // ====================================================================
        // 🛡️ [시스템 관리] 마스터 전용 백엔드 파이프라인 및 순정 캘린더 기능
        // ====================================================================
        if (req.method === 'POST') {
            const body = req.body;
            const payload = typeof body === 'string' ? JSON.parse(body) : body;
            
            // 🚨 변수 구조 분해
            const { domain, action, data, keyword, type, rowId, year, month, id, admin_id } = payload;
            const currentAdmin = admin_id || 'system';

            // 🆕 A. 신규 관리자 계정 추가
            if (action === 'CREATE_ADMIN') {
                try {
                    const { id, name, pw } = data;
                    const [exist] = await pool.query("SELECT admin_id FROM admins WHERE admin_id = ?", [id]);
                    if (exist.length > 0) return res.status(200).json({ success: false, msg: '이미 등록된 아이디입니다.' });
                    await pool.query("INSERT INTO admins (admin_id, password_hash, admin_name, role, status) VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')", [id, pw, name]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CREATE_ADMIN', ?)", [currentAdmin, `새로운 관리자 계정 발급: ${name}(${id})`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 👥 B. 관리자 목록 조회
            else if (action === 'GET_ADMIN_LIST') {
                try {
                    const [rows] = await pool.query("SELECT admin_id, admin_name, role FROM admins WHERE status = 'ACTIVE' ORDER BY id ASC");
                    return res.status(200).json({ success: true, list: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🗑️ C. 관리자 계정 삭제 (권한 회수)
            else if (action === 'DELETE_ADMIN') {
                try {
                    const { id } = data;
                    if (id === 'admin' || id === 'silverscent') return res.status(200).json({ success: false, msg: '마스터 계정은 보안상 복구가 불가능하여 파기할 수 없습니다.' });
                    await pool.query("UPDATE admins SET status = 'DELETED' WHERE admin_id = ?", [id]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DELETE_ADMIN', ?)", [currentAdmin, `관리자 계정 차단 및 삭제: ${id}`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🔑 관리자 비밀번호 강제 초기화
            else if (action === 'RESET_ADMIN_PW') {
                try {
                    const { targetId, newPw } = data;
                    await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [newPw, targetId]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'RESET_PW', ?)", [currentAdmin, `[${targetId}] 관리자 비밀번호 초기화 완료`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 📜 D. 보안 감사 로그 타임라인 로드
            else if (action === 'GET_AUDIT_LOGS') {
                try {
                    const [rows] = await pool.query("SELECT admin_id, action_type, description, created_at FROM admin_audit_logs ORDER BY id DESC LIMIT 50");
                    return res.status(200).json({ success: true, logs: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🗄️ E. DB 다이렉트 조회 (입고/출고 전체 컬럼 로드 및 필터)
            else if (action === 'GET_RAW_DB_ROWS') {
                try {
                    let rows = [];
                    const filterCol = payload.filterCol || 'all'; 
                    let queryStr = "";
                    let params = [];

                    if (type === 'out') {
                        queryStr = "SELECT id, company, pal, box, outbound_date, etc, created_at, sort_idx, isDone FROM outbound";
                        if (keyword && filterCol === 'name') { queryStr += " WHERE company LIKE ?"; params.push(`%${keyword}%`); }
                        else if (keyword && filterCol === 'date') { queryStr += " WHERE outbound_date LIKE ?"; params.push(`%${keyword}%`); }
                        else if (keyword) { queryStr += " WHERE company LIKE ? OR outbound_date LIKE ?"; params.push(`%${keyword}%`, `%${keyword}%`); }
                        queryStr += " ORDER BY id DESC LIMIT 50";
                    } else {
                        queryStr = "SELECT id, bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, last_updated, sort_idx, status, is_ai_modified FROM inbound";
                        if (keyword && filterCol === 'name') { queryStr += " WHERE bl_number LIKE ?"; params.push(`%${keyword}%`); }
                        else if (keyword && filterCol === 'date') { queryStr += " WHERE receive_date LIKE ?"; params.push(`%${keyword}%`); }
                        else if (keyword) { queryStr += " WHERE bl_number LIKE ? OR receive_date LIKE ?"; params.push(`%${keyword}%`, `%${keyword}%`); }
                        queryStr += " ORDER BY id DESC LIMIT 50";
                    }
                    
                    [rows] = await pool.query(queryStr, params);
                    return res.status(200).json({ success: true, rows: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 💣 F. DB 원본 데이터 다이렉트 긴급 삭제 명령
            else if (action === 'DELETE_RAW_ROW_DIRECT') {
                try {
                    if (type === 'out') await pool.query("DELETE FROM outbound WHERE id = ?", [rowId]);
                    else await pool.query("DELETE FROM inbound WHERE id = ?", [rowId]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_DELETE', ?)", [currentAdmin, `${type === 'out' ? '출고' : '입고'} 테이블 일련번호 [ID: ${rowId}] 로우 강제 소거`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // ✏️ G. DB 로우 풀데이터 (전체 컬럼) 업데이트 (안전장치 safeDate 적용)
            else if (action === 'UPDATE_RAW_ROW_FULL') {
                try {
                    const { rowId } = payload.updateData;
                    if (type === 'out') {
                        const { company, pal, box, outbound_date, etc, created_at, sort_idx, isDone } = payload.updateData;
                        await pool.query(
                            "UPDATE outbound SET company=?, pal=?, box=?, outbound_date=?, etc=?, created_at=?, sort_idx=?, isDone=? WHERE id=?", 
                            [company, pal, box, safeDate(outbound_date), etc, safeDate(created_at), sort_idx, isDone, rowId]
                        );
                    } else {
                        const { bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, last_updated, sort_idx, status, is_ai_modified } = payload.updateData;
                        await pool.query(
                            "UPDATE inbound SET bl_number=?, pallets=?, eta=?, receive_date=?, fwd=?, s_type=?, invoice=?, remarks=?, last_updated=?, sort_idx=?, status=?, is_ai_modified=? WHERE id=?", 
                            [bl_number, pallets, safeDate(eta), safeDate(receive_date), fwd, s_type, invoice, remarks, safeDate(last_updated), sort_idx, status, is_ai_modified, rowId]
                        );
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_UPDATE', ?)", [currentAdmin, `DB 제어실 전체 컬럼 인라인 수정 [ID:${rowId}]`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // ✅ 1. 로그인 로직 (정석적인 LOGIN 액션)
            else if (action === 'LOGIN') {
                try {
                    const { id, pw } = data; 
                    const [rows] = await pool.query("SELECT admin_id, password_hash, admin_name, role FROM admins WHERE admin_id = ? AND status = 'ACTIVE'", [id]);

                    if (rows.length === 0 || rows[0].password_hash !== pw) {
                        return res.status(200).json({ success: false, msg: '아이디 또는 비밀번호가 틀립니다.' });
                    }

                    const user = rows[0];
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'LOGIN', '시스템 관리자 로그인 성공')", [user.admin_id]);

                    return res.status(200).json({ success: true, admin_id: user.admin_id, role: user.role, name: user.admin_name });
                } catch (error) {
                    console.error("로그인 에러:", error);
                    return res.status(200).json({ success: false, msg: '로그인 처리 중 오류가 발생했습니다.' });
                }
            }
            
            // ✅ 2. 시스템 및 OCR 로직들 (원본 100% 유지)
            else if (action === 'getLastOcrImageUrl' || action === 'GET_LAST_OCR_IMAGE') {
                try {
                    await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
                    const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);
                    let finalUrl = "";
                    let fileId = null;

                    if (rows.length > 0) {
                        let val = rows[0].setting_value;
                        if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
                        
                        if (typeof val === 'object' && val !== null) { 
                            finalUrl = val.url || ""; 
                            fileId = val.fileId || null;
                        } else if (typeof val === 'string') { finalUrl = val; }

                        if (fileId) {
                            try {
                                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                                const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
                                const fileData = await fileRes.json();
                                
                                if (fileData.ok) {
                                    finalUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
                                    if (typeof val === 'object') {
                                        val.url = finalUrl;
                                        await pool.query(`UPDATE system_settings SET setting_value = ? WHERE setting_key = 'last_ocr_image'`, [JSON.stringify(val)]);
                                    }
                                }
                            } catch(apiErr) { console.error("🔥 텔레그램 새 이미지 주소 발급 실패:", apiErr); }
                        }
                    }
                    return res.status(200).json({ url: finalUrl, success: true });
                } catch(e) {
                    console.error("🔥 OCR 이미지 로딩 에러:", e);
                    return res.status(200).json({ url: "", success: false });
                }
            }

            else if (action === 'getOcrLastTimeStr' || action === 'GET_OCR_LAST_TIME') {
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

            else if (action === 'SAVE_OCR_INFO') {
                const urlVal = data?.url || '';
                const timeVal = data?.time || '';
                await pool.query(`CREATE TABLE IF NOT EXISTS system_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_image', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [urlVal, urlVal]);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('last_ocr_time', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [timeVal, timeVal]);
                
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'SYS_OCR_SAVE', ?)", [currentAdmin, `텔레그램 OCR 데이터 동기화`]);
                return res.status(200).json({ success: true });
            }
            
            else if (action === 'GET_LAST_OCR_DATA') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'LAST_OCR_DATA'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : []);
            }
            else if (action === 'GET_COMP_INFO_DB') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            else if (action === 'SAVE_COMP_INFO_DB') { const jsonStr = JSON.stringify(data); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            else if (action === 'GET_GLOBAL_COLORS') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            else if (action === 'SAVE_GLOBAL_COLOR') { 
                const compName = data?.compName || payload.compName;
                const colorIdx = data?.colorIdx || payload.colorIdx;
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); 
                let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {}; 
                if (compName) colors[compName] = colorIdx; 
                const jsonStr = JSON.stringify(colors); 
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('GLOBAL_COMPANY_COLORS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); 
                return res.status(200).json({ success: true }); 
            }
            
            else if (action === 'GET_YEARLY_HOLIDAYS') {
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
                                if (holidayName.includes("대체공휴일")) holidayName = holidayName.replace("대체공휴일", "대체");
                                return { date: `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`, name: holidayName };
                            }));
                        }
                    } catch (e) { console.error("🔥 공휴일 API 에러:", e); }
                }
                const baseHolidays = [
                    {date:`${y}-01-01`, name:"신정"}, {date:`${y}-03-01`, name:"삼일절"}, {date:`${y}-05-05`, name:"어린이날"},
                    {date:`${y}-06-06`, name:"현충일"}, {date:`${y}-08-15`, name:"광복절"}, {date:`${y}-10-03`, name:"개천절"},
                    {date:`${y}-10-09`, name:"한글날"}, {date:`${y}-12-25`, name:"성탄절"}
                ];
                return res.status(200).json(baseHolidays);
            }

            // ✅ 3. 입/출고 데이터 처리 (원본 로직 완전 보존 + 로그 기록)
            else if (domain === 'out') {
                const targetName = data?.oldComp;
                const newName = data?.newComp || targetName;
                const targetDate = data?.oldDate === '미정' ? null : data?.oldDate;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;
                const targetPal = data?.oldPal || '';
                const targetBox = data?.oldBox || '';

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [action === 'DONE' ? 1 : 0, targetName, targetDate, targetPal, targetBox]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)", [currentAdmin, `출고 상태 변경: ${targetName}`]);
                } else if (action === 'DELETE') {
                    await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [targetName, targetDate, targetPal, targetBox]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)", [currentAdmin, `출고 항목 삭제: ${targetName}`]);
                } else if (action === 'EDIT') {
                    await pool.query(`UPDATE outbound SET outbound_date = ?, company = ?, pal = ?, box = ?, etc = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [newDate, newName, data?.newPal || '', data?.newBox || '', data?.newEtc || '', targetName, targetDate, targetPal, targetBox]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `출고 항목 수정: ${targetName} ➡️ ${newName}`]);
                } else if (action === 'ADD') { 
                    let reqComp = (data?.newComp || data?.company || data?.comp || '').trim();
                    let reqDateOut = data?.newDate !== undefined ? data?.newDate : (data?.date !== undefined ? data?.date : data?.outbound_date);
                    if (reqDateOut === '미정' || reqDateOut === '' || !reqDateOut) reqDateOut = null;
                    else if (typeof reqDateOut === 'string' && reqDateOut.length > 10) reqDateOut = reqDateOut.substring(0, 10);
                    
                    let reqPalOut = data?.newPal || data?.pal || '';
                    let reqBoxOut = data?.newBox || data?.box || '';
                    let reqEtcOut = data?.newEtc || data?.etc || '';

                    const [exist] = await pool.query(`SELECT id FROM outbound WHERE TRIM(company) = ? AND outbound_date <=> ?`, [reqComp, reqDateOut]);
                    if (exist.length > 0) {
                        await pool.query(`UPDATE outbound SET pal = ?, box = ?, etc = ? WHERE id = ?`, [reqPalOut, reqBoxOut, reqEtcOut, exist[0].id]);
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `출고 캘린더 수량 병합: ${reqComp}`]);
                    } else {
                        await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`, [reqComp, reqPalOut, reqBoxOut, reqDateOut, reqEtcOut]); 
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)", [currentAdmin, `출고 캘린더 신규 등록: ${reqComp}`]);
                    }
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) {
                                await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            } else {
                                await pool.query(`UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [item.sortIdx, item.company, tDate, item.pal, item.box]);
                            }
                        }
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)", [currentAdmin, `출고 화면 드래그 순서 변경`]);
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [it.comp, tDate, it.pal, it.box]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)", [currentAdmin, `출고 캘린더 다중 항목(${data.items.length}건) 삭제`]);
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const isDoneVal = action === 'MULTI_DONE' ? 1 : 0;
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [isDoneVal, it.comp, tDate, it.pal, it.box]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)", [currentAdmin, `출고 다중 상태 변경(${data.items.length}건)`]);
                }
                return res.status(200).json({ success: true, msg: '작업 완료' });
            } 
            
            else {
                const newName = data?.newComp || data?.newBL;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    const statusVal = action === 'DONE' ? '완료' : '입고대기';
                    if (data?.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, data.id]);
                    else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)", [currentAdmin, `입고 상태 변경: ${data?.oldBL}`]);
                } else if (action === 'DELETE') {
                    if (data?.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [data.id]);
                    else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)", [currentAdmin, `입고 항목 삭제: ${data?.oldBL}`]);
                } else if (action === 'EDIT') {
                    if (data?.id) {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE id=?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data.id]);
                    } else {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE bl_number=? AND receive_date<=>?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `입고 항목 수정: ${data?.oldBL} ➡️ ${newName}`]);
                } else if (action === 'ADD') {
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
                    if (reqInvoice !== '') {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE invoice = ? AND receive_date <=> ?`, [reqInvoice, reqDate]);
                    }
                    if (exist.length === 0 && reqBl !== '') {
                        [exist] = await pool.query(`SELECT id FROM inbound WHERE TRIM(bl_number) = ? AND receive_date <=> ?`, [reqBl, reqDate]);
                    }

                    if (exist.length > 0) {
                        await pool.query(`UPDATE inbound SET bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, is_ai_modified=1 WHERE id=?`, 
                            [reqBl, reqPal, reqEtc, reqSType, reqFwd, reqInvoice, exist[0].id]);
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `입고 캘린더 데이터 갱신: ${reqBl}`]);
                    } else {
                        await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, 1)`, 
                            [reqBl, reqPal, reqDate, reqEtc, reqSType, reqFwd, reqInvoice]);
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)", [currentAdmin, `입고 캘린더 신규 등록: ${reqBl}`]);
                    }
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`, [item.sortIdx, item.company, tDate, item.pal]);
                        }
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)", [currentAdmin, `입고 화면 드래그 순서 변경 적용`]);
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        if (it.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [it.id]);
                        else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)", [currentAdmin, `입고 캘린더 다중 항목(${data.items.length}건) 삭제`]);
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const statusVal = action === 'MULTI_DONE' ? '완료' : '입고대기';
                    for (const it of data.items) {
                        if (it.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, it.id]);
                        else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)", [currentAdmin, `입고 다중 상태 변경(${data.items.length}건)`]);
                }
                return res.status(200).json({ success: true, msg: '작업 완료' });
            }
        }
    } catch (error) {
        console.error("🔥 API 에러:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};