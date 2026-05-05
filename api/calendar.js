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

            if (action === 'yearlyStats') {
                let rows = [];
                if (type === 'out') {
                    [rows] = await pool.query(`SELECT outbound_date, pal, box, etc, company, isDone FROM outbound WHERE YEAR(outbound_date) = ?`, [year]);
                } else {
                    // 🚨 [입고 패치] box 제거, pallets만 집계
                    [rows] = await pool.query(`SELECT receive_date, pallets, s_type, remarks, bl_number FROM inbound WHERE YEAR(receive_date) = ?`, [year]);
                }

                let monthly = Array.from({length: 12}, () => ({ pal: 0, box: 0, details: {} }));
                let compStats = {};

                rows.forEach(r => {
                    let dateVal = type === 'out' ? r.outbound_date : r.receive_date;
                    if (!dateVal) return;
                    let d = new Date(dateVal);
                    let mIdx = d.getMonth(); 
                    
                    let name = type === 'out' ? r.company : r.bl_number;
                    let cleanName = (name || "").replace(/\[TASK\]/gi, "").trim();
                    let isTask = (name || "").toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(cleanName);
                    
                    if (!isTask) {
                        let p = parseInt(type === 'out' ? r.pal : r.pallets) || 0;
                        let b = type === 'out' ? (parseInt(r.box) || 0) : 0; // 입고는 box 없음
                        
                        monthly[mIdx].pal += p;
                        monthly[mIdx].box += b;
                        if (!monthly[mIdx].details[cleanName]) monthly[mIdx].details[cleanName] = { pal: 0, box: 0 };
                        monthly[mIdx].details[cleanName].pal += p;
                        monthly[mIdx].details[cleanName].box += b;
                        if (!compStats[cleanName]) compStats[cleanName] = { pal: 0, box: 0 };
                        compStats[cleanName].pal += p;
                        compStats[cleanName].box += b;
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
                pendingRows.forEach(row => {
                    formattedData.pendingItems.push({ id: row.id, company: row.company, pal: row.pal, box: row.box, etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
                });
            } else {
                // 🚢 [입고 전용 조회 패치] DB 컬럼 완벽 매칭 (box 삭제, isAi 추가)
                const [monthRows] = await pool.query(`SELECT * FROM inbound WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
                const [pendingRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`);

                monthRows.forEach(row => {
                    const day = new Date(row.receive_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ 
                        id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, 
                        etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, 
                        isDone: row.status === '완료', isAi: row.is_ai_modified === 1, 
                        sortIdx: row.sort_idx !== null ? row.sort_idx : 999 
                    });
                });
                pendingRows.forEach(row => {
                    formattedData.pendingItems.push({ 
                        id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, 
                        etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, 
                        isDone: row.status === '완료', isAi: row.is_ai_modified === 1, 
                        sortIdx: row.sort_idx !== null ? row.sort_idx : 999 
                    });
                });
            }
            return res.status(200).json(formattedData);
        }

        if (req.method === 'POST') {
            const body = req.body;
            const payload = typeof body === 'string' ? JSON.parse(body) : body; 
            const { domain, action, data, token, compName, colorIdx, year } = payload;
            
            if (action === 'PING') return res.status(200).json({ msg: token === process.env.ADMIN_PW ? 'OK' : '보안 에러' });

            const parseJSON = (val) => { try { return typeof val === 'string' ? JSON.parse(val) : val; } catch(e) { return val; } };

            if (action === 'GET_COMP_INFO_DB') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {});
            }
            if (action === 'SAVE_COMP_INFO_DB') {
                const jsonStr = JSON.stringify(data);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]);
                return res.status(200).json({ success: true });
            }
            if (action === 'GET_GLOBAL_COLORS') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {});
            }
            if (action === 'SAVE_GLOBAL_COLOR') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'GLOBAL_COMPANY_COLORS'`);
                let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {};
                colors[compName] = colorIdx;
                const jsonStr = JSON.stringify(colors);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('GLOBAL_COMPANY_COLORS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]);
                return res.status(200).json({ success: true });
            }
            
            if (action === 'GET_YEARLY_HOLIDAYS') {
                const y = year || new Date().getFullYear();
                const apiKey = process.env.HOLIDAY_API_KEY; 
                if (apiKey) {
                    try {
                        const url = `http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${y}&ServiceKey=${apiKey}&_type=json&numOfRows=100`;
                        const response = await fetch(url);
                        const json = await response.json();
                        if (json?.response?.body?.items?.item) {
                            const items = json.response.body.items.item;
                            const arr = Array.isArray(items) ? items : [items];
                            const holidays = arr.map(h => {
                                const d = String(h.locdate);
                                return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
                            });
                            return res.status(200).json(holidays);
                        }
                    } catch (e) { console.error("🔥 공휴일 API 에러:", e); }
                }
                const fallbackHolidays = [`${y}-01-01`, `${y}-03-01`, `${y}-05-05`, `${y}-06-06`, `${y}-08-15`, `${y}-10-03`, `${y}-10-09`, `${y}-12-25`];
                return res.status(200).json(fallbackHolidays);
            }

            if (domain === 'out') {
                // (출고 로직 원본 유지 생략... 기존과 동일하므로 건드리지 않음!)
                const targetName = data?.oldComp;
                const newName = data?.newComp || targetName;
                const targetDate = data?.oldDate === '미정' ? null : data?.oldDate;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;
                const targetPal = data?.oldPal || '';
                const targetBox = data?.oldBox || '';

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [action === 'DONE' ? 1 : 0, targetName, targetDate, targetPal, targetBox]);
                } else if (action === 'DELETE') {
                    await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [targetName, targetDate, targetPal, targetBox]);
                } else if (action === 'EDIT') {
                    await pool.query(`UPDATE outbound SET outbound_date = ?, company = ?, pal = ?, box = ?, etc = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [newDate, newName, data?.newPal || '', data?.newBox || '', data?.newEtc || '', targetName, targetDate, targetPal, targetBox]);
                } else if (action === 'ADD') {
                    await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`, [newName, data?.newPal || '', data?.newBox || '', newDate, data?.newEtc || '']);
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [item.sortIdx, item.company, tDate, item.pal, item.box]);
                        }
                    }
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [it.comp, tDate, it.pal, it.box]);
                    }
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const isDoneVal = action === 'MULTI_DONE' ? 1 : 0;
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [isDoneVal, it.comp, tDate, it.pal, it.box]);
                    }
                }
            } 
            else {
                // 🚢 [입고 전용 데이터 조작 로직 패치] 무조건 ID 우선 처리, sType/Fwd 등 DB 컬럼 반영
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
                    await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?)`, 
                        [newName, data?.newPal||'', newDate, data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'']);
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`, [item.sortIdx, item.company, tDate, item.pal]);
                        }
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