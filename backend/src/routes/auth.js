import { Router } from 'express';
import passport from '../config/passport.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/http.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND = process.env.FRONTEND_URL;
const cookieOpts = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax' };

// 1) 導向 Google 登入頁(hd 僅提示 Google 只顯示中大帳號,真正驗證在 callback)
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    hd: process.env.ALLOWED_EMAIL_DOMAIN || 'g.ncu.edu.tw',
    prompt: 'select_account',
    session: false,
  }),
);

// 2) Google 回呼
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      const reason = info?.message || 'LOGIN_FAILED';
      return res.redirect(`${FRONTEND}/login?error=${encodeURIComponent(reason)}`);
    }
    res.cookie('token', signToken(user), { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect(FRONTEND);
  })(req, res, next);
});

// 3) 目前登入者
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!user) return res.status(401).json({ error: '帳號不存在' });
    res.json(user);
  }),
);

// 4) 登出
router.post('/logout', (_req, res) => {
  res.clearCookie('token', cookieOpts);
  res.json({ ok: true });
});

export default router;
