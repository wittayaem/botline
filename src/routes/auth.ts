import { Router } from 'express';
import path from 'path';

const router = Router();

router.get('/login', (req, res) => {
  if ((req.session as any).loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../views/login.html'));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.DASHBOARD_USERNAME || 'admin';
  const validPass = process.env.DASHBOARD_PASSWORD || 'admin123';

  if (username === validUser && password === validPass) {
    (req.session as any).loggedIn = true;
    (req.session as any).username = username;
    req.session.save(() => res.redirect('/'));
  } else {
    res.redirect('/login?error=1');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
