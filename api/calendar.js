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

            // 🚨 [4번 해결] 연간 통계 해상/항공 분리 완벽 적용!
            if (action === 'yearlyStats') {
                let rows = [];
                if (type === 'out') {
                    [rows] = await pool.query(`SELECT outbound_date, pal, box, etc, company, isDone FROM outbound WHERE YEAR(outbound_date) = ?`, [year]);
                } else {
                    [rows] = await pool.query(`SELECT receive_date, pallets, s_type, remarks, bl_number FROM inbound WHERE YEAR(receive_date) = ?`, [year]);
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
                        // 🚨 [입고 연간통계 패치] B/L번호가 아니라 '해상/항공' 단위로 묶어줘야 차트가 그려집니다!
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

            if (type === 'out') {
                const [monthRows] = await pool.query(`SELECT * FROM outbound WHERE YEAR(outbound_date) = ? AND MONTH(outbound_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
                const [pendingRows] = await pool.query(`SELECT * FROM outbound WHERE outbound_date IS NULL ORDER BY sort_idx ASC, id ASC`);
                monthRows.forEach(row => {
                    const day = new Date(row.outbound_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ id: row.id, company: row.company, pal: row.pal, box: row.box, etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
                });
                pendingRows.forEach(row => { formattedData.pendingItems.push({ id: row.id, company: row.company, pal: row.pal, box: row.box, etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 }); });
            } else {
                const [monthRows] = await pool.query(`SELECT * FROM inbound WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
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
            if (action === 'PING') return res.status(200).json({ msg: token === process.env.ADMIN_PW ? 'OK' : '보안 에러' });
            const parseJSON = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return val; } };

            // 🚨 [6번 해결] OCR 시스템 [object Object] 엑박 원천 차단
            if (action === 'GET_LAST_OCR_IMAGE') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_image'`);
                let val = rows.length > 0 ? rows[0].setting_value : "";
                try { let parsed = JSON.parse(val); if(parsed.url) val = parsed.url; } catch(e) {}
                return res.status(200).json({ url: val });
            }
            if (action === 'GET_OCR_LAST_TIME') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'last_ocr_time'`);
                let val = rows.length > 0 ? rows[0].setting_value : "최근 처리내역 없음";
                try { let parsed = JSON.parse(val); if(parsed.time) val = parsed.time; } catch(e) {}
                return res.status(200).json({ time: val });
            }

            if (action === 'GET_COMP_INFO_DB') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            if (action === 'SAVE_COMP_INFO_DB') { const jsonStr = JSON.stringify(data); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            if (action === 'GET_GLOBAL_COLORS') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            if (action === 'SAVE_GLOBAL_COLOR') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`); let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {}; colors[compName] = colorIdx; const jsonStr = JSON.stringify(colors); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('GLOBAL_COMPANY_COLORS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            if (action === 'GET_YEARLY_HOLIDAYS') { const y = year || new Date().getFullYear(); const apiKey = process.env.HOLIDAY_API_KEY; if (apiKey) { try { const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${y}&ServiceKey=${apiKey}&_type=json&numOfRows=100`; const response = await fetch(url); const json = await response.json(); if (json?.response?.body?.items?.item) { const items = Array.isArray(json.response.body.items.item) ? json.response.body.items.item : [json.response.body.items.item]; return res.status(200).json(items.map(h => { const d = String(h.locdate); return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`; })); } } catch (e) { console.error("🔥 공휴일 API 에러:", e); } } return res.status(200).json([`${y}-01-01`, `${y}-03-01`, `${y}-05-05`, `${y}-06-06`, `${y}-08-15`, `${y}-10-03`, `${y}-10-09`, `${y}-12-25`]); }

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
                    // 🚨 [출고 중복 방지] 같은 날짜에 같은 업체가 있는지 검사
                    const [exist] = await pool.query(`SELECT id FROM outbound WHERE company = ? AND outbound_date <=> ?`, [newName, newDate]);
                    if (exist.length > 0) {
                        // 있으면 내용만 최신으로 덮어쓰기 (중복 생성 방지)
                        await pool.query(`UPDATE outbound SET pal = ?, box = ?, etc = ? WHERE id = ?`, [data?.newPal || '', data?.newBox || '', data?.newEtc || '', exist[0].id]);
                    } else {
                        // 없으면 새로 생성
                        await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`, [newName, data?.newPal || '', data?.newBox || '', newDate, data?.newEtc || '']); 
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
                    // 🚨 [입고 중복 방지] 같은 날짜에 같은 B/L 번호가 있는지 검사
                    const [exist] = await pool.query(`SELECT id FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [newName, newDate]);
                    if (exist.length > 0) {
                        // 있으면 내용만 최신으로 덮어쓰기 & 봇이 건드렸으니 AI 뱃지 ON!
                        await pool.query(`UPDATE inbound SET pallets=?, remarks=?, s_type=?, fwd=?, invoice=?, is_ai_modified=1 WHERE id=?`, 
                            [data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', exist[0].id]);
                    } else {
                        // 없으면 새로 생성
                        await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, 1)`, 
                            [newName, data?.newPal||'', newDate, data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'']);
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