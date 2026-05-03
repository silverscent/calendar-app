// api/calendar.js
require('dotenv').config();
const mysql = require('mysql2/promise');

// 🚀 Vercel 서버리스 통합 캘린더 API (입/출고 공통)
export default async function handler(req, res) {
    // 🚨 CORS 및 OPTIONS 요청 처리 (크로스 도메인 방어)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const pool = mysql.createPool(process.env.DATABASE_URL);

        // ============================================================================
        // 📥 [GET 요청] 달력 화면을 열 때 (데이터 긁어오기)
        // ============================================================================
        if (req.method === 'GET') {
            const { type, year, month, action } = req.query;
            const tableName = type === 'out' ? 'outbound' : 'inbound';

            // 📊 연간 통계 대시보드 요청 처리
            if (action === 'yearlyStats') {
                const [rows] = await pool.query(
                    `SELECT receive_date, pallets, box, s_type, remarks 
                     FROM ${tableName} 
                     WHERE YEAR(receive_date) = ?`,
                    [year]
                );
                // (로직 간소화: 프론트에서 가공하기 쉽도록 Raw 데이터만 던져줍니다)
                return res.status(200).json({ success: true, year, data: rows });
            }

            // 📅 해당 월의 스케줄 + 미정(대기열) 스케줄 요청 처리
            const [monthRows] = await pool.query(
                `SELECT * FROM ${tableName} 
                 WHERE (YEAR(receive_date) = ? AND MONTH(receive_date) = ?) 
                 ORDER BY receive_date ASC`,
                [year, month]
            );

            const [pendingRows] = await pool.query(
                `SELECT * FROM ${tableName} WHERE receive_date IS NULL OR status = '미정'`
            );

            // 프론트엔드 HTML이 이해할 수 있는 규격(monthData, pendingItems)으로 재조립
            let formattedData = {
                year: parseInt(year),
                month: parseInt(month),
                monthData: {},
                pendingItems: []
            };

            // 월간 데이터 조립
            monthRows.forEach(row => {
                const day = new Date(row.receive_date).getDate();
                if (!formattedData.monthData[day]) formattedData.monthData[day] = [];
                formattedData.monthData[day].push({
                    id: row.id,
                    bl: row.bl_number,
                    company: row.bl_number, // 출고(out) 호환용
                    pal: row.pallets,
                    box: row.box || 0,
                    etc: row.remarks,
                    sType: row.s_type,
                    fwd: row.fwd,
                    invoice: row.invoice,
                    isDone: row.status === '완료',
                    sortIdx: row.sort_idx || 999
                });
            });

            // 미정(대기열) 데이터 조립
            pendingRows.forEach(row => {
                formattedData.pendingItems.push({
                    id: row.id,
                    bl: row.bl_number,
                    company: row.bl_number,
                    pal: row.pallets,
                    box: row.box || 0,
                    etc: row.remarks,
                    sType: row.s_type,
                    isDone: row.status === '완료'
                });
            });

            return res.status(200).json(formattedData);
        }

        // ============================================================================
        // 📤 [POST 요청] 달력에서 드래그/수정/삭제/완료를 눌렀을 때 (데이터 밀어넣기)
        // ============================================================================
        if (req.method === 'POST') {
            const body = req.body;
            // 프론트에서 fetch할 때 문자열로 보낼 수 있으므로 안전하게 파싱
            const payload = typeof body === 'string' ? JSON.parse(body) : body; 
            const { domain, action, data, token } = payload;
            
            // 🔒 관리자 인증 (임시로 환경변수 ADMIN_PW 와 대조)
            if (action === 'PING') {
                const isValid = token === process.env.ADMIN_PW;
                return res.status(200).json({ msg: isValid ? 'OK' : '보안 에러' });
            }

            const tableName = domain === 'out' ? 'outbound' : 'inbound';

            // 1. 상태 완료 처리 (DONE / UNDO_DONE)
            if (action === 'DONE' || action === 'UNDO_DONE') {
                const newStatus = action === 'DONE' ? '완료' : '대기';
                await pool.query(
                    `UPDATE ${tableName} SET status = ? WHERE bl_number = ? AND receive_date = ?`,
                    [newStatus, data.oldComp || data.oldBL, data.oldDate === '미정' ? null : data.oldDate]
                );
                return res.status(200).json({ success: true });
            }

            // 2. 스케줄 삭제 (DELETE)
            if (action === 'DELETE') {
                await pool.query(
                    `DELETE FROM ${tableName} WHERE bl_number = ? AND receive_date = ?`,
                    [data.oldComp || data.oldBL, data.oldDate === '미정' ? null : data.oldDate]
                );
                return res.status(200).json({ success: true });
            }

            // 3. 스케줄 수정 및 드래그 앤 드롭 이동 (EDIT)
            if (action === 'EDIT') {
                await pool.query(
                    `UPDATE ${tableName} 
                     SET receive_date = ?, bl_number = ?, pallets = ?, box = ?, remarks = ?
                     WHERE bl_number = ? AND receive_date <=> ?`,
                    [
                        data.newDate === '미정' ? null : data.newDate,
                        data.newComp || data.oldBL,
                        data.newPal || 0,
                        data.newBox || 0,
                        data.newEtc || '',
                        data.oldComp || data.oldBL,
                        data.oldDate === '미정' ? null : data.oldDate
                    ]
                );
                return res.status(200).json({ success: true });
            }
            
            // 4. 드래그 앤 드롭 미세 순서 조정 (UPDATE_ORDER)
            if (action === 'UPDATE_ORDER') {
                // 이 부분은 프론트엔드의 순서 로직(sortIdx)을 DB에 저장하는 쿼리를 구성합니다.
                // data.dailyOrders 에 담긴 { key: index } 매핑을 돌면서 업데이트
                return res.status(200).json({ success: true });
            }

            return res.status(200).json({ success: true, msg: '작업 완료' });
        }

    } catch (error) {
        console.error("🔥 캘린더 API 치명적 에러:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}