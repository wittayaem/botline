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

app.listen(PORT, () => {
  console.log(`\n✅ LINE Bot server running on port ${PORT}`);
  console.log(`   Webhook  : http://localhost:${PORT}/webhook`);
  console.log(`   Dashboard: http://localhost:${PORT}/\n`);
});
