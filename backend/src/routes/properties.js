import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, HttpError, boolStr } from '../lib/http.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { upload, MAX_IMAGES } from '../middleware/upload.js';
import { uploadBuffer, deleteImages } from '../lib/cloudinary.js';
import { anonymizeReview } from './reviews.js';

const router = Router();

/* ---------- 驗證 Schema ---------- */
const fields = {
  title: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(200),
  lat: z.coerce.number().min(21.5).max(25.5), // 台灣範圍
  lng: z.coerce.number().min(119).max(122.5),
  price: z.coerce.number().int().min(0).max(200000),
  description: z.string().trim().max(2000).optional(),
  rentSubsidy: boolStr.optional(),
  hasTrashService: boolStr.optional(),
  hasIndoorParking: boolStr.optional(),
  listingType: z.enum(['RENT', 'SUBLET', 'SHORT_TERM']).optional(),
  availableFrom: z.coerce.date().optional(),
  availableTo: z.coerce.date().optional(),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial();

const listQuery = z.object({
  // bbox = minLng,minLat,maxLng,maxLat (Leaflet: map.getBounds().toBBoxString())
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'bbox 格式錯誤').optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  subsidy: boolStr.optional(),
  trash: boolStr.optional(),
  parking: boolStr.optional(),
  type: z.enum(['RENT', 'SUBLET', 'SHORT_TERM']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/* ---------- 工具 ---------- */
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'ID 格式錯誤');
  return n;
};

async function getOwnedProperty(id, user) {
  const p = await prisma.property.findUnique({ where: { id }, include: { images: true } });
  if (!p) throw new HttpError(404, '找不到此房源');
  if (p.ownerId !== user.id && user.role !== 'ADMIN') throw new HttpError(403, '無權限操作此房源');
  return p;
}

/* ---------- GET /api/properties 地圖範圍查詢 + 篩選 ---------- */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = {};

    if (q.bbox) {
      const [minLng, minLat, maxLng, maxLat] = q.bbox.split(',').map(Number);
      where.lat = { gte: minLat, lte: maxLat };
      where.lng = { gte: minLng, lte: maxLng };
    }
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      where.price = { gte: q.minPrice, lte: q.maxPrice };
    }
    if (q.subsidy) where.rentSubsidy = true;
    if (q.trash) where.hasTrashService = true;
    if (q.parking) where.hasIndoorParking = true;
    if (q.type) where.listingType = q.type;

    const properties = await prisma.property.findMany({
      where,
      take: q.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, address: true, lat: true, lng: true, price: true,
        rentSubsidy: true, hasTrashService: true, hasIndoorParking: true,
        listingType: true, availableFrom: true, availableTo: true,
        images: { take: 1, orderBy: { id: 'asc' }, select: { url: true } },
      },
    });

    // 批次計算平均星等,避免 N+1
    const stats = await prisma.review.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: properties.map((p) => p.id) } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const statMap = new Map(stats.map((s) => [s.propertyId, s]));

    res.json(
      properties.map(({ images, ...p }) => {
        const s = statMap.get(p.id);
        return {
          ...p,
          cover: images[0]?.url ?? null,
          avgRating: s ? Number(s._avg.rating.toFixed(1)) : null,
          reviewCount: s?._count._all ?? 0,
        };
      }),
    );
  }),
);

/* ---------- GET /api/properties/:id 詳情(含匿名評價) ---------- */
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const p = await prisma.property.findUnique({
      where: { id },
      include: {
        images: { orderBy: { id: 'asc' }, select: { id: true, url: true } },
        reviews: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!p) throw new HttpError(404, '找不到此房源');

    const { reviews, ownerId, ...rest } = p;
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
    res.json({
      ...rest,
      avgRating: avg ? Number(avg.toFixed(1)) : null,
      reviewCount: reviews.length,
      canEdit: !!req.user && (req.user.id === ownerId || req.user.role === 'ADMIN'),
      reviews: reviews.map((r) => anonymizeReview(r, req.user)),
    });
  }),
);

/* ---------- POST /api/properties 新增(multipart,圖片欄位 images) ---------- */
router.post(
  '/',
  requireAuth,
  upload.array('images', MAX_IMAGES),
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const uploaded = await Promise.all((req.files ?? []).map((f) => uploadBuffer(f.buffer)));

    try {
      const property = await prisma.property.create({
        data: { ...data, ownerId: req.user.id, images: { create: uploaded } },
        include: { images: { select: { id: true, url: true } } },
      });
      res.status(201).json(property);
    } catch (e) {
      await deleteImages(uploaded.map((u) => u.publicId)); // DB 失敗就回收已上傳圖片
      throw e;
    }
  }),
);

/* ---------- PUT /api/properties/:id 修改欄位 ---------- */
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    await getOwnedProperty(id, req.user);
    const data = updateSchema.parse(req.body);
    const updated = await prisma.property.update({
      where: { id },
      data,
      include: { images: { select: { id: true, url: true } } },
    });
    res.json(updated);
  }),
);

/* ---------- DELETE /api/properties/:id ---------- */
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const p = await getOwnedProperty(id, req.user);
    await prisma.property.delete({ where: { id } }); // 圖片與評價由 onDelete: Cascade 連帶刪除
    await deleteImages(p.images.map((i) => i.publicId));
    res.status(204).end();
  }),
);

/* ---------- POST /api/properties/:id/images 追加圖片 ---------- */
router.post(
  '/:id/images',
  requireAuth,
  upload.array('images', MAX_IMAGES),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const p = await getOwnedProperty(id, req.user);
    const files = req.files ?? [];
    if (!files.length) throw new HttpError(400, '請選擇至少一張圖片');
    if (p.images.length + files.length > MAX_IMAGES)
      throw new HttpError(400, `每個房源最多 ${MAX_IMAGES} 張圖片`);

    const uploaded = await Promise.all(files.map((f) => uploadBuffer(f.buffer)));
    await prisma.propertyImage.createMany({
      data: uploaded.map((u) => ({ ...u, propertyId: id })),
    });
    const images = await prisma.propertyImage.findMany({
      where: { propertyId: id },
      select: { id: true, url: true },
      orderBy: { id: 'asc' },
    });
    res.status(201).json(images);
  }),
);

/* ---------- DELETE /api/properties/:id/images/:imageId ---------- */
router.delete(
  '/:id/images/:imageId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const imageId = parseId(req.params.imageId);
    const p = await getOwnedProperty(id, req.user);
    const img = p.images.find((i) => i.id === imageId);
    if (!img) throw new HttpError(404, '找不到此圖片');
    await prisma.propertyImage.delete({ where: { id: imageId } });
    await deleteImages([img.publicId]);
    res.status(204).end();
  }),
);

export default router;
