// api/calendar.js
require('dotenv').config();
const mysql = require('mysql2/promise');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pool = mysql.createPool(process.env.DATABASE_URL);

        if (req.method === 'GET') {
            const { type, year, month, action } = req.query;
            const tableName = type === 'out' ? 'outbound' : 'inbound';

            if (action === 'yearlyStats') {
                const [rows] = await pool.query(`SELECT receive_date, pallets, box, s_type, remarks, bl_number FROM ${tableName} WHERE YEAR(receive_date) = ?`, [year]);
                return res.status(200).json({ success: true, year, data: rows });
            }

            // 💡 sort_idx 기준으로 정렬해서 가져옵니다.
            const [monthRows] = await pool.query(`SELECT * FROM ${tableName} WHERE YEAR(receive_date) = ? AND MONTH(receive_date) = ? ORDER BY sort_idx ASC, id ASC`, [year, month]);
            const [pendingRows] = await pool.query(`SELECT * FROM ${tableName} WHERE receive_date IS NULL OR status = '미정' ORDER BY sort_idx ASC, id ASC`);

            let formattedData = { year: parseInt(year), month: parseInt(month), monthData: {}, pendingItems: [] };

            monthRows.forEach(row => {
                const day = new Date(row.receive_date).getDate();
                if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                formattedData.monthData[day].push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, etc: row.remarks, sType: row.s_type, fwd: row.fwd, invoice: row.invoice, isDone: row.status === '완료', sortIdx: row.sort_idx || 999 });
            });

            pendingRows.forEach(row => {
                formattedData.pendingItems.push({ id: row.id, bl: row.bl_number, company: row.bl_number, pal: row.pallets, box: row.box || 0, etc: row.remarks, sType: row.s_type, isDone: row.status === '완료', sortIdx: row.sort_idx || 999 });
            });

            return res.status(200).json(formattedData);
        }

        if (req.method === 'POST') {
            const body = req.body;
            const payload = typeof body === 'string' ? JSON.parse(body) : body; 
            const { domain, action, data, token } = payload;
            
            if (action === 'PING') return res.status(200).json({ msg: token === process.env.ADMIN_PW ? 'OK' : '보안 에러' });

            const tableName = domain === 'out' ? 'outbound' : 'inbound';
            const targetName = data.oldComp || data.oldBL;
            const newName = data.newComp || data.newBL || targetName;
            const targetDate = data.oldDate === '미정' ? null : data.oldDate;
            const newDate = data.newDate === '미정' ? null : data.newDate;

            if (action === 'DONE' || action === 'UNDO_DONE') {
                await pool.query(`UPDATE ${tableName} SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [action === 'DONE' ? '완료' : '입고대기', targetName, targetDate]);
            } else if (action === 'DELETE') {
                await pool.query(`DELETE FROM ${tableName} WHERE bl_number = ? AND receive_date <=> ?`, [targetName, targetDate]);
            } else if (action === 'EDIT') {
                await pool.query(`UPDATE ${tableName} SET receive_date = ?, bl_number = ?, pallets = ?, box = ?, remarks = ? WHERE bl_number = ? AND receive_date <=> ?`, [newDate, newName, data.newPal || 0, data.newBox || 0, data.newEtc || '', targetName, targetDate]);
            } else if (action === 'ADD') {
                await pool.query(`INSERT INTO ${tableName} (bl_number, pallets, box, receive_date, status, remarks) VALUES (?, ?, ?, ?, '입고대기', ?)`, [newName, data.newPal || 0, data.newBox || 0, newDate, data.newEtc || '']);
            } else if (action === 'UPDATE_ORDER') {
                // 💡 드래그 앤 드롭 순서 변경 처리 로직
                if (data.dailyOrders) {
                    for (const [dateStr, orders] of Object.entries(data.dailyOrders)) {
                        for (const [key, sortIdx] of Object.entries(orders)) {
                            // key 예시: "O_업체명_10_5" 또는 "T_[TASK]이름_0_0"
                            const isTask = key.startsWith('T_');
                            const parts = key.split('_');
                            const compName = isTask ? `[TASK]${parts[1]}` : parts[1];
                            const pal = parts[2] === "" ? 0 : parseInt(parts[2]);
                            const box = parts[3] === "" ? 0 : parseInt(parts[3]);

                            await pool.query(
                                `UPDATE ${tableName} SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ? AND box = ?`,
                                [sortIdx, compName, dateStr, pal, box]
                            );
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
}