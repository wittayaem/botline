import { Router } from 'express';
import path from 'path';
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
      'SELECT * FROM users WHERE username = ? AND password = ? LIMIT 1',
      [username, password]
    );
    if (rows.length > 0) {
      (req.session as any).loggedIn = true;
      (req.session as any).username = username;
      req.session.save(() => res.redirect('/'));
    } else {
      res.redirect('/login?error=1');
    }
  } catch {
    res.redirect('/login?error=1');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
