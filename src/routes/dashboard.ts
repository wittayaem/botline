import { Router, Request, Response } from 'express';
import { getAllGroups, getGroup, updateGroup, upsertGroup } from '../services/groupConfig';
import { getMessagesByGroup, countByGroup, searchImages } from '../services/database';
import { client } from '../services/lineClient';
import fs from 'fs';
import path from 'path';

const router = Router();

function requireLogin(req: Request, res: Response, next: any) {
  if ((req.session as any).loggedIn) return next();
  res.redirect('/login');
}

// Favicon
router.get('/favicon.ico', (_req, res) => res.status(204).end());

// หน้า Dashboard
router.get('/', requireLogin, async (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// API: ดึงกลุ่มทั้งหมด
router.get('/api/groups', requireLogin, async (_req, res) => {
  const groups = await getAllGroups();
  res.json(groups);
});

// API: อัปเดต config ของกลุ่ม
router.post('/api/groups/:groupId', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  const { name, enabled, save_text, save_images, save_files, ai_caption, ai_model, ai_chat, ai_equipment } = req.body;
  let config = await getGroup(groupId);
  if (!config) await upsertGroup(groupId, name);
  await updateGroup(groupId, { name, enabled, save_text, save_images, save_files, ai_caption, ai_model, ai_chat, ai_equipment });
  res.json({ success: true });
});

// API: อนุมัติกลุ่ม
router.post('/api/groups/:groupId/approve', requireLogin, async (req, res) => {
  await updateGroup(req.params.groupId, { status: 'approved' });
  res.json({ success: true });
});

// API: ปฏิเสธกลุ่ม
router.post('/api/groups/:groupId/reject', requireLogin, async (req, res) => {
  await updateGroup(req.params.groupId, { status: 'rejected' });
  res.json({ success: true });
});

// API: ดึงข้อความในกลุ่ม
router.get('/api/groups/:groupId/messages', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  const limit = Number(req.query.limit) || 50;
  const [messages, stats] = await Promise.all([
    getMessagesByGroup(groupId, limit),
    countByGroup(groupId),
  ]);
  res.json({ messages, stats });
});

// API: ส่งข้อความไปกลุ่ม
router.post('/api/groups/:groupId/send', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'กรุณาระบุ text' });
  try {
    await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: ค้นหารูปด้วย AI caption
router.get('/api/groups/:groupId/search', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  const keyword = (req.query.q as string || '').trim();
  if (!keyword) return res.status(400).json({ error: 'กรุณาระบุคำค้นหา' });
  const images = await searchImages(groupId, keyword);
  res.json(images);
});

// API: ดาวน์โหลดไฟล์
router.get('/api/files', requireLogin, (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  res.download(filePath);
});

export default router;
