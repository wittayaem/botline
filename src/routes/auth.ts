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

router.get('/register', (req, res) => {
  if ((req.session as any).loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../views/register.html'));
});

router.post('/register', async (req, res) => {
  const { username, password, confirm_password } = req.body;
  if (!username || !password || password !== confirm_password) {
    return res.redirect('/register?error=1');
  }
  try {
    await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, password]);
    res.redirect('/login?success=1');
  } catch {
    res.redirect('/register?error=exists');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
