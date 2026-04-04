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
    `ALTER TABLE groups_config ADD COLUMN IF NOT EXISTS reply_images     TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE groups_config ADD COLUMN IF NOT EXISTS reply_files      TINYINT(1) NOT NULL DEFAULT 1`,
    `ALTER TABLE groups_config ADD COLUMN IF NOT EXISTS welcome_enabled  TINYINT(1) NOT NULL DEFAULT 0`,
    `ALTER TABLE groups_config ADD COLUMN IF NOT EXISTS welcome_text     TEXT`,
    `ALTER TABLE groups_config ADD COLUMN IF NOT EXISTS welcome_image_url VARCHAR(500) DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size BIGINT NULL`,
    `ALTER TABLE groups_config ADD COLUMN expires_at DATETIME NULL`,
  ];
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }
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

// 5. Public image endpoint (LINE ต้องการ URL สาธารณะเพื่อส่งรูปในแชท)
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
    console.log(`\n✅ LINE Bot server running on port ${PORT}`);
    console.log(`   Webhook  : http://localhost:${PORT}/webhook`);
    console.log(`   Dashboard: http://localhost:${PORT}/\n`);
  });
});
