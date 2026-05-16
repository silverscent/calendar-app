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
        // 🛡️ [시스템 관리] 마스터 전용 백엔드 파이프라인 (어드민 / 로그 / DB 직제어)
        // ====================================================================
        if (req.method === 'POST') {
            const body = req.body;
            const payload = typeof body === 'string' ? JSON.parse(body) : body;
            
            // 🚨 [수정됨] 변수에 admin_id 추가 및 currentAdmin 선언
            const { domain, action, data, keyword, type, rowId, year, month, id, admin_id } = payload;
            const currentAdmin = admin_id || 'system';

            // ====================================================================
            // 👑 마스터 시스템 제어실 전용 API (계정 제어, 로그, 원본 DB 수정/삭제)
            // ====================================================================
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
            else if (action === 'GET_ADMIN_LIST') {
                try {
                    const [rows] = await pool.query("SELECT admin_id, admin_name, role FROM admins WHERE status = 'ACTIVE' ORDER BY id ASC");
                    return res.status(200).json({ success: true, list: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            else if (action === 'DELETE_ADMIN') {
                try {
                    const { id } = data;
                    if (id === 'admin' || id === 'silverscent') return res.status(200).json({ success: false, msg: '마스터 계정은 삭제할 수 없습니다.' });
                    await pool.query("UPDATE admins SET status = 'DELETED' WHERE admin_id = ?", [id]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DELETE_ADMIN', ?)", [currentAdmin, `관리자 계정 차단 및 삭제: ${id}`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            else if (action === 'GET_AUDIT_LOGS') {
                try {
                    const [rows] = await pool.query("SELECT admin_id, action_type, description, created_at FROM admin_audit_logs ORDER BY id DESC LIMIT 50");
                    return res.status(200).json({ success: true, logs: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            else if (action === 'GET_RAW_DB_ROWS') {
                try {
                    let rows = [];
                    if (type === 'out') {
                        if (keyword) [rows] = await pool.query("SELECT id, outbound_date, company, pal, box FROM outbound WHERE company LIKE ? ORDER BY id DESC LIMIT 60", [`%${keyword}%`]);
                        else [rows] = await pool.query("SELECT id, outbound_date, company, pal, box FROM outbound ORDER BY id DESC LIMIT 40");
                    } else {
                        if (keyword) [rows] = await pool.query("SELECT id, receive_date, bl_number, pallets FROM inbound WHERE bl_number LIKE ? OR remarks LIKE ? ORDER BY id DESC LIMIT 60", [`%${keyword}%`, `%${keyword}%`]);
                        else [rows] = await pool.query("SELECT id, receive_date, bl_number, pallets FROM inbound ORDER BY id DESC LIMIT 40");
                    }
                    return res.status(200).json({ success: true, rows: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            else if (action === 'DELETE_RAW_ROW_DIRECT') {
                try {
                    if (type === 'out') await pool.query("DELETE FROM outbound WHERE id = ?", [rowId]);
                    else await pool.query("DELETE FROM inbound WHERE id = ?", [rowId]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_DELETE', ?)", [currentAdmin, `${type === 'out' ? '출고' : '입고'} 테이블 원본 [ID: ${rowId}] 로우 강제 삭제`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            else if (action === 'UPDATE_RAW_ROW_DIRECT') {
                try {
                    const { newName } = payload;
                    if (type === 'out') await pool.query("UPDATE outbound SET company = ? WHERE id = ?", [newName, rowId]);
                    else await pool.query("UPDATE inbound SET bl_number = ? WHERE id = ?", [newName, rowId]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_UPDATE', ?)", [currentAdmin, `원본 [ID: ${rowId}] 식별명 수정 (${newName})`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // ====================================================================
            // 🛡️ [로그 기능 결합] 기존 캘린더 일반 기능 (단 1줄의 기존 코드도 손상 없음)
            // ====================================================================
            else if (action === 'LOGIN') {
                try {
                    const { id, pw } = data;
                    const [rows] = await pool.query("SELECT admin_name, password_hash, role FROM admins WHERE admin_id = ? AND status = 'ACTIVE'", [id]);
                    if (rows.length === 0) return res.status(200).json({ success: false, msg: '아이디가 존재하지 않거나 정지되었습니다.' });
                    if (rows[0].password_hash !== pw) return res.status(200).json({ success: false, msg: '비밀번호가 일치하지 않습니다.' });
                    
                    // 🚨 로그인 로그 추가
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'LOGIN', '시스템에 로그인했습니다.')", [id]);
                    
                    return res.status(200).json({ success: true, name: rows[0].admin_name, admin_id: id, role: rows[0].role });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            
            // 기존 SAVE 액션 (입출고 등록)
            else if (action === 'SAVE') {
                const isOut = domain === 'outbound';
                if (isOut) {
                    if (id) {
                        await pool.query(`UPDATE outbound SET outbound_date=?, company=?, pal=?, box=?, etc=?, isDone=? WHERE id=?`, 
                            [data.dateStr, data.company, data.pal, data.box, data.etc, data.isDone ? 1 : 0, id]);
                    } else {
                        await pool.query(`INSERT INTO outbound (outbound_date, company, pal, box, etc, isDone) VALUES (?, ?, ?, ?, ?, ?)`, 
                            [data.dateStr, data.company, data.pal, data.box, data.etc, data.isDone ? 1 : 0]);
                    }
                } else {
                    if (id) {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, sType=?, pallets=?, fwd=?, remarks=?, status=?, sort_idx=? WHERE id=?`, 
                            [data.dateStr === '미정' ? null : data.dateStr, data.bl, data.sType, data.pal, data.fwd, data.remarks, data.status, data.sortIdx || 0, id]);
                    } else {
                        await pool.query(`INSERT INTO inbound (receive_date, bl_number, sType, pallets, fwd, remarks, status, sort_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                            [data.dateStr === '미정' ? null : data.dateStr, data.bl, data.sType, data.pal, data.fwd, data.remarks, data.status, data.sortIdx || 0]);
                    }
                }
                
                // 🚨 단일 저장/수정 로그 추가
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SAVE', ?)", 
                    [currentAdmin, `캘린더에서 [${isOut ? '출고' : '입고'}] 항목을 ${id ? '수정' : '신규 등록'}했습니다. (${isOut ? data.company : data.bl})`]);
                    
                return res.status(200).json({ success: true });
            }

            // 기존 EDIT_COMPANY_ONLY (거래처명 변경 등)
            else if (action === 'EDIT_COMPANY_ONLY') {
                const { oldComp, newComp, dateStr } = data;
                await pool.query(`UPDATE outbound SET company = ? WHERE company = ? AND outbound_date = ?`, [newComp, oldComp, dateStr]);
                
                // 🚨 수정 로그 추가
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `출고 거래처명을 [${oldComp}]에서 [${newComp}](으)로 일괄 수정했습니다.`]);
                return res.status(200).json({ success: true });
            }

            // 기존 SORT 로직 (드래그 순서 변경)
            else if (action === 'SORT' && data?.items) {
                for (const item of data.items) {
                    let tDate = item.dateStr === '미정' ? null : item.dateStr;
                    if (domain === 'outbound') {
                        if (item.id) await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                        else await pool.query(`UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date = ? AND pal = ? AND box = ?`, [item.sortIdx, item.company, item.dateStr, item.pal, item.box]);
                    } else {
                        if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                        else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`, [item.sortIdx, item.company, tDate, item.pal]);
                    }
                }
                
                // 🚨 순서 이동 로그 추가
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)", [currentAdmin, `캘린더 [${domain}] 화면에서 드래그하여 순서를 변경했습니다.`]);
            } 
            
            // 기존 MULTI_DELETE (다중 삭제)
            else if (action === 'MULTI_DELETE' && data?.items) {
                for (const it of data.items) {
                    if (it.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [it.id]);
                    else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                }
                
                // 🚨 삭제 로그 추가
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)", [currentAdmin, `캘린더에서 데이터 ${data.items.length}건을 삭제했습니다.`]);
            } 
            
            // 기존 MULTI_DONE / MULTI_UNDO_DONE (입/출고 완료 및 대기 처리)
            else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                const statusVal = action === 'MULTI_DONE' ? '완료' : '입고대기';
                for (const it of data.items) {
                    if (it.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, it.id]);
                    else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                }
                
                // 🚨 상태 변경 로그 추가
                await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)", [currentAdmin, `캘린더에서 데이터 ${data.items.length}건의 상태를 [${statusVal}](으)로 변경했습니다.`]);
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
                    } else {
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
                return res.status(200).json({ success: true, msg: '작업 완료' });
            }
        
    } catch (error) {
        console.error("🔥 API 에러:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};