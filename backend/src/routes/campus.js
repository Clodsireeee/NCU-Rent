// 校園最新資訊:公告列表(可依標籤篩選)、標籤清單、社團名錄
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/http.js';
import { TAGS, TAG_NAMES } from '../services/tagger.js';
import { SOURCES } from '../crawlers/news/sources.js';

const router = Router();

/** GET /api/campus/tags → [{ tag, emoji, count }](近 180 天) */
router.get('/tags', asyncHandler(async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT t AS tag, COUNT(*)::int AS count
    FROM "CampusPost", unnest("tags") AS t
    WHERE "publishedAt" >= NOW() - INTERVAL '180 days' OR "publishedAt" IS NULL
    GROUP BY t`;
  const counts = new Map(rows.map((r) => [r.tag, r.count]));
  res.json(TAGS.map(({ tag, emoji }) => ({ tag, emoji, count: counts.get(tag) || 0 })));
}));

router.get('/sources', (_req, res) => res.json(SOURCES.map(({ id, name }) => ({ id, name }))));

const listQuery = z.object({
  tags: z.string().optional().transform((s) => (s ? s.split(',').filter((t) => TAG_NAMES.includes(t)) : [])),
  match: z.enum(['any', 'all']).default('any'),
  source: z.string().max(40).optional(),
  q: z.string().trim().max(50).optional(),
  upcoming: z.enum(['true', 'false']).optional(), // 只看「還沒結束」的活動,依活動時間排序
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** GET /api/campus/posts?tags=社團活動,講座演講&match=any&q=&upcoming=true&page=1 */
router.get('/posts', asyncHandler(async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = { AND: [] };
  if (q.tags.length) where.AND.push({ tags: q.match === 'all' ? { hasEvery: q.tags } : { hasSome: q.tags } });
  if (q.source) where.AND.push({ source: q.source });
  if (q.q) {
    where.AND.push({ OR: ['title', 'summary', 'publisher', 'clubName'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) });
  }
  const TZ = 8 * 3600e3; // 台灣 UTC+8
  const startOfToday = new Date(Math.floor((Date.now() + TZ) / 864e5) * 864e5 - TZ); // 台灣時間今天 00:00
  if (q.upcoming === 'true') {
    where.AND.push({ OR: [{ eventEnd: { gte: new Date() } }, { eventEnd: null, eventStart: { gte: startOfToday } }] });
  }
  const orderBy = q.upcoming === 'true'
    ? [{ eventStart: 'asc' }]
    : [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];

  const [total, items] = await Promise.all([
    prisma.campusPost.count({ where }),
    prisma.campusPost.findMany({
      where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit,
      select: {
        id: true, source: true, url: true, title: true, publisher: true, rawCategory: true, publishedAt: true,
        summary: true, tags: true, taggedBy: true, eventStart: true, eventEnd: true, location: true, clubName: true,
        content: true,
      },
    }),
  ]);
  // 列表只回傳內文開頭(excerpt),完整內文用 GET /posts/:id 取得
  res.json({
    total, page: q.page, pages: Math.ceil(total / q.limit),
    items: items.map(({ content, ...p }) => ({
      ...p,
      excerpt: excerpt(content),
      hasContent: !!content?.trim(),
      attachmentCount: (content?.match(/^• .+｜https?:\/\//gm) || []).length,
    })),
  });
}));

/** 內文開頭:去掉和標題重複的行、附件清單,取前 150 字 */
function excerpt(content) {
  if (!content) return null;
  const body = content.split('\n附件:')[0].replace(/\s+/g, ' ').trim();
  return body.length > 150 ? `${body.slice(0, 150)}…` : body || null;
}

/** GET /api/campus/posts/:id 單則公告(含完整原始內文與附件) */
router.get('/posts/:id', asyncHandler(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const post = await prisma.campusPost.findUnique({ where: { id } });
  if (!post) return res.status(404).json({ error: '找不到此公告' });
  const [body, list = ''] = (post.content || '').split('\n附件:\n');
  const attachments = list.split('\n').map((l) => l.match(/^• (.+)｜(https?:\/\/\S+)$/)).filter(Boolean)
    .map((m) => ({ name: m[1], url: m[2] }));
  res.json({ ...post, content: body.trim(), attachments });
}));

/** GET /api/campus/clubs?q=&nature= */
router.get('/clubs', asyncHandler(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(50).optional(), nature: z.string().max(20).optional() }).parse(req.query);
  const where = {};
  if (q.nature) where.nature = q.nature;
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { intro: { contains: q.q, mode: 'insensitive' } }];
  const clubs = await prisma.club.findMany({ where, orderBy: { name: 'asc' }, take: 300 });
  // 每個社團附上最近一則相關公告
  const recent = await prisma.campusPost.findMany({
    where: { clubName: { in: clubs.map((c) => c.name) } },
    orderBy: { publishedAt: 'desc' },
    select: { clubName: true, title: true, url: true, publishedAt: true },
  });
  const latest = new Map();
  for (const p of recent) if (!latest.has(p.clubName)) latest.set(p.clubName, p);
  res.json(clubs.map((c) => ({ ...c, latestPost: latest.get(c.name) || null })));
}));

export default router;
