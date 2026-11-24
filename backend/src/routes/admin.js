// 管理員:評論審核佇列
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, (req, _res, next) =>
  req.user.role === 'ADMIN' ? next() : next(new HttpError(403, '僅管理員可操作')),
);

const KINDS = {
  review: { model: () => prisma.review, fk: 'reviewId', target: { property: { select: { id: true, title: true } } } },
  eateryReview: { model: () => prisma.eateryReview, fk: 'eateryReviewId', target: { eatery: { select: { id: true, name: true, googlePlaceId: true } } } },
};

/**
 * GET /api/admin/moderation?status=PENDING
 * 回傳待審評論(含檢舉原因)。管理員可看到作者信箱,以便處理濫用帳號。
 */
router.get(
  '/moderation',
  asyncHandler(async (req, res) => {
    const status = z.enum(['PENDING', 'REJECTED', 'PUBLISHED']).default('PENDING').parse(req.query.status);
    const reportedOnly = req.query.reported === 'true';
    const out = [];
    for (const [kind, k] of Object.entries(KINDS)) {
      const rows = await k.model().findMany({
        where: { status, ...(reportedOnly ? { reports: { some: { resolved: false } } } : {}) },
        orderBy: { updatedAt: 'desc' },
        take: 200,
        include: {
          ...k.target,
          user: { select: { email: true } },
          reports: { where: { resolved: false }, select: { reason: true, createdAt: true } },
        },
      });
      for (const r of rows) {
        out.push({
          kind, id: r.id, rating: r.rating, content: r.content, status: r.status,
          moderationReason: r.moderationReason, moderationFlags: r.moderationFlags,
          authorEmail: r.user.email, createdAt: r.createdAt, updatedAt: r.updatedAt,
          target: r.property ? { type: 'property', id: r.property.id, title: r.property.title }
            : { type: 'eatery', id: r.eatery.id, title: r.eatery.name || 'Google 店家' },
          reports: r.reports,
        });
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(out);
  }),
);

const actionSchema = z.object({
  action: z.enum(['approve', 'reject', 'delete']),
  reason: z.string().trim().max(300).optional(),
});

/** POST /api/admin/moderation/:kind/:id  { action: approve | reject | delete, reason? } */
router.post(
  '/moderation/:kind/:id',
  asyncHandler(async (req, res) => {
    const k = KINDS[req.params.kind];
    if (!k) throw new HttpError(400, '類型錯誤');
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'ID 格式錯誤');
    const { action, reason } = actionSchema.parse(req.body);
    const model = k.model();
    if (!(await model.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, '找不到此評價');

    if (action === 'delete') {
      await model.delete({ where: { id } });
      return res.status(204).end();
    }
    await prisma.reviewReport.updateMany({ where: { [k.fk]: id, resolved: false }, data: { resolved: true } });
    const updated = await model.update({
      where: { id },
      data: action === 'approve'
        ? { status: 'PUBLISHED', moderationReason: null }
        : { status: 'REJECTED', moderationReason: reason || '內容違反平台使用規範' },
    });
    res.json({ id: updated.id, status: updated.status });
  }),
);

/** GET /api/admin/stats 給後台首頁看的數字 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [pending, pendingEatery, openReports, bySource, posts] = await Promise.all([
      prisma.review.count({ where: { status: 'PENDING' } }),
      prisma.eateryReview.count({ where: { status: 'PENDING' } }),
      prisma.reviewReport.count({ where: { resolved: false } }),
      prisma.property.groupBy({ by: ['source'], _count: { _all: true } }),
      prisma.campusPost.count(),
    ]);
    res.json({
      pendingReviews: pending + pendingEatery,
      openReports,
      properties: Object.fromEntries(bySource.map((s) => [s.source, s._count._all])),
      campusPosts: posts,
    });
  }),
);

export default router;
