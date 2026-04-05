import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import fs from 'fs';
import path from 'path';
import webhookRouter from './webhook';
import dashboardRouter from './routes/dashboard';
import authRouter from './routes/auth';
import downloadRouter from './routes/download';
import { client } from './services/lineClient';
import logger from './utils/logger';
import pool from './services/db';
import { getAllGroups, updateGroup } from './services/groupConfig';

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      \`key\`  VARCHAR(100) PRIMARY KEY,
      \`value\` TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `).catch(() => {});

  const migrations = [
    `CREATE TABLE IF NOT EXISTS group_operators (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      group_id     VARCHAR(100) NOT NULL,
      line_user_id VARCHAR(100) NOT NULL,
      display_name VARCHAR(200) NOT NULL DEFAULT '',
      can_manage   TINYINT(1) NOT NULL DEFAULT 0,
      added_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_group_user (group_id, line_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `ALTER TABLE groups_config ADD COLUMN reply_images     TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE groups_config ADD COLUMN reply_files      TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE groups_config ADD COLUMN welcome_enabled  TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE groups_config ADD COLUMN welcome_text     TEXT`,
    `ALTER TABLE groups_config ADD COLUMN welcome_image_url VARCHAR(500) DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN file_size BIGINT NULL`,
    `ALTER TABLE groups_config ADD COLUMN expires_at DATETIME NULL`,
    `ALTER TABLE groups_config ADD COLUMN save_videos  TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE groups_config ADD COLUMN reply_videos TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE messages MODIFY COLUMN type ENUM('text','image','file','video') NOT NULL`,
    `ALTER TABLE groups_config ADD COLUMN storage_limit_gb DECIMAL(10,2) NULL`,
  ];
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }
  // อัปเดต file_size ของรูปภาพ/วิดีโอเก่าที่ไม่มีขนาดไฟล์
  try {
    const [nullRows] = await pool.query<any[]>(
      `SELECT message_id, file_path FROM messages
       WHERE file_size IS NULL AND file_path IS NOT NULL LIMIT 2000`
    );
    let fixed = 0;
    for (const row of nullRows) {
      if (row.file_path && fs.existsSync(row.file_path)) {
        const size = fs.statSync(row.file_path).size;
        if (size > 0) {
          await pool.query('UPDATE messages SET file_size = ? WHERE message_id = ?', [size, row.message_id]);
          fixed++;
        }
      }
    }
    if (fixed > 0) logger.info({ fixed }, 'Fixed file_size for existing records');
  } catch {}

  logger.info('DB migrations done');
}

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Webhook ต้องอยู่ก่อน body parsers ทั้งหมด
//    เพราะ LINE middleware ต้องการ raw body เพื่อ verify signature
app.use('/', webhookRouter);

// 2. Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 },
}));

// 3. Body parsers (หลัง webhook เท่านั้น)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// 4. Auth + Dashboard + Download
app.use(authRouter);
app.use(downloadRouter);
app.use(dashboardRouter);

// 5. Static public assets (logo ฯลฯ)
app.use('/public', express.static(path.join(__dirname, 'public')));

// 7. Public image endpoint (LINE ต้องการ URL สาธารณะเพื่อส่งรูปในแชท)
app.get('/img', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).end();
  const storagePath = path.resolve(process.env.STORAGE_PATH || './storage');
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(storagePath)) return res.status(403).end();
  if (!fs.existsSync(resolved)) return res.status(404).end();
  res.sendFile(resolved);
});

// 6. Health + send
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/send', async (req, res) => {
  const { text, groupId } = req.body;
  const targetGroup = groupId || process.env.LINE_GROUP_ID;
  if (!targetGroup || !text) return res.status(400).json({ error: 'กรุณาระบุ text และ groupId' });
  try {
    await client.pushMessage({ to: targetGroup, messages: [{ type: 'text', text }] });
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to push message');
    res.status(500).json({ error: 'ส่งข้อความไม่สำเร็จ' });
  }
});

async function checkExpiredGroups() {
  try {
    const groups = await getAllGroups();
    const now = new Date();
    for (const g of groups) {
      if (g.status === 'approved' && g.expires_at && new Date(g.expires_at) < now) {
        await updateGroup(g.group_id, { status: 'rejected' });
        logger.info({ groupId: g.group_id, expires_at: g.expires_at }, 'Group expired → rejected');
      }
    }
  } catch (e) {
    logger.error(e, 'checkExpiredGroups error');
  }
}

runMigrations().then(() => {
  // ตรวจสอบกลุ่มหมดอายุทุก 1 นาที
  setInterval(checkExpiredGroups, 60_000);
  checkExpiredGroups();

  app.listen(PORT, () => {
    console.log(`\n✅ ไลน์ฮับ server running on port ${PORT}`);
    console.log(`   Webhook  : http://localhost:${PORT}/webhook`);
    console.log(`   Dashboard: http://localhost:${PORT}/\n`);
  });
});
