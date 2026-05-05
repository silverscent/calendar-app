require('dotenv').config();
const mysql = require('mysql2/promise');

module.exports = async function(req, res) {
    // 🚨 CORS 방어벽 해제
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pool = mysql.createPool(process.env.DATABASE_URL);

        // ==========================================================
        // 📥 [GET 요청] 달력 초기 로딩 및 연간 통계
        // ==========================================================
        if (req.method === 'GET') {
            const { type, year, month, action } = req.query;

            // 📊 [수정 1] 연간 통계 로딩 (서버에서 1~12월 데이터를 직접 합산해서 던져줌!)
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
                    let mIdx = d.getMonth(); // 0~11 (1월~12월)
                    
                    let name = type === 'out' ? r.company : r.bl_number;
                    let cleanName = (name || "").replace(/\[TASK\]/gi, "").trim();
                    let isTask = (name || "").toUpperCase().startsWith("[TASK]") || /OC|IC|폐기|반품|제작|하프|점검|휴무/i.test(cleanName);
                    
                    // TASK(작업)가 아닌 진짜 화물만 1년 치 합산 계산
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

            // 🚚 [출고 전용 조회 로직]
            if (type === 'out') {
                const [monthRows] = await pool.query(`SELECT * FROM outbound WHERE YEAR(outbound_date) = ? AND MONTH(outbound_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
                const [pendingRows] = await pool.query(`SELECT * FROM outbound WHERE outbound_date IS NULL ORDER BY sort_idx ASC, id ASC`);

                monthRows.forEach(row => {
                    const day = new Date(row.outbound_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ 
                        id: row.id, company: row.company, pal: row.pal, box: row.box, 
                        etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx || 999 
                    });
                });
                pendingRows.forEach(row => {
                    formattedData.pendingItems.push({ 
                        id: row.id, company: row.company, pal: row.pal, box: row.box, 
                        etc: row.etc, isDone: row.isDone === 1, sortIdx: row.sort_idx || 999 
                    });
                });
            } 
            // 🚢 [입고 전용 조회 로직]
            else {
                const [monthRows] = await pool.query(`SELECT * FROM inbound WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
                const [pendingRows] = await pool.query(`SELECT * FROM inbound WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`);

                monthRows.forEach(row => {
                    const day = new Date(row.receive_date).getDate();
                    if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                    formattedData.monthData[day].push({ 
                        id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, 
                        etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, 
                        isDone: row.status === '완료', sortIdx: row.sort_idx || 999 
                    });
                });
                pendingRows.forEach(row => {
                    formattedData.pendingItems.push({ 
                        id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, 
                        etc: row.remarks, sType: row.s_type, isDone: row.status === '완료', sortIdx: row.sort_idx || 999 
                    });
                });
            }

            return res.status(200).json(formattedData);
        }

        // ==========================================================
        // 📤 [POST 요청] 스케줄 및 시스템 설정 조작
        // ==========================================================
        if (req.method === 'POST') {
            const body = req.body;
            const payload = typeof body === 'string' ? JSON.parse(body) : body; 
            const { domain, action, data, token, compName, colorIdx, year } = payload;
            
            if (action === 'PING') return res.status(200).json({ msg: token === process.env.ADMIN_PW ? 'OK' : '보안 에러' });

            // 💡 [수정 2] DB의 텍스트(String)를 다시 JSON 객체로 예쁘게 파싱해주는 헬퍼
            const parseJSON = (val) => {
                try { return typeof val === 'string' ? JSON.parse(val) : val; } 
                catch(e) { return val; }
            };

            // 🎯 공통 시스템 로직 (CRM, 테마색)
            if (action === 'GET_COMP_INFO_DB') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'crm_comp_info'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {});
            }
            if (action === 'SAVE_COMP_INFO_DB') {
                const jsonStr = JSON.stringify(data);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('crm_comp_info', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]);
                return res.status(200).json({ success: true });
            }
            if (action === 'GET_GLOBAL_COLORS') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'global_colors'`);
                return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {});
            }
            if (action === 'SAVE_GLOBAL_COLOR') {
                const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'global_colors'`);
                let colors = rows.length > 0 ? parseJSON(rows[0].setting_value) : {};
                colors[compName] = colorIdx;
                const jsonStr = JSON.stringify(colors);
                await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('global_colors', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]);
                return res.status(200).json({ success: true });
            }
            if (action === 'GET_YEARLY_HOLIDAYS') {
                const y = year || new Date().getFullYear();
                const holidays = [`${y}-01-01`, `${y}-03-01`, `${y}-05-05`, `${y}-06-06`, `${y}-08-15`, `${y}-10-03`, `${y}-10-09`, `${y}-12-25`];
                return res.status(200).json(holidays);
            }
            if (action === 'GET_LAST_OCR_IMAGE') return res.status(200).json(""); 
            if (action === 'GET_OCR_LAST_TIME') return res.status(200).json("최근 처리내역 없음");

            // 🚚 [출고 전용 데이터 조작 로직]
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
                    for (const [dateStr, orders] of Object.entries(data.dailyOrders)) {
                        for (const [key, sortIdx] of Object.entries(orders)) {
                            const parts = key.split('_');
                            const b = parts.pop();
                            const p = parts.pop();
                            const compBase = parts.slice(1).join('_');
                            const compName = key.startsWith('T_') ? `[TASK]${compBase}` : compBase;
                            await pool.query(`UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [sortIdx, compName, dateStr, p, b]);
                        }
                    }
                }
            } 
            // 🚢 [입고 전용 데이터 조작 로직]
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
                    for (const [dateStr, orders] of Object.entries(data.dailyOrders)) {
                        for (const [key, sortIdx] of Object.entries(orders)) {
                            const isTask = key.startsWith('T_');
                            const parts = key.split('_');
                            const compName = isTask ? `[TASK]${parts[1]}` : parts[1];
                            const pal = parts[2] === "" ? 0 : parseInt(parts[2]);
                            const box = parts[3] === "" ? 0 : parseInt(parts[3]);
                            await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ? AND box = ?`, [sortIdx, compName, dateStr, pal, box]);
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