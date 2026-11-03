import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { ZodError } from 'zod';
import passport from './config/passport.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import propertiesRouter from './routes/properties.js';
import { garbageRouter, eateryRouter } from './routes/places.js';
import { propertyReviewsRouter, reviewRouter } from './routes/reviews.js';

const app = express();
// 正式環境經過 Vercel + Render 兩層代理,TRUST_PROXY_HOPS 設 2,rate limit 才抓得到真實使用者 IP
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(
  helmet({
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://res.cloudinary.com'],
      },
    },
  }),
);
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/api/properties/:propertyId/reviews', propertyReviewsRouter);
app.use('/api/properties', propertiesRouter);
app.use('/api/reviews', reviewRouter);
app.use('/api/garbage-stops', garbageRouter);
app.use('/api/eateries', eateryRouter);
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
app.use(express.static(dist));
app.get('*', (req, res, next) =>
  req.path.startsWith('/api') || req.path.startsWith('/auth')
    ? next()
    : res.sendFile(path.join(dist, 'index.html')),
);
app.use((_req, res) => res.status(404).json({ error: '找不到此路徑' }));

// 統一錯誤處理
app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: '輸入資料有誤',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `圖片上傳錯誤:${err.message}` });
  }
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: '伺服器發生錯誤' });
});

export default app;
