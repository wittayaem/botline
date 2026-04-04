import { Router } from 'express';
import path from 'path';
import bcrypt from 'bcrypt';
import pool from '../services/db';

const router = Router();

router.get('/login', (req, res) => {
  if ((req.session as any).loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM users WHERE username = ? LIMIT 1', [username]
    );
    const user = rows[0];
    const valid = user && await bcrypt.compare(password, user.password);
    if (valid) {
      (req.session as any).loggedIn = true;
      (req.session as any).userId   = user.id;
      (req.session as any).username = user.username;
      (req.session as any).role     = user.role || 'viewer';
      req.session.save(() => res.redirect('/'));
    } else {
      res.redirect('/login?error=1');
    }
  } catch {
    res.redirect('/login?error=1');
  }
});

router.get('/register', (req, res) => {
  if (!(req.session as any).loggedIn) return res.redirect('/login');
  if ((req.session as any).role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, '../views/register.html'));
});

router.post('/register', async (req, res) => {
  if (!(req.session as any).loggedIn) return res.redirect('/login');
  if ((req.session as any).role !== 'admin') return res.redirect('/');

  const { username, password, confirm_password, role, group_ids } = req.body;
  if (!username || !password || password !== confirm_password) {
    return res.redirect('/register?error=1');
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const userRole = ['admin', 'moderator', 'viewer'].includes(role) ? role : 'viewer';
    const [result] = await pool.query<any>(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashed, userRole]
    );
    const newUserId = result.insertId;

    // กำหนดกลุ่ม (สำหรับ moderator/viewer)
    if (newUserId && group_ids) {
      const ids = Array.isArray(group_ids) ? group_ids : [group_ids];
      for (const gid of ids) {
        if (gid) await pool.query(
          'INSERT IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)', [newUserId, gid]
        );
      }
    }
    res.redirect('/register?success=1');
  } catch {
    res.redirect('/register?error=exists');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
