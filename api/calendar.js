require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// 💡 [수정] DB 연결 풀을 최상단 전역 스코프로 이동 (커넥션 재사용으로 응답 속도 극대화)
const pool = mysql.createPool(process.env.DATABASE_URL);

module.exports = async function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 💡 내부의 기존 'const pool = ...' 한 줄은 지우고, pool.query 구문들은 그대로 둡니다.

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

            // 🚨 [강화된 글로벌 세션 방어막] 데이터 조작/조회 시 무조건 권한 철저히 검증!
            const secureActions = ['ADD', 'EDIT', 'DELETE', 'DONE', 'UNDO_DONE', 'ADD_QTY', 'UPDATE_ORDER', 'MULTI_DELETE', 'MULTI_DONE', 'MULTI_UNDO_DONE', 'CREATE_ADMIN', 'DELETE_ADMIN', 'REACTIVATE_ADMIN', 'HARD_DELETE_ADMIN', 'RESET_ADMIN_PW', 'CHANGE_MY_PASSWORD', 'UPDATE_RAW_ROW_FULL', 'ADD_RAW_ROW_DIRECT', 'DELETE_RAW_ROW_DIRECT', 'SAVE_COMP_INFO_DB', 'SAVE_GLOBAL_COLOR', 'GET_ALL_CONN_LOGS']; 
            // 👆 맨 끝에 'GET_ALL_CONN_LOGS' 추가 완료
            
            // ... (기존 코드)
            if (secureActions.includes(action)) {
                if (!admin_id) { return res.status(200).json({ success: false, forceLogout: true, msg: '로그인 세션이 만료되었거나 유효하지 않습니다.' }); }
                const [sessionCheck] = await pool.query("SELECT status FROM admins WHERE admin_id = ?", [admin_id]);
                if (sessionCheck.length === 0 || sessionCheck[0].status === 'LOCKED') { return res.status(200).json({ success: false, forceLogout: true, msg: '관리자에 의해 계정이 비활성화되었습니다.' }); }
            }
            // 👆 기존 방어막 종료 부분

            // 👇 🚨 [신규 1] 사이트 접속 트래킹 저장 (GUEST, AUTO_LOGIN) 👇
            if (action === 'LOG_SITE_ACCESS') {
                try {
                    // 접속자 IP 추출 (프록시 환경 고려)
                    let ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'IP 알수없음';
                    if (ip.includes(',')) ip = ip.split(',')[0]; 
                    
                    const { admin_id, access_type, description } = payload;
                    
                    // 👉 description에 수동 로그인처럼 IP를 강제로 붙여버리자!
                    let finalDesc = `IP: ${ip} | ${description}`;

                    await pool.query(
                        "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, ?, ?, ?)", 
                        [admin_id || 'GUEST', access_type || 'GUEST', finalDesc, ip]
                    );
                    return res.status(200).json({ success: true });
                } catch (e) {
                    console.error("접속 로그 기록 에러:", e);
                    return res.status(200).json({ success: false, msg: e.message });
                }
            }

            // 👇 🚨 [신규 3] 로그아웃 기록 저장 👇
            else if (action === 'LOG_LOGOUT') {
                try {
                    let ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'IP 알수없음';
                    if (ip.includes(',')) ip = ip.split(',')[0]; 
                    
                    const { admin_id } = payload;
                    
                    if (admin_id) {
                        await pool.query(
                            "INSERT INTO admin_audit_logs (admin_id, action_type, description, ip_address) VALUES (?, 'LOGOUT', '시스템에서 정상적으로 로그아웃했습니다.', ?)", 
                            [admin_id, ip]
                        );
                    }
                    return res.status(200).json({ success: true });
                } catch (e) {
                    console.error("로그아웃 기록 에러:", e);
                    return res.status(200).json({ success: false, msg: e.message });
                }
            }

            // 👇 🚨 [신규 2] 전체 접속 로그만 쏙 뽑아오는 조회 엔진 👇
            else if (action === 'GET_ALL_CONN_LOGS') {
                try {
                    const limit = parseInt(payload.limit) || 100;
                    const page = parseInt(payload.page) || 1;
                    const offset = (page - 1) * limit;
                    const keyword = payload.keyword || '';

                    // 💡 핵심: 기존 테이블에서 로그인/접속 관련 로그만 필터링해서 가져옴
                    let queryStr = "SELECT admin_id, action_type, description, ip_address, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE action_type IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
                    let countQueryStr = "SELECT COUNT(*) as cnt FROM admin_audit_logs WHERE action_type IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
                    let params = [];

                    if (keyword) {
                        const subClause = " AND (LOWER(admin_id) LIKE LOWER(?) OR LOWER(action_type) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))";
                        queryStr += subClause; countQueryStr += subClause;
                        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
                    }

                    queryStr += " ORDER BY id DESC LIMIT ? OFFSET ?";
                    let queryParams = [...params, limit, offset];

                    const [rows] = await pool.query(queryStr, queryParams);
                    const [countRows] = await pool.query(countQueryStr, params);
                    const totalCount = countRows[0].cnt;

                    return res.status(200).json({
                        success: true,
                        logs: rows,
                        totalCount: totalCount,
                        page: page,
                        totalPages: Math.ceil(totalCount / limit)
                    });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }
            // 👆 ---------------------------------------------------- 👆

            // 🆕 A. 신규 관리자 계정 추가
            else if (action === 'CREATE_ADMIN') {
            // ... (기존 코드 계속)
                try {
                    const { id, name, pw } = data;
                    const [exist] = await pool.query("SELECT admin_id FROM admins WHERE admin_id = ?", [id]);
                    if (exist.length > 0) return res.status(200).json({ success: false, msg: '이미 등록된 아이디입니다.' });
                    const hashedPw = await bcrypt.hash(pw, 10); // ✅ bcrypt 해시화
                    await pool.query("INSERT INTO admins (admin_id, password_hash, admin_name, role, status) VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')", [id, pw, name]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CREATE_ADMIN', ?)", [currentAdmin, `새로운 관리자 계정 발급: ${name}(${id})`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 👤 관리자 리스트 조회 (🚨 기존 GET_ADMIN_LIST를 이걸로 교체! status 컬럼을 가져와야 함)
            else if (action === 'GET_ADMIN_LIST') {
                try {
                    // status 값을 가져와야 잠겼는지 활성 상태인지 프론트에서 구분 가능
                    const [rows] = await pool.query("SELECT admin_id, admin_name, role, status FROM admins ORDER BY created_at ASC");
                    return res.status(200).json({ success: true, list: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // ♻️ 관리자 계정 복구 (LOCKED -> ACTIVE)
            else if (action === 'REACTIVATE_ADMIN') {
                try {
                    const { id } = data;
                    const currentAdmin = payload.admin_id || 'SYSTEM'; 
                    await pool.query("UPDATE admins SET status = 'ACTIVE' WHERE admin_id = ?", [id]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'REACTIVATE_ADMIN', ?)", [currentAdmin, `관리자 계정 활성화 복구: ${id}`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 💥 관리자 계정 완전 삭제 (DB에서 영구 파기)
            else if (action === 'HARD_DELETE_ADMIN') {
                try {
                    const { id } = data;
                    const currentAdmin = payload.admin_id || 'SYSTEM'; 
                    
                    if (id === 'admin' || id === 'silverscent') {
                        return res.status(200).json({ success: false, msg: '마스터 계정은 파기할 수 없습니다.' });
                    }
                    if (id === currentAdmin) {
                        return res.status(200).json({ success: false, msg: '현재 접속 중인 본인 계정은 삭제할 수 없습니다.' });
                    }

                    await pool.query("DELETE FROM admins WHERE admin_id = ?", [id]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'HARD_DELETE_ADMIN', ?)", [currentAdmin, `관리자 계정 DB 완전 파기: ${id}`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🗑️ C. 관리자 계정 비활성화 (요구사항 3번 완벽 해결)
            else if (action === 'DELETE_ADMIN') {
                try {
                    const { id } = data;
                    const currentAdmin = payload.admin_id || 'SYSTEM'; // 현재 로그인한 사람의 세션 ID

                    // 방어막 1: 마스터 계정은 그 누구도 비활성화 불가
                    if (id === 'admin' || id === 'silverscent') {
                        return res.status(200).json({ success: false, msg: '마스터 계정은 보안상 비활성화할 수 없습니다.' });
                    }
                    
                    // 방어막 2: 현재 로그인 중인 '자기 자신'을 바보같이 셀프 차단하는 것만 방어!
                    if (String(id).trim().toLowerCase() === String(currentAdmin).trim().toLowerCase()) {
                        return res.status(200).json({ success: false, msg: '현재 접속 중인 본인 계정은 비활성화할 수 없습니다.' });
                    }

                    // DB ENUM 규칙에 맞춰 상태를 'LOCKED'로 변경 (소프트 삭제)
                    await pool.query("UPDATE admins SET status = 'LOCKED' WHERE admin_id = ?", [id]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DELETE_ADMIN', ?)", [currentAdmin, `관리자 계정 비활성화 처리: ${id}`]);
                    
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🔒 [신규 추가] 6번 요구사항: 본인 비밀번호 다이렉트 변경 엔진
            else if (action === 'CHANGE_MY_PASSWORD') {
                try {
                    const currentAdmin = payload.admin_id;
                    const { currentPw, newPw } = data;

                    if (!currentAdmin) return res.status(200).json({ success: false, msg: '로그인 세션이 만료되었습니다.' });

                    // 1. 현재 비밀번호가 맞는지 DB 검증
                    const [rows] = await pool.query("SELECT password_hash FROM admins WHERE admin_id = ? AND status = 'ACTIVE'", [currentAdmin]);
                    if (rows.length === 0) return res.status(200).json({ success: false, msg: '존재하지 않거나 비활성화된 계정입니다.' });

                     // ✅ bcrypt.compare로 검증 (프론트엔드에서 이미 SHA-256으로 암호화해서 보냈다고 가정)
                    const isMatch = await bcrypt.compare(currentPw, rows[0].password_hash);
                    // 프론트엔드에서 이미 SHA-256으로 암호화해서 보낸 현재 비밀번호와 비교
                    if (!isMatch) {
                        return res.status(200).json({ success: false, msg: '현재 비밀번호가 일치하지 않습니다.' });
                    }
                    // ✅ bcrypt.hash로 저장 (프론트엔드에서 이미 SHA-256으로 암호화된 새 비밀번호를 받아서 bcrypt로 한 번 더 해시화하여 저장)
                    // 2. 새 비밀번호(이것도 프론트에서 암호화되어 옴)로 업데이트
                    const hashedNewPw = await bcrypt.hash(newPw, 10);
                    await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [hashedNewPw, currentAdmin]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CHANGE_PW', '본인 비밀번호 변경 성공')", [currentAdmin]);

                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🔑 비밀번호 강제 초기화 — bcrypt 적용
            else if (action === 'RESET_ADMIN_PW') {
                try {
                    const { targetId, newPw } = data;
                    const hashedNew = await bcrypt.hash(newPw, 10); // ✅ bcrypt 해시화
                    await pool.query("UPDATE admins SET password_hash = ? WHERE admin_id = ?", [hashedNew, targetId]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'RESET_PW', ?)", [currentAdmin, `[${targetId}] 관리자 비밀번호 초기화 완료`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

           // 📜 D. 보안 감사 로그 타임라인 로드 (페이지네이션 + 날짜 범위 + 키워드 검색 엔진 탑재)
            else if (action === 'GET_AUDIT_LOGS') {
                try {
                    const { startDate, endDate, keyword } = payload;
                    const limit = parseInt(payload.limit) || 50;
                    const page = parseInt(payload.page) || 1;
                    const offset = (page - 1) * limit;

                    // 👇 🚨 이렇게 바꿔주시면 접속/로그인 기록은 보안 로그에 절대 나타나지 않습니다! 🚨 👇
                    let queryStr = "SELECT admin_id, action_type, description, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE action_type NOT IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
                    let countQueryStr = "SELECT COUNT(*) as cnt FROM admin_audit_logs WHERE action_type NOT IN ('LOGIN', 'AUTO_LOGIN', 'GUEST', 'LOGOUT')";
                    let params = [];

                    if (startDate) { 
                        const subClause = " AND created_at >= DATE_SUB(?, INTERVAL 9 HOUR)";
                        queryStr += subClause; countQueryStr += subClause; 
                        params.push(startDate + ' 00:00:00'); 
                    }
                    if (endDate) { 
                        const subClause = " AND created_at <= DATE_SUB(?, INTERVAL 9 HOUR)";
                        queryStr += subClause; countQueryStr += subClause; 
                        params.push(endDate + ' 23:59:59'); 
                    }
                    if (keyword) { 
                        // 🚨 [패치] admin_id, description 뿐만 아니라 action_type(액션)까지 검색 대상에 포함!
                        const subClause = " AND (LOWER(admin_id) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?) OR LOWER(action_type) LIKE LOWER(?))";
                        queryStr += subClause; countQueryStr += subClause; 
                        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); 
                    }

                    queryStr += " ORDER BY id DESC LIMIT ? OFFSET ?";
                    let queryParams = [...params, limit, offset];

                    const [rows] = await pool.query(queryStr, queryParams);
                    const [countRows] = await pool.query(countQueryStr, params);
                    const totalCount = countRows[0].cnt;

                    return res.status(200).json({ 
                        success: true, 
                        logs: rows,
                        totalCount: totalCount,
                        page: page,
                        totalPages: Math.ceil(totalCount / limit)
                    });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

            // 🗄️ E. DB 다이렉트 조회 (페이지네이션 + 검색 + 오름/내림차순 정렬 엔진)
            else if (action === 'GET_RAW_DB_ROWS') {
                try {
                    const limit = parseInt(payload.limit) || 20; 
                    const page = parseInt(payload.page) || 1;    
                    const offset = (page - 1) * limit;
                    const filterCol = payload.filterCol || 'all'; 
                    
                    // 🚨 정렬 변수 안전하게 수신
                    const sortCol = /^[a-zA-Z0-9_]+$/.test(payload.sortCol) ? payload.sortCol : 'id';
                    const sortDir = payload.sortDir === 'ASC' ? 'ASC' : 'DESC';

                    // 🚨 [숫자 정렬 핵심 패치] 텍스트로 저장된 숫자 컬럼들을 진짜 숫자로 변환(CAST)하여 정렬!
                    const numericCols = ['id', 'pal', 'box', 'sort_idx', 'isDone', 'pallets', 'is_ai_modified'];
                    const orderClause = numericCols.includes(sortCol) ? `CAST(${sortCol} AS SIGNED)` : sortCol;
                    
                    let rows = []; let countRows = [];
                    let queryStr = ""; let countQueryStr = "";
                    let params = []; let countParams = [];

                    if (type === 'out') {
                        queryStr = "SELECT id, company, pal, box, outbound_date, etc, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at, sort_idx, isDone FROM outbound";
                        countQueryStr = "SELECT COUNT(*) as cnt FROM outbound";
                        let whereClauses = [];
                        if (keyword) {
                            if (filterCol === 'name') { whereClauses.push("company LIKE ?"); params.push(`%${keyword}%`); }
                            else if (filterCol === 'date') { whereClauses.push("outbound_date LIKE ?"); params.push(`%${keyword}%`); }
                            else { whereClauses.push("(company LIKE ? OR outbound_date LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
                        }
                        if (whereClauses.length > 0) {
                            const whereStr = " WHERE " + whereClauses.join(" AND ");
                            queryStr += whereStr; countQueryStr += whereStr;
                            countParams = [...params];
                        }
                        // 🚨 수정된 orderClause 적용
                        queryStr += ` ORDER BY ${orderClause} ${sortDir} LIMIT ? OFFSET ?`;
                        params.push(limit, offset);
                    } else {
                        queryStr = "SELECT id, bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, DATE_ADD(last_updated, INTERVAL 9 HOUR) AS last_updated, sort_idx, status, is_ai_modified FROM inbound";
                        countQueryStr = "SELECT COUNT(*) as cnt FROM inbound";
                        let whereClauses = [];
                        if (keyword) {
                            if (filterCol === 'name') { whereClauses.push("bl_number LIKE ?"); params.push(`%${keyword}%`); }
                            else if (filterCol === 'date') { whereClauses.push("receive_date LIKE ?"); params.push(`%${keyword}%`); }
                            else { whereClauses.push("(bl_number LIKE ? OR receive_date LIKE ?)"); params.push(`%${keyword}%`, `%${keyword}%`); }
                        }
                        if (whereClauses.length > 0) {
                            const whereStr = " WHERE " + whereClauses.join(" AND ");
                            queryStr += whereStr; countQueryStr += whereStr;
                            countParams = [...params];
                        }
                        // 🚨 수정된 orderClause 적용
                        queryStr += ` ORDER BY ${orderClause} ${sortDir} LIMIT ? OFFSET ?`;
                        params.push(limit, offset);
                    }
                    
                    [rows] = await pool.query(queryStr, params);
                    [countRows] = await pool.query(countQueryStr, countParams);
                    const totalCount = countRows[0].cnt;
                    
                    return res.status(200).json({ success: true, rows: rows, totalCount: totalCount, page: page, totalPages: Math.ceil(totalCount / limit) });
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

            // 🆕 [신규 추가 기능] DB 제어실에서 원본 데이터 다이렉트 주입
            else if (action === 'ADD_RAW_ROW_DIRECT') {
                try {
                    if (type === 'out') {
                        const { company, pal, box, outbound_date, etc, sort_idx, isDone } = payload.insertData;
                        await pool.query(
                            "INSERT INTO outbound (company, pal, box, outbound_date, etc, sort_idx, isDone) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            [company || '', pal || 0, box || 0, safeDate(outbound_date), etc || '', sort_idx || 999, isDone || 0]
                        );
                    } else {
                        const { bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, sort_idx, status, is_ai_modified } = payload.insertData;
                        await pool.query(
                            "INSERT INTO inbound (bl_number, pallets, eta, receive_date, fwd, s_type, invoice, remarks, sort_idx, status, is_ai_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            [bl_number || '', pallets || 0, safeDate(eta), safeDate(receive_date), fwd || '', s_type || '', invoice || '', remarks || '', sort_idx || 999, status || '입고대기', is_ai_modified || 0]
                        );
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'DB_RAW_ADD', ?)", [currentAdmin, `[DB 제어실] ${type === 'out' ? '출고' : '입고'} 신규 데이터 직접 주입`]);
                    return res.status(200).json({ success: true });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
            }

// ✅ 로그인 로직 (SYSTEM 권한 전용 마스터 패스 + 최근 로그인 일시 업데이트 완전 통합본)
else if (action === 'LOGIN') {
    try {
        const { id, pw } = data; // 프론트엔드에서 전송된 ID와 암호 해시값
        
        // 1. IP 추출 및 프록시 환경 정제 (안전한 다중 인프라 대응)
        let ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.connection?.remoteAddress || 'IP 알수없음';
        if (ip.includes(',')) {
            ip = ip.split(',')[0].trim();
        }

        // 2. 기기 및 브라우저 정보 분석 (기존의 상세 기기 추적 기능)
        const ua = req.headers['user-agent'] || '';
        let os = 'PC';
        if (/android/i.test(ua)) os = 'Android';
        else if (/ipad|iphone|ipod/i.test(ua)) os = 'iOS';
        else if (/mac os/i.test(ua)) os = 'Mac';
        else if (/windows/i.test(ua)) os = 'Windows';
        
        let browser = '알수없음';
        if (/edg/i.test(ua)) browser = 'Edge';
        else if (/chrome/i.test(ua)) browser = 'Chrome';
        else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
        else if (/firefox/i.test(ua)) browser = 'Firefox';
        else if (/kakao/i.test(ua)) browser = 'KakaoTalk';
        else if (/naver/i.test(ua)) browser = 'NaverApp';

        const connInfoBase = `기기: ${os} | 브라우저: ${browser}`;

        // [보안 1단계] 최근 10분간 해당 IP와 ID 조합으로 실패한 이력 카운트 조회 (대소문자 무시)
        const [failCountRows] = await pool.query(
            `SELECT COUNT(*) as cnt FROM admin_audit_logs 
             WHERE ip_address = ? AND LOWER(admin_id) = LOWER(?) AND action_type = 'LOGIN_FAILED' 
               AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
            [ip, id]
        );
        const failCount = failCountRows[0].cnt;

        // [보안 2단계] 5회 이상 연속 실패로 해당 ID-IP 조합이 잠긴 상태인 경우
        if (failCount >= 5) {
            // 입력한 ID로 계정 정보 조회
            const [masterCheck] = await pool.query(
                "SELECT admin_id, password_hash, admin_name, role, status FROM admins WHERE LOWER(admin_id) = LOWER(?)", 
                [id]
            );
            
            // ✅ bcrypt.compare로 마스터 검증
                        const masterMatch = masterCheck.length > 0 ? await bcrypt.compare(pw, masterCheck[0].password_hash) : false;
            // 👑 오직 최고관리자('SYSTEM') 권한을 가졌고, 진짜 비밀번호를 맞췄을 때만 비상 우회 통과
            if (
                masterCheck.length > 0 && 
                masterMatch &&
                masterCheck[0].status === 'ACTIVE' &&
                masterCheck[0].role === 'SYSTEM' // 👈 오직 나(SYSTEM)만 이 문을 열 수 있습니다.
            ) {
                
                // 최근 로그인 일시 업데이트
                await pool.query("UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?", [masterCheck[0].admin_id]);

                // 우회 성공 로그 기록
                const connInfo = `[👑 최고관리자 잠금 우회 성공] IP: ${ip} | ${connInfoBase}`;
                await pool.query(
                    "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_SUCCESS', ?)",
                    [ip, masterCheck[0].admin_id, connInfo]
                );
                
                return res.status(200).json({ 
                    success: true, 
                    admin_id: masterCheck[0].admin_id, 
                    name: masterCheck[0].admin_name, 
                    role: masterCheck[0].role,
                    msg: "비상 우회 통로로 안전하게 로그인되었습니다."
                });
            }

            // 일반 관리자('ADMIN') 계정이거나 암호가 틀린 해커는 예외 없이 10분간 원천 차단
            return res.status(200).json({ 
                success: false, 
                msg: "⚠️ 비밀번호 5회 실패로 로그인이 임시 제한되었습니다. 10분 후 다시 시도하세요." 
            });
        }

        // [보안 3단계] 일반 검증 흐름 (대소문자 무시 및 기존 구조 유지)
        const [rows] = await pool.query(
            "SELECT admin_id, password_hash, admin_name, role, status FROM admins WHERE LOWER(admin_id) = LOWER(?)", 
            [id]
        );

        // ID가 존재하지 않는 경우 처리
        if (rows.length === 0) {
            await pool.query(
                "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_FAILED', ?)",
                [ip, id, `[존재하지 않는 ID 로그인 시도] IP: ${ip} | ${connInfoBase}`]
            );
            return res.status(200).json({ success: false, msg: '아이디 또는 비밀번호가 틀립니다.' });
        }

        const user = rows[0];

        // 비활성화 계정은 비밀번호 검증 전 즉시 전용 메시지 리턴
        if (user.status === 'LOCKED') {
            return res.status(200).json({ success: false, msg: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
        }

        // 비밀번호 해시 검증
        if (user.password_hash === pw) {
            
            // 로그인 성공 시 최근 로그인 일시 업데이트
            await pool.query("UPDATE admins SET last_login_at = NOW() WHERE admin_id = ?", [user.admin_id]);

            // 로그인 성공 로그 기록
            const connInfo = `[접속성공] IP: ${ip} | ${connInfoBase}`;
            await pool.query(
                "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_SUCCESS', ?)",
                [ip, user.admin_id, connInfo]
            );

            return res.status(200).json({ 
                success: true, 
                admin_id: user.admin_id, 
                name: user.admin_name, 
                role: user.role 
            });
        } else {
            // 비밀번호 실패 로그 기록 -> 이 데이터가 쌓여 10분간 자동 잠금을 제어합니다.
            const connInfo = `[비밀번호 틀림] IP: ${ip} | ${connInfoBase}`;
            await pool.query(
                "INSERT INTO admin_audit_logs (ip_address, admin_id, action_type, description) VALUES (?, ?, 'LOGIN_FAILED', ?)",
                [ip, user.admin_id, connInfo]
            );

            return res.status(200).json({ 
                success: false, 
                msg: `❌ 비밀번호가 일치하지 않습니다. (현재 10분 내 연속 실패: ${failCount + 1}회 / 5회 실패 시 10분간 자동 잠금)` 
            });
        }

    } catch (error) {
        console.error("🔥 로그인 내부 처리 오류:", error);
        return res.status(200).json({ success: false, msg: '로그인 처리 중 오류가 발생했습니다.' });
    }
}
            
            // 👤 H. [신규] 특정 관리자 접속(로그인) 이력 전용 조회 엔진
            else if (action === 'GET_ADMIN_CONN_LOGS') {
                try {
                    const { targetId } = data;
                    // 최근 로그인 기록 15개를 시간 역순으로 로드
                    const [rows] = await pool.query(
                        "SELECT description, DATE_ADD(created_at, INTERVAL 9 HOUR) AS created_at FROM admin_audit_logs WHERE admin_id = ? AND action_type IN ('LOGIN', 'AUTO_LOGIN', 'LOGOUT') ORDER BY id DESC LIMIT 15",
                        [targetId]
                    );
                    return res.status(200).json({ success: true, logs: rows });
                } catch (e) { return res.status(200).json({ success: false, msg: e.message }); }
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
            
            
            else if (action === 'GET_COMP_INFO_DB') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'COMP_INFO_DB'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : {}); }
            else if (action === 'SAVE_COMP_INFO_DB') { const jsonStr = JSON.stringify(data); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('COMP_INFO_DB', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            // 👇 🚨 [여기에 추가하세요!] OCR 동적 필터 저장/불러오기 API
            else if (action === 'GET_OCR_FILTERS') { const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = 'OCR_ETC_FILTERS'`); return res.status(200).json(rows.length > 0 ? parseJSON(rows[0].setting_value) : []); }
            else if (action === 'SAVE_OCR_FILTERS') { const jsonStr = JSON.stringify(data); await pool.query(`INSERT INTO system_settings (setting_key, setting_value) VALUES ('OCR_ETC_FILTERS', ?) ON DUPLICATE KEY UPDATE setting_value = ?`, [jsonStr, jsonStr]); return res.status(200).json({ success: true }); }
            // 👆 ----------------------------------------------------
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

            // ✅ 3. 입/출고 데이터 처리 (원본 로직 완벽 보존 + 구체적 수치 로그)
            else if (domain === 'out') {
                const targetName = data?.oldComp;
                const newName = data?.newComp || targetName;
                const targetDate = data?.oldDate === '미정' ? null : data?.oldDate;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;
                const targetPal = data?.oldPal || '';
                const targetBox = data?.oldBox || '';

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    const statName = action === 'DONE' ? '✅ 완료' : '⏳ 대기(취소)';
                    await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [action === 'DONE' ? 1 : 0, targetName, targetDate, targetPal, targetBox]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)", [currentAdmin, `[출고 상태] ${targetName} ➡️ ${statName} (PL:${targetPal || 0}, BOX:${targetBox || 0})`]);
                } else if (action === 'DELETE') {
                    await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [targetName, targetDate, targetPal, targetBox]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)", [currentAdmin, `[출고 삭제] ${targetName} (PL:${targetPal || 0}, BOX:${targetBox || 0}) 파기`]);
                } else if (action === 'EDIT') {
                    await pool.query(`UPDATE outbound SET outbound_date = ?, company = ?, pal = ?, box = ?, etc = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`,
                        [newDate, newName, data?.newPal || '', data?.newBox || '', data?.newEtc || '', targetName, targetDate, targetPal, targetBox]);
                    
                    // 🚨 [스마트 로그 패치] 실제로 변경된 항목만 추출해서 로그 기록
                    let changes = [];
                    const oldD = targetDate || '미정'; const newD = newDate || '미정';
                    if (oldD !== newD) changes.push(`날짜: ${oldD} ➡️ ${newD}`);
                    if (targetName !== newName) changes.push(`업체: ${targetName} ➡️ ${newName}`);
                    
                    const oldP = targetPal || 0; const newP = data?.newPal || 0;
                    if (String(oldP) !== String(newP)) changes.push(`PL: ${oldP} ➡️ ${newP}`);
                    
                    const oldB = targetBox || 0; const newB = data?.newBox || 0;
                    if (String(oldB) !== String(newB)) changes.push(`BOX: ${oldB} ➡️ ${newB}`);
                    
                    let detailStr = changes.length > 0 ? changes.join(', ') : '비고/텍스트 변경';
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", 
                        [currentAdmin, `[출고 수정] ${targetName} (${detailStr})`]);
                } else if (action === 'ADD_QTY') {  // 👈 🚨 여기에 이 블록을 통째로 추가하세요!
                    // [출고 수량추가] 버튼 클릭 시 DB 원본에 합산 및 비고(etc) 업데이트
                    const addPal = parseInt(data?.addPal) || 0;
                    const addBox = parseInt(data?.addBox) || 0;
                    
                    // 프론트엔드와 100% 동일한 히스토리 글씨 생성 (예: [5/17 1P 10B 추가])
                    const histDate = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
                    const addPalStr = data?.addPal ? data.addPal + "P" : "";
                    const addBoxStr = data?.addBox ? data.addBox + "B" : "";
                    const spaceStr = (data?.addPal && data?.addBox) ? " " : "";
                    const histStr = `[${histDate} ${addPalStr}${spaceStr}${addBoxStr} 추가]`;

                    // 🚨 [안전장치] ID가 있으면 고유 ID로, 없으면 이름/날짜/수량으로 해당 일정을 정확히 찾아옵니다.
                    let queryStr = "";
                    let params = [];
                    if (data?.id) {
                        queryStr = `SELECT id, pal, box, etc FROM outbound WHERE id = ? LIMIT 1`;
                        params = [data.id];
                    } else {
                        queryStr = `SELECT id, pal, box, etc FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ? LIMIT 1`;
                        params = [targetName, targetDate, targetPal, targetBox];
                    }

                    const [rows] = await pool.query(queryStr, params);

                    if (rows.length > 0) {
                        let row = rows[0];
                        // 원본 수량에 방금 입력한 추가 수량을 더함
                        let newPal = (parseInt(row.pal) || 0) + addPal;
                        let newBox = (parseInt(row.box) || 0) + addBox;
                        // 원본 비고란 텍스트 맨 뒤에 추가 히스토리 글씨를 이어붙임
                        let newEtc = (row.etc && row.etc.trim() !== "") ? row.etc.trim() + " " + histStr : histStr;

                        // DB 실제 업데이트 및 보안 로그 작성
                        await pool.query(`UPDATE outbound SET pal = ?, box = ?, etc = ? WHERE id = ?`, [newPal, newBox, newEtc, row.id]);
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", 
                            [currentAdmin, `[출고 수량추가] ${targetName} (+PL:${addPal}, +BOX:${addBox})`]);
                    }
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
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `[출고 병합] ${reqComp} ➡️ 덮어쓰기 완료 (PL:${reqPalOut || 0}, BOX:${reqBoxOut || 0})`]);
                    } else {
                        await pool.query(`INSERT INTO outbound (company, pal, box, outbound_date, isDone, etc) VALUES (?, ?, ?, ?, 0, ?)`, [reqComp, reqPalOut, reqBoxOut, reqDateOut, reqEtcOut]); 
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)", [currentAdmin, `[출고 등록] ${reqComp} 신규 추가 (PL:${reqPalOut || 0}, BOX:${reqBoxOut || 0})`]);
                    }
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    let moveCount = 0;
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            moveCount++;
                            if (item.id) {
                                await pool.query(`UPDATE outbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            } else {
                                await pool.query(`UPDATE outbound SET sort_idx = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [item.sortIdx, item.company, tDate, item.pal, item.box]);
                            }
                        }
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)", [currentAdmin, `[출고 정렬] 화면 드래그 순서 변경 (${moveCount}건 이동)`]);
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`DELETE FROM outbound WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [it.comp, tDate, it.pal, it.box]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)", [currentAdmin, `[출고 다중삭제] ${data.items.length}건 일괄 파기`]);
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const isDoneVal = action === 'MULTI_DONE' ? 1 : 0;
                    const statName = action === 'MULTI_DONE' ? '✅ 완료' : '⏳ 대기(취소)';
                    for (const it of data.items) {
                        const tDate = it.dateStr === '미정' ? null : it.dateStr;
                        await pool.query(`UPDATE outbound SET isDone = ? WHERE company = ? AND outbound_date <=> ? AND pal = ? AND box = ?`, [isDoneVal, it.comp, tDate, it.pal, it.box]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)", [currentAdmin, `[출고 다중상태] ${data.items.length}건 ➡️ ${statName} 처리`]);
                }
                return res.status(200).json({ success: true, msg: '작업 완료' });
            } 
            // 🎯 [여기서부터 복사해서 새로 붙여넣으세요!] -----------------------------------------
            else if (action === 'GET_LAST_OCR_DATA' || action === 'getLastOcrData') {
    try {
        const [rows] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'LAST_OCR_DATA'");
        const [rawRows] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = 'LAST_OCR_RAW'");

        const parsedDataStr = rows[0] ? rows[0].setting_value : "[]";
        let rawDataStr = rawRows[0] ? rawRows[0].setting_value : "";

        // 🎯 [핵심 버그 수정 포인트] 
        // 텔레그램에서 JSON.stringify()로 감싸서 넣었기 때문에 앞뒤에 붙은 큰따옴표(")와 
        // 줄바꿈 이스케이프(\n)를 안전하게 정형화해주어야 합니다.
        if (rawDataStr) {
            try {
                // 저장된 값이 JSON 형태의 문자열("...텍스트...")이므로 풀어서 순수 글자로 복원합니다.
                rawDataStr = JSON.parse(rawDataStr); 
            } catch(e) {
                // 만약 일반 텍스트 상태로 들어가 있더라도 에러 없이 털어내도록 방어막을 칩니다.
                rawDataStr = rawRows[0].setting_value; 
            }
        }

        if (!rawDataStr) {
            rawDataStr = "가져온 Raw 데이터가 존재하지 않습니다.";
        }

        // 프론트엔드로 최종 배달
        return res.status(200).json({
            parsedData: parseJSON(parsedDataStr), // 기존 파싱 배열 객체
            rawData: rawDataStr                  // 완벽히 복원된 순수 원본 텍스트
        });
    } catch (err) {
        console.error("OCR 데이터 조회 에러:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
}


            else {
                const targetBL = data?.oldBL || '알수없음';
                const newName = data?.newComp || data?.newBL;
                const newDate = data?.newDate === '미정' ? null : data?.newDate;

                if (action === 'DONE' || action === 'UNDO_DONE') {
                    const statusVal = action === 'DONE' ? '완료' : '입고대기';
                    const statName = action === 'DONE' ? '✅ 완료' : '⏳ 대기(취소)';
                    if (data?.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, data.id]);
                    else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_STATUS', ?)", [currentAdmin, `[입고 상태] ${targetBL} ➡️ ${statName}`]);
                } else if (action === 'DELETE') {
                    if (data?.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [data.id]);
                    else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_DELETE', ?)", [currentAdmin, `[입고 삭제] ${targetBL} 파기`]);
                } else if (action === 'EDIT') {
                    if (data?.id) {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE id=?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data.id]);
                    } else {
                        await pool.query(`UPDATE inbound SET receive_date=?, bl_number=?, pallets=?, remarks=?, s_type=?, fwd=?, invoice=? WHERE bl_number=? AND receive_date<=>?`, 
                            [newDate, newName, data?.newPal||'', data?.newEtc||'', data?.newSType||'', data?.newFwd||'', data?.newInvoice||'', data?.oldBL, data?.oldDate === '미정' ? null : data?.oldDate]);
                    }

                    // 🚨 [스마트 로그 패치] 입고 변경사항 정밀 추적
                    let changes = [];
                    const oldD = data?.oldDate || '미정'; const newD = newDate || '미정';
                    if (oldD !== newD) changes.push(`날짜: ${oldD} ➡️ ${newD}`);
                    if (targetBL !== newName) changes.push(`B/L: ${targetBL} ➡️ ${newName}`);
                    
                    const newP = data?.newPal || 0;
                    changes.push(`최종수량: PL ${newP}`); // 입고는 원본 수량을 항상 들고오지 않으므로 최종 저장된 수량 표기
                    
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", 
                        [currentAdmin, `[입고 수정] ${targetBL} (${changes.join(', ')})`]);
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
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_EDIT', ?)", [currentAdmin, `[입고 병합] ${reqBl} ➡️ 덮어쓰기 완료 (PL:${reqPal || 0})`]);
                    } else {
                        await pool.query(`INSERT INTO inbound (bl_number, pallets, receive_date, status, remarks, s_type, fwd, invoice, is_ai_modified) VALUES (?, ?, ?, '입고대기', ?, ?, ?, ?, 1)`, 
                            [reqBl, reqPal, reqDate, reqEtc, reqSType, reqFwd, reqInvoice]);
                        await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_ADD', ?)", [currentAdmin, `[입고 등록] ${reqBl} 신규 추가 (PL:${reqPal || 0})`]);
                    }
                } else if (action === 'UPDATE_ORDER' && data?.dailyOrders) {
                    let moveCount = 0;
                    for (const [dateStr, orderList] of Object.entries(data.dailyOrders)) {
                        let tDate = dateStr === '미정' ? null : dateStr;
                        for (const item of orderList) {
                            moveCount++;
                            if (item.id) await pool.query(`UPDATE inbound SET sort_idx = ? WHERE id = ?`, [item.sortIdx, item.id]);
                            else await pool.query(`UPDATE inbound SET sort_idx = ? WHERE bl_number = ? AND receive_date <=> ? AND pallets = ?`, [item.sortIdx, item.company, tDate, item.pal]);
                        }
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_SORT', ?)", [currentAdmin, `[입고 정렬] 화면 드래그 순서 변경 (${moveCount}건 이동)`]);
                } else if (action === 'MULTI_DELETE' && data?.items) {
                    for (const it of data.items) {
                        if (it.id) await pool.query(`DELETE FROM inbound WHERE id = ?`, [it.id]);
                        else await pool.query(`DELETE FROM inbound WHERE bl_number = ? AND receive_date <=> ?`, [it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_DEL', ?)", [currentAdmin, `[입고 다중삭제] ${data.items.length}건 일괄 파기`]);
                } else if ((action === 'MULTI_DONE' || action === 'MULTI_UNDO_DONE') && data?.items) {
                    const statusVal = action === 'MULTI_DONE' ? '완료' : '입고대기';
                    const statName = action === 'MULTI_DONE' ? '✅ 완료' : '⏳ 대기(취소)';
                    for (const it of data.items) {
                        if (it.id) await pool.query(`UPDATE inbound SET status = ? WHERE id = ?`, [statusVal, it.id]);
                        else await pool.query(`UPDATE inbound SET status = ? WHERE bl_number = ? AND receive_date <=> ?`, [statusVal, it.bl, it.dateStr === '미정' ? null : it.dateStr]);
                    }
                    await pool.query("INSERT INTO admin_audit_logs (admin_id, action_type, description) VALUES (?, 'CAL_MULTI_STAT', ?)", [currentAdmin, `[입고 다중상태] ${data.items.length}건 ➡️ ${statName} 처리`]);
                }
                return res.status(200).json({ success: true, msg: '작업 완료' });
            }
        }
    } catch (error) {
        console.error("🔥 API 에러:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};