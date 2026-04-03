/**
 * setup-db.js — สร้างตารางฐานข้อมูลครั้งแรกบน production server
 * รัน: node setup-db.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = await mysql.createPool({
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASS     || '',
    database: process.env.DB_NAME     || 'botline',
  });

  console.log('เชื่อมต่อ MySQL สำเร็จ');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups_config (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      group_id     VARCHAR(100) NOT NULL UNIQUE,
      name         VARCHAR(200) NOT NULL DEFAULT 'ไม่ทราบชื่อ',
      status       ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      enabled      TINYINT(1) NOT NULL DEFAULT 1,
      save_text    TINYINT(1) NOT NULL DEFAULT 1,
      save_images  TINYINT(1) NOT NULL DEFAULT 1,
      save_files   TINYINT(1) NOT NULL DEFAULT 1,
      ai_caption   TINYINT(1) NOT NULL DEFAULT 1,
      ai_model     VARCHAR(150) NOT NULL DEFAULT '',
      ai_chat      TINYINT(1) NOT NULL DEFAULT 1,
      ai_equipment TINYINT(1) NOT NULL DEFAULT 1,
      added_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ ตาราง groups_config');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          BIGINT AUTO_INCREMENT PRIMARY KEY,
      message_id  VARCHAR(100) NOT NULL UNIQUE,
      group_id    VARCHAR(100) NOT NULL,
      sender_id   VARCHAR(100) NOT NULL DEFAULT '',
      type        ENUM('text','image','file') NOT NULL,
      text        TEXT,
      file_path   VARCHAR(500),
      file_name   VARCHAR(300),
      caption     TEXT,
      timestamp   BIGINT NOT NULL,
      INDEX idx_group (group_id),
      INDEX idx_group_ts (group_id, timestamp DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ ตาราง messages');

  await pool.query(`
    CREATE FULLTEXT INDEX IF NOT EXISTS ft_caption ON messages (caption, text)
  `).catch(() => {
    // อาจ exist แล้ว ข้ามได้
  });

  await pool.end();
  console.log('\nสร้างตารางเสร็จแล้ว พร้อมใช้งาน!');
}

main().catch(e => { console.error(e); process.exit(1); });
