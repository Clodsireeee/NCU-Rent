import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { anonymizeReview } from './reviews.js';

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

eateryRouter.get('/', asyncHandler(async (req, res) => {
  const { bbox, category } = req.query; const where = {};
  if (bbox) {
    if (!BBOX.test(bbox)) throw new HttpError(400, 'bbox 格式錯誤');
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    where.lng = { gte: minLng, lte: maxLng }; where.lat = { gte: minLat, lte: maxLat };
  }
  if (category) where.category = String(category);
  const list = await prisma.eatery.findMany({ where, take: 300, include: { reviews: { select: { rating: true } } } });
  res.json(list.map(({ reviews, ownerId, ...e }) => ({ ...e, reviewCount: reviews.length, avgRating: avg(reviews) })));
}));

eateryRouter.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const e = await prisma.eatery.findUnique({ where: { id: pid(req.params.id) }, include: { reviews: { orderBy: { createdAt: 'desc' } } } });
  if (!e) throw new HttpError(404, '找不到此店家');
  const { reviews, ownerId, ...rest } = e;
  res.json({ ...rest, avgRating: avg(reviews), reviewCount: reviews.length, reviews: reviews.map((r) => anonymizeReview(r, req.user)) });
}));

eateryRouter.post('/', requireAuth, asyncHandler(async (req, res) =>
  res.status(201).json(await prisma.eatery.create({ data: { ...eSchema.parse(req.body), ownerId: req.user.id } }))));

eateryRouter.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = pid(req.params.id);
  const e = await prisma.eatery.findUnique({ where: { id } });
  if (!e) throw new HttpError(404, '找不到此店家');
  if (e.ownerId !== req.user.id && req.user.role !== 'ADMIN') throw new HttpError(403, '無權限');
  await prisma.eatery.delete({ where: { id } }); res.status(204).end();
}));

eateryRouter.post('/:id/reviews', requireAuth, asyncHandler(async (req, res) => {
  const eateryId = pid(req.params.id);
  const data = rSchema.parse(req.body);
  if (!(await prisma.eatery.findUnique({ where: { id: eateryId }, select: { id: true } }))) throw new HttpError(404, '找不到此店家');
  try {
    res.status(201).json(anonymizeReview(await prisma.eateryReview.create({ data: { ...data, userId: req.user.id, eateryId } }), req.user));
  } catch (e) { throw e.code === 'P2002' ? new HttpError(409, '你已評價過此店家') : e; }
}));

eateryRouter.delete('/reviews/:rid', requireAuth, asyncHandler(async (req, res) => {
  const id = pid(req.params.rid);
  const r = await prisma.eateryReview.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, '找不到此評價');
  if (r.userId !== req.user.id && req.user.role !== 'ADMIN') throw new HttpError(403, '無權限');
  await prisma.eateryReview.delete({ where: { id } }); res.status(204).end();
}));
