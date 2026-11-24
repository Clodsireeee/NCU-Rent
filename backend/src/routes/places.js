import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { anonymizeReview, visibleReviewsWhere, moderationNotice, reportReview, reportSchema, writeLimiter } from './reviews.js';
import { moderate, statusFor } from '../services/moderation.js';
import { placeDetails, toPublicDetails, placesEnabled } from '../services/places.js';

const pid = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID 格式錯誤'); return n; };
const admin = (req, _res, next) => (req.user.role === 'ADMIN' ? next() : next(new HttpError(403, '僅管理員可操作')));
const coord = { lat: z.coerce.number().min(21.5).max(25.5), lng: z.coerce.number().min(119).max(122.5) };
const BBOX = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;

/* ---------- 垃圾車 ---------- */
export const garbageRouter = Router();
const garbageSchema = z.object({
  name: z.string().trim().min(1).max(100), ...coord,
  days: z.array(z.number().int().min(0).max(6)).min(1),
  arrivalTime: z.string().regex(/^\d{2}:\d{2}$/, '時間格式 HH:MM'),
  note: z.string().max(200).optional(),
});
garbageRouter.get('/', asyncHandler(async (_q, res) => res.json(await prisma.garbageStop.findMany({ orderBy: { arrivalTime: 'asc' } }))));
garbageRouter.post('/', requireAuth, admin, asyncHandler(async (req, res) =>
  res.status(201).json(await prisma.garbageStop.create({ data: garbageSchema.parse(req.body) }))));
garbageRouter.delete('/:id', requireAuth, admin, asyncHandler(async (req, res) => {
  await prisma.garbageStop.delete({ where: { id: pid(req.params.id) } }); res.status(204).end();
}));

/* ---------- 美食 ---------- */
export const eateryRouter = Router();
const eSchema = z.object({
  name: z.string().trim().min(1).max(100), address: z.string().trim().max(200).optional(), ...coord,
  category: z.string().trim().min(1).max(20),
  priceRange: z.coerce.number().int().min(0).max(5000).optional(),
  description: z.string().trim().max(1000).optional(),
});
const rSchema = z.object({ rating: z.coerce.number().int().min(1).max(5), content: z.string().trim().min(5, '評價至少 5 個字').max(1000) });
const avg = (rs) => (rs.length ? Number((rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(1)) : null);
const PUBLISHED = { where: { status: 'PUBLISHED' }, select: { rating: true } };

eateryRouter.get('/', asyncHandler(async (req, res) => {
  const { bbox, category, source } = req.query; const where = {};
  if (bbox) {
    if (!BBOX.test(bbox)) throw new HttpError(400, 'bbox 格式錯誤');
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    where.lng = { gte: minLng, lte: maxLng }; where.lat = { gte: minLat, lte: maxLat };
  }
  if (category) where.category = String(category);
  if (source === 'USER' || source === 'GOOGLE') where.source = source;
  const list = await prisma.eatery.findMany({ where, take: 400, include: { reviews: PUBLISHED } });
  res.json(list.map(({ reviews, ownerId, googlePlaceId, ...e }) => ({ ...e, reviewCount: reviews.length, avgRating: avg(reviews) })));
}));

eateryRouter.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const e = await prisma.eatery.findUnique({
    where: { id: pid(req.params.id) },
    include: { reviews: { where: visibleReviewsWhere(req.user), orderBy: { createdAt: 'desc' } } },
  });
  if (!e) throw new HttpError(404, '找不到此店家');
  const { reviews, ownerId, googlePlaceId, ...rest } = e;
  const published = reviews.filter((r) => r.status === 'PUBLISHED');

  // Google 店家:即時查詢店名、地址、營業時間、Google 評分(依條款不存進資料庫)
  let google = null;
  if (e.source === 'GOOGLE' && googlePlaceId && placesEnabled()) {
    try { google = toPublicDetails(await placeDetails(googlePlaceId)); }
    catch (err) { console.warn('[places] details 失敗:', err.message); }
  }
  res.json({
    ...rest,
    name: rest.name ?? google?.name ?? null,
    address: rest.address ?? google?.address ?? null,
    google,
    avgRating: avg(published),
    reviewCount: published.length,
    canDelete: !!req.user && e.source === 'USER' && (req.user.id === ownerId || req.user.role === 'ADMIN'),
    reviews: reviews.map((r) => anonymizeReview(r, req.user)),
  });
}));

eateryRouter.post('/', requireAuth, asyncHandler(async (req, res) =>
  res.status(201).json(await prisma.eatery.create({ data: { ...eSchema.parse(req.body), source: 'USER', ownerId: req.user.id } }))));

eateryRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const e = await prisma.eatery.findUnique({ where: { id } });
  if (!e) throw new HttpError(404, '找不到此店家');
  if (e.ownerId !== req.user.id && req.user.role !== 'ADMIN') throw new HttpError(403, '無權限');
  await prisma.eatery.delete({ where: { id } }); res.status(204).end();
}));

eateryRouter.post('/:id/reviews', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const eateryId = pid(req.params.id);
  const data = rSchema.parse(req.body);
  if (!(await prisma.eatery.findUnique({ where: { id: eateryId }, select: { id: true } }))) throw new HttpError(404, '找不到此店家');
  const mod = statusFor(await moderate(data.content), HttpError);
  try {
    const r = await prisma.eateryReview.create({ data: { ...data, ...mod, userId: req.user.id, eateryId } });
    res.status(201).json({ ...anonymizeReview(r, req.user), notice: moderationNotice(r) });
  } catch (e) { throw e.code === 'P2002' ? new HttpError(409, '你已評價過此店家') : e; }
}));

eateryRouter.delete('/reviews/:rid', requireAuth, asyncHandler(async (req, res) => {
  const id = pid(req.params.rid);
  const r = await prisma.eateryReview.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, '找不到此評價');
  if (r.userId !== req.user.id && req.user.role !== 'ADMIN') throw new HttpError(403, '無權限');
  await prisma.eateryReview.delete({ where: { id } }); res.status(204).end();
}));

eateryRouter.post('/reviews/:rid/report', requireAuth, writeLimiter, asyncHandler(async (req, res) => {
  const { reason } = reportSchema.parse(req.body);
  res.status(201).json(await reportReview('eateryReview', pid(req.params.rid), req.user, reason));
}));
