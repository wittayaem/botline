import { Router, Request, Response } from 'express';
import { getAllGroups, getGroup, updateGroup, upsertGroup } from '../services/groupConfig';
import { getWelcomeConfig, setSetting } from '../services/settings';
import { getMessagesByGroup, countByGroup, searchImages, filterImages, filterFiles } from '../services/database';
import { client } from '../services/lineClient';
import pool from '../services/db';
import fs from 'fs';
import path from 'path';
import { getOperators, addOperator, removeOperator } from '../services/operators';

const router = Router();

function requireLogin(req: Request, res: Response, next: any) {
  if ((req.session as any).loggedIn) return next();
  res.redirect('/login');
}

function requireAdmin(req: Request, res: Response, next: any) {
  if ((req.session as any).role === 'admin') return next();
  res.status(403).json({ error: 'forbidden' });
}

async function getAccessibleGroupIds(req: Request): Promise<string[] | null> {
  const role = (req.session as any).role;
  if (role === 'admin') return null; // null = ทั้งหมด
  const userId = (req.session as any).userId;
  const [rows] = await pool.query<any[]>(
    'SELECT group_id FROM user_groups WHERE user_id = ?', [userId]
  );
  return rows.map(r => r.group_id);
}

async function checkGroupAccess(req: Request, res: Response, groupId: string): Promise<boolean> {
  const groupIds = await getAccessibleGroupIds(req);
  if (groupIds !== null && !groupIds.includes(groupId)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

// API: Global welcome message settings (admin only)
router.get('/api/settings/welcome', requireLogin, requireAdmin, async (_req, res) => {
  try {
    res.json(await getWelcomeConfig());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/settings/welcome', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { welcome_enabled, welcome_text, welcome_image_url } = req.body;
    await setSetting('welcome_enabled',   welcome_enabled ? '1' : '0');
    await setSetting('welcome_text',      welcome_text      || '');
    await setSetting('welcome_image_url', welcome_image_url || '');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Favicon
router.get('/favicon.ico', (_req, res) => res.status(204).end());

// หน้า Dashboard
router.get('/', requireLogin, async (_req, res) => {
  res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// API: ข้อมูล user ปัจจุบัน
router.get('/api/me', requireLogin, (req, res) => {
  res.json({
    userId:   (req.session as any).userId,
    username: (req.session as any).username,
    role:     (req.session as any).role,
  });
});

// API: ดึงกลุ่มตาม role
router.get('/api/groups', requireLogin, async (req, res) => {
  const groupIds = await getAccessibleGroupIds(req);
  const groups = await getAllGroups();
  const filtered = groupIds === null ? groups : groups.filter(g => groupIds.includes(g.group_id));
  res.json(filtered);
});

// API: จัดการผู้ใช้ (admin only)
router.get('/api/users', requireLogin, requireAdmin, async (_req, res) => {
  const [users] = await pool.query<any[]>(
    'SELECT id, username, role, created_at FROM users ORDER BY id'
  );
  for (const u of users) {
    const [groups] = await pool.query<any[]>(
      'SELECT group_id FROM user_groups WHERE user_id = ?', [u.id]
    );
    u.group_ids = groups.map((g: any) => g.group_id);
  }
  res.json(users);
});

router.post('/api/users/:id/role', requireLogin, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'moderator', 'viewer'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  res.json({ ok: true });
});

router.post('/api/users/:id/groups', requireLogin, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const { group_ids } = req.body; // array
  await pool.query('DELETE FROM user_groups WHERE user_id = ?', [userId]);
  for (const gid of (group_ids || [])) {
    if (gid) await pool.query('INSERT IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)', [userId, gid]);
  }
  res.json({ ok: true });
});

router.delete('/api/users/:id', requireLogin, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// API: อัปเดต config ของกลุ่ม (admin/moderator เท่านั้น)
router.post('/api/groups/:groupId', requireLogin, async (req, res) => {
  const role = (req.session as any).role;
  if (role === 'viewer') return res.status(403).json({ error: 'forbidden' });
  const { groupId } = req.params;
  const groupIds = await getAccessibleGroupIds(req);
  if (groupIds !== null && !groupIds.includes(groupId)) return res.status(403).json({ error: 'forbidden' });
  const { name, enabled, save_text, save_images, save_files, download_password, ai_caption, ai_model, ai_chat, ai_equipment } = req.body;
  let config = await getGroup(groupId);
  if (!config) await upsertGroup(groupId, name);
  await updateGroup(groupId, { name, enabled, save_text, save_images, save_files, download_password, ai_caption, ai_model, ai_chat, ai_equipment });
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
  if (!await checkGroupAccess(req, res, groupId)) return;
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
  if (!await checkGroupAccess(req, res, groupId)) return;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'กรุณาระบุ text' });
  try {
    await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: ดึงไฟล์ทั้งหมดในกลุ่ม (รองรับ filter)
router.get('/api/groups/:groupId/files', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
  const q = (req.query.q as string || '').trim() || undefined;
  const from = (req.query.from as string) || undefined;
  const to   = (req.query.to   as string) || undefined;
  const limit = Number(req.query.limit) || 200;
  const rows = await filterFiles(groupId, q, from, to, limit);
  res.json(rows);
});

// API: ดึงรูปภาพทั้งหมดในกลุ่ม (รองรับ filter)
router.get('/api/groups/:groupId/images', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
  const q = (req.query.q as string || '').trim() || undefined;
  const from = (req.query.from as string) || undefined;
  const to   = (req.query.to   as string) || undefined;
  const limit = Number(req.query.limit) || 200;
  const rows = await filterImages(groupId, q, from, to, limit);
  res.json(rows);
});

// API: ค้นหารูปด้วย AI caption
router.get('/api/groups/:groupId/search', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
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

// API: จัดการผู้ดูแลกลุ่ม (operator ใน LINE)
router.get('/api/groups/:groupId/operators', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
  try {
    res.json(await getOperators(groupId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/api/groups/:groupId/operators', requireLogin, async (req, res) => {
  const { groupId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
  const { line_user_id, display_name, can_manage } = req.body;
  if (!line_user_id) return res.status(400).json({ error: 'line_user_id required' });
  await addOperator(groupId, line_user_id, display_name || '', !!can_manage);
  res.json({ ok: true });
});

router.delete('/api/groups/:groupId/operators/:lineUserId', requireLogin, async (req, res) => {
  const { groupId, lineUserId } = req.params;
  if (!await checkGroupAccess(req, res, groupId)) return;
  await removeOperator(groupId, lineUserId);
  res.json({ ok: true });
});

export default router;
