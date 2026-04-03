import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import pool from '../services/db';

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

export default router;
