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
                    [rows] = await pool.query(`SELECT receive_date, pallets, box, s_type, remarks, bl_number FROM inbound WHERE YEAR(receive_date) = ?`, [year]);
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
                        let b = parseInt(r.box) || 0;
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
                const [monthRows] = await pool.query(`SELECT * FROM inbound WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
                const [pendingRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`);

                monthRows.forEach(row => {
                    const day = new Date(row.receive_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, isDone: row.status === '완료', sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
                });
                pendingRows.forEach(row => {
                    formattedData.pendingItems.push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, etc: row.remarks, sType: row.s_type, isDone: row.status === '완료', sortIdx: row.sort_idx !== null ? row.sort_idx : 999 });
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
                    } catch (e) { console.error("🔥 공휴일 API 통신 에러:", e); }
                }
                const fallbackHolidays = [`${y}-01-01`, `${y}-03-01`, `${y}-05-05`, `${y}-06-06`, `${y}-08-15`, `${y}-10-03`, `${y}-10-09`, `${y}-12-25`];
                return res.status(200).json(fallbackHolidays);
            }

            if (action === 'GET_LAST_OCR_IMAGE') return res.status(200).json(""); 
            if (action === 'GET_OCR_LAST_TIME') return res.status(200).json("최근 처리내역 없음");

            if (domain === 'out') {
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
                } 
                // 🚨 [수정 1] 다중 선택 삭제/완료 완벽 반영
                else if (action === 'MULTI_DELETE' && data?.items) {
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
                const targetName = data?.oldComp || data?.oldBL;
                const newName = data?.newComp || data?.newBL || targetName;
                const targetDate = data?.oldDate === '미정' ? null : data?.oldDate;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [action === 'DONE' ? '완료' : '입고대기', targetName, targetDate]);
                } else if (action === 'DELETE') {
                    await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [targetName, targetDate]);
                } else if (action === 'EDIT') {
                    await pool.query(`UPDATE inbound SET receive_date = ?, bl_number = ?, pallets = ?, box = ?, remarks = ? WHERE bl_number = ? AND receive_date <=> ?`, [newDate, newName, data?.newPal || 0, data?.newBox || 0, data?.newEtc || '', targetName, targetDate]);
                } else if (action === 'ADD') {
                    await pool.query(`INSERT INTO inbound (bl_number, pallets, box, receive_date, status, remarks) VALUES (?, ?, ?, ?, '입고대기', ?)`, [newName, data?.newPal || 0, data?.newBox || 0, newDate, data?.newEtc || '']);
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ? AND box = ?`, [item.sortIdx, item.company, tDate, item.pal, item.box]);
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