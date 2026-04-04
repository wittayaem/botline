import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import pool from '../services/db';
import { getClientIp, isBanned, recordFailure, clearFailures } from '../services/rateLimiter';

const router = Router();

async function getFileRecord(messageId: string) {
  const [rows] = await pool.query<any[]>(
    `SELECT m.*, g.download_password
     FROM messages m
     JOIN groups_config g ON m.group_id = g.group_id
     WHERE m.message_id = ? LIMIT 1`,
    [messageId]
  );
  return rows[0] || null;
}

// หน้า download (HTML)
router.get('/dl/:messageId', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/download.html'));
});

// API ดึงข้อมูลไฟล์ (ไม่ส่ง path จริง)
router.get('/dl-info/:messageId', async (req, res) => {
  const record = await getFileRecord(req.params.messageId);
  if (!record) return res.json({ error: 'not found' });
  res.json({
    type: record.type,
    fileName: record.file_name || (record.type === 'image' ? 'รูปภาพ.jpg' : 'ไฟล์'),
    needPassword: !!record.download_password,
  });
});

// POST ตรวจรหัสผ่าน
router.post('/dl/:messageId', async (req, res) => {
  const record = await getFileRecord(req.params.messageId);
  if (!record) return res.status(404).json({ ok: false });
  if (record.download_password && req.body.password !== record.download_password) {
    return res.json({ ok: false });
  }
  // เก็บ session ว่าผ่านการตรวจสอบแล้ว
  (req.session as any)[`dl_${req.params.messageId}`] = true;
  req.session.save(() => res.json({ ok: true, url: `/dl-file/${req.params.messageId}` }));
});

// เสิร์ฟไฟล์จริง
router.get('/dl-file/:messageId', async (req, res) => {
  const record = await getFileRecord(req.params.messageId);
  if (!record) return res.status(404).end();

  // ถ้ามีรหัสผ่าน ต้องผ่าน POST ก่อน
  if (record.download_password && !(req.session as any)[`dl_${req.params.messageId}`]) {
    return res.redirect(`/dl/${req.params.messageId}`);
  }

  const filePath = record.file_path;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();

  if (record.type === 'image') {
    res.sendFile(path.resolve(filePath));
  } else {
    res.download(path.resolve(filePath), record.file_name || 'file');
  }
});


// =========== Gallery (group browse page) ===========

function isGalleryAuthed(req: any, groupId: string, password: string | null): boolean {
  if (!password) return true;
  return !!(req.session as any)[`gallery_${groupId}`];
}

router.get('/g/:groupId', (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/gallery.html'));
});

router.get('/g-info/:groupId', async (req, res) => {
  const { groupId } = req.params;
  const [rows] = await pool.query<any[]>(
    'SELECT name, download_password FROM groups_config WHERE group_id = ? LIMIT 1',
    [groupId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const pw = rows[0].download_password || null;
  res.json({
    name: rows[0].name || 'กลุ่ม',
    needPassword: !!pw,
    authed: isGalleryAuthed(req, groupId, pw),
  });
});

router.post('/g/:groupId/auth', async (req, res) => {
  const { groupId } = req.params;
  const ip = getClientIp(req);

  // ตรวจสอบว่า IP โดนแบนอยู่ไหม
  if (isBanned(ip)) {
    return res.status(429).json({ ok: false, banned: true, error: 'IP ของคุณถูกระงับชั่วคราว กรุณารอ 30 นาที' });
  }

  const [rows] = await pool.query<any[]>(
    'SELECT download_password FROM groups_config WHERE group_id = ? LIMIT 1',
    [groupId]
  );
  if (!rows[0]) return res.status(404).json({ ok: false });
  const pw = rows[0].download_password || null;

  if (pw && req.body.password !== pw) {
    const result = recordFailure(ip, groupId);
    if (result.banned) {
      return res.status(429).json({ ok: false, banned: true, error: 'ใส่รหัสผิดเกินกำหนด IP ถูกระงับ 30 นาที' });
    }
    return res.json({ ok: false, attemptsLeft: result.attemptsLeft });
  }

  // รหัสถูก — ล้าง failed attempts แล้วบันทึก session
  clearFailures(ip);
  (req.session as any)[`gallery_${groupId}`] = true;
  req.session.save(() => res.json({ ok: true }));
});

router.get('/g-api/:groupId/images', async (req, res) => {
  const { groupId } = req.params;
  const [cfg] = await pool.query<any[]>(
    'SELECT download_password FROM groups_config WHERE group_id = ? LIMIT 1', [groupId]
  );
  if (!cfg[0]) return res.status(404).json({ error: 'not found' });
  if (!isGalleryAuthed(req, groupId, cfg[0].download_password || null))
    return res.status(401).json({ error: 'unauthorized' });
  const [rows] = await pool.query<any[]>(
    `SELECT message_id, caption, created_at FROM messages
     WHERE group_id = ? AND type = 'image' ORDER BY created_at DESC LIMIT 300`,
    [groupId]
  );
  res.json(rows);
});

router.get('/g-api/:groupId/files', async (req, res) => {
  const { groupId } = req.params;
  const q = (req.query.q as string || '').trim();
  const [cfg] = await pool.query<any[]>(
    'SELECT download_password FROM groups_config WHERE group_id = ? LIMIT 1', [groupId]
  );
  if (!cfg[0]) return res.status(404).json({ error: 'not found' });
  if (!isGalleryAuthed(req, groupId, cfg[0].download_password || null))
    return res.status(401).json({ error: 'unauthorized' });
  let where = `group_id = ? AND type = 'file'`;
  const params: any[] = [groupId];
  if (q) { where += ` AND file_name LIKE ?`; params.push(`%${q}%`); }
  const [rows] = await pool.query<any[]>(
    `SELECT message_id, file_name, file_size, created_at FROM messages
     WHERE ${where} ORDER BY created_at DESC LIMIT 300`,
    params
  );
  res.json(rows);
});

router.get('/g-file/:groupId/:messageId', async (req, res) => {
  const { groupId, messageId } = req.params;
  const [cfg] = await pool.query<any[]>(
    'SELECT download_password FROM groups_config WHERE group_id = ? LIMIT 1', [groupId]
  );
  if (!cfg[0]) return res.status(404).end();
  if (!isGalleryAuthed(req, groupId, cfg[0].download_password || null))
    return res.status(401).end();
  const [rows] = await pool.query<any[]>(
    'SELECT file_path, file_name, type FROM messages WHERE message_id = ? AND group_id = ? LIMIT 1',
    [messageId, groupId]
  );
  const rec = rows[0];
  if (!rec || !rec.file_path || !fs.existsSync(rec.file_path)) return res.status(404).end();
  if (rec.type === 'image') {
    res.sendFile(path.resolve(rec.file_path));
  } else {
    res.download(path.resolve(rec.file_path), rec.file_name || 'file');
  }
});

export default router;
