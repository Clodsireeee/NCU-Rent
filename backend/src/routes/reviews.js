import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { moderate, statusFor } from '../services/moderation.js';

const REPORT_THRESHOLD = Number(process.env.REPORT_THRESHOLD) || 3;

/** 前台匿名化:絕不回傳 userId / email / 姓名,只告知是否為本人;審核資訊只給本人看 */
export function anonymizeReview(r, viewer) {
  const isMine = !!viewer && r.userId === viewer.id;
  return {
    id: r.id,
    rating: r.rating,
    content: r.content,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    isMine,
    ...(isMine || viewer?.role === 'ADMIN'
      ? { status: r.status, moderationReason: r.moderationReason ?? null }
      : {}),
  };
}

/** 公開可見:已發布;本人另外看得到自己的審核中 / 被駁回評論 */
export const visibleReviewsWhere = (viewer) =>
  viewer ? { OR: [{ status: 'PUBLISHED' }, { userId: viewer.id }] } : { status: 'PUBLISHED' };

/** 審核中的評論也要提示作者 */
export const moderationNotice = (r) =>
  r.status === 'PENDING' ? '評論已送出,內容需人工審核,通過後才會公開。' : null;

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  content: z.string().trim().min(10, '評價內容至少 10 個字').max(1500),
});
export const reportSchema = z.object({ reason: z.string().trim().min(2, '請簡述檢舉原因').max(300) });

// 送出評論 / 檢舉的頻率限制(每位使用者)
export const writeLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  keyGenerator: (req) => `u${req.user?.id ?? req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '操作太頻繁,請稍後再試' },
});

const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID 格式錯誤');
  return n;
};

/**
 * 檢舉共用邏輯。kind = 'review' | 'eateryReview'
 * 未處理檢舉數達門檻 → 自動改為 PENDING 下架,等管理員處理。
 */
export async function reportReview(kind, id, user, reason) {
  const model = kind === 'review' ? prisma.review : prisma.eateryReview;
  const fk = kind === 'review' ? 'reviewId' : 'eateryReviewId';
  const r = await model.findUnique({ where: { id } });
  if (!r) throw new HttpError(404, '找不到此評價');
  if (r.userId === user.id) throw new HttpError(400, '不能檢舉自己的評價');
  try {
    await prisma.reviewReport.create({ data: { reason, reporterId: user.id, [fk]: id } });
  } catch (e) {
    if (e.code === 'P2002') throw new HttpError(409, '你已檢舉過此評價');
    throw e;
  }
  const count = await prisma.reviewReport.count({ where: { [fk]: id, resolved: false } });
  if (r.status === 'PUBLISHED' && count >= REPORT_THRESHOLD) {
    await model.update({
      where: { id },
      data: { status: 'PENDING', moderationReason: `被 ${count} 位使用者檢舉,等待管理員審核` },
    });
  }
  return { ok: true, message: '已收到檢舉,管理員會盡快處理' };
}

/* ===== 巢狀路由:/api/properties/:propertyId/reviews ===== */
export const propertyReviewsRouter = Router({ mergeParams: true });

propertyReviewsRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const propertyId = parseId(req.params.propertyId);
    const reviews = await prisma.review.findMany({
      where: { propertyId, ...visibleReviewsWhere(req.user) },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reviews.map((r) => anonymizeReview(r, req.user)));
  }),
);

propertyReviewsRouter.post(
  '/',
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const propertyId = parseId(req.params.propertyId);
    const data = reviewSchema.parse(req.body);

    const exists = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } });
    if (!exists) throw new HttpError(404, '找不到此房源');

    const mod = statusFor(await moderate(data.content), HttpError); // block 會直接丟 422
    try {
      const review = await prisma.review.create({
        data: { ...data, ...mod, userId: req.user.id, propertyId },
      });
      res.status(201).json({ ...anonymizeReview(review, req.user), notice: moderationNotice(review) });
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
  writeLimiter,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw new HttpError(404, '找不到此評價');
    if (review.userId !== req.user.id) throw new HttpError(403, '只能修改自己的評價');

    const data = reviewSchema.parse(req.body);
    const mod = statusFor(await moderate(data.content), HttpError); // 修改後重新審核
    const updated = await prisma.review.update({ where: { id }, data: { ...data, ...mod } });
    res.json({ ...anonymizeReview(updated, req.user), notice: moderationNotice(updated) });
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

reviewRouter.post(
  '/:id/report',
  requireAuth,
  writeLimiter,
  asyncHandler(async (req, res) => {
    const { reason } = reportSchema.parse(req.body);
    res.status(201).json(await reportReview('review', parseId(req.params.id), req.user, reason));
  }),
);
