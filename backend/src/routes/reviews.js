import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';

/** 前台匿名化:絕不回傳 userId / email / 姓名,只告知是否為本人 */
export function anonymizeReview(r, viewer) {
  return {
    id: r.id,
    rating: r.rating,
    content: r.content,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    isMine: !!viewer && r.userId === viewer.id,
  };
}

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  content: z.string().trim().min(10, '評價內容至少 10 個字').max(1500),
});

const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID 格式錯誤');
  return n;
};

/* ===== 巢狀路由:/api/properties/:propertyId/reviews ===== */
export const propertyReviewsRouter = Router({ mergeParams: true });

propertyReviewsRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const propertyId = parseId(req.params.propertyId);
    const reviews = await prisma.review.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reviews.map((r) => anonymizeReview(r, req.user)));
  }),
);

propertyReviewsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const propertyId = parseId(req.params.propertyId);
    const data = reviewSchema.parse(req.body);

    const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
    if (!exists) throw new HttpError(404, '找不到此房源');

    try {
      const review = await prisma.review.create({
        data: { ...data, userId: req.user.id, propertyId },
      });
      res.status(201).json(anonymizeReview(review, req.user));
    } catch (e) {
      if (e.code === 'P2002') throw new HttpError(409, '你已評價過此房源,可直接修改原評價');
      throw e;
    }
  }),
);

/* ===== 單筆路由:/api/reviews/:id ===== */
export const reviewRouter = Router();

reviewRouter.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new HttpError(404, '找不到此評價');
    if (review.userId !== req.user.id) throw new HttpError(403, '只能修改自己的評價');

    const data = reviewSchema.parse(req.body);
    const updated = await prisma.review.update({ where: { id }, data });
    res.json(anonymizeReview(updated, req.user));
  }),
);

reviewRouter.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new HttpError(404, '找不到此評價');
    if (review.userId !== req.user.id && req.user.role !== 'ADMIN')
      throw new HttpError(403, '無權限刪除此評價');
    await prisma.review.delete({ where: { id } });
    res.status(204).end();
  }),
);
