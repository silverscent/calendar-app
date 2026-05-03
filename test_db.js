require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConnection() {
    try {
        console.log("⏳ TiDB 클러스터에 연결 시도 중...");
        
        const pool = mysql.createPool({
            uri: process.env.DATABASE_URL,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        const [rows] = await pool.query('SELECT 1 + 1 AS solution');
        console.log("✅ TiDB 연결 성공! (Ping Test OK)");
        console.log("➡️ 쿼리 테스트 결과 (1+1):", rows[0].solution);

        const [columns] = await pool.query('DESCRIBE inbound');
        console.log("\n📦 [inbound] 테이블 컬럼 정보 정상 로드 완료:");
        columns.forEach(col => console.log(` - ${col.Field} (${col.Type})`));

        process.exit(0);
    } catch (error) {
        console.error("❌ DB 연결 실패! 에러 로그를 확인하세요:");
        console.error(error);
        process.exit(1);
    }
}

testConnection();