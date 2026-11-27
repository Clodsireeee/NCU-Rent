// NCU-Rent 的「AI 工具」:租屋代理人(Claude 工具呼叫)與 MCP 伺服器共用同一份。
// 每個工具 = 名稱 + 說明 + 參數格式(JSON Schema)+ 實際執行的函式。
// 全部都是「唯讀」:只查詢公開資料,不會新增、修改或刪除任何東西,也不回傳任何個資。
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { NCU, distanceM } from '../lib/geo.js';
import { geocodePlace } from './geocode.js';
import { TAGS, TAG_NAMES } from './tagger.js';
import { excerpt, splitAttachments, countAttachments, fmtTaipei } from '../lib/campusText.js';

export const siteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const STALE_DAYS = Number(process.env.EXTERNAL_STALE_DAYS) || 45;

/** 工具參數錯誤:會以「工具執行錯誤」回給 AI,讓它自己修正參數再試 */
export class ToolInputError extends Error {}

function parseArgs(schema, args) {
  const r = schema.safeParse(args ?? {});
  if (!r.success) throw new ToolInputError(`參數錯誤:${r.error.issues.map((i) => `${i.path.join('.') || '參數'} ${i.message}`).join(';')}`);
  return r.data;
}

const NCU_ALIASES = /^(中央大學|中大|國立中央大學|ncu|中央|中大校門)$/i;

/** 地點名稱 → 座標;「中央大學」直接用預設座標 */
async function resolvePlace(name) {
  if (!name || NCU_ALIASES.test(name.trim())) return { ...NCU, label: '中央大學', approx: false };
  const p = await geocodePlace(name);
  if (!p) throw new ToolInputError(`找不到地點「${name}」,請換一個更明確的名稱(例如「中壢火車站」)或改用中央大學`);
  return { ...p, approx: false };
}

const SOURCE_LABEL = { USER: '學生/房東刊登', NCU_HOUSE: '中大校外賃居網', NEARBY_SCHOOL: '鄰近學校賃居網', FIRE_LIST: '學校消防合格名單' };
const propertyLink = (id) => `${siteUrl()}/?property=${id}`;

/* ---------------- 房源 ---------------- */

const searchPropertiesSchema = z.object({
  max_price: z.number().int().positive().optional(),
  min_price: z.number().int().nonnegative().optional(),
  rent_subsidy: z.boolean().optional(),
  trash_service: z.boolean().optional(),
  indoor_parking: z.boolean().optional(),
  fire_safe: z.boolean().optional(),
  vacant_only: z.boolean().optional(),
  listing_type: z.enum(['RENT', 'SUBLET', 'SHORT_TERM']).optional(),
  near: z.string().max(60).optional(),
  max_distance_m: z.number().int().positive().max(20000).optional(),
  sort: z.enum(['distance', 'price', 'rating']).default('distance'),
  limit: z.number().int().min(1).max(10).default(6),
});

async function searchProperties(args) {
  const a = parseArgs(searchPropertiesSchema, args);
  const center = await resolvePlace(a.near);
  const cutoff = new Date(Date.now() - STALE_DAYS * 864e5);
  const where = {
    hidden: false,
    NOT: { source: { in: ['NCU_HOUSE', 'NEARBY_SCHOOL'] }, lastSyncedAt: { lt: cutoff } },
    AND: [],
  };
  if (a.max_price !== undefined || a.min_price !== undefined) where.price = { gte: a.min_price, lte: a.max_price };
  if (a.rent_subsidy) where.rentSubsidy = true;
  if (a.trash_service) where.hasTrashService = true;
  if (a.indoor_parking) where.hasIndoorParking = true;
  if (a.fire_safe) where.fireSafetyCertified = true;
  if (a.listing_type) where.listingType = a.listing_type;
  if (a.vacant_only) where.AND.push({ OR: [{ vacancy: null }, { vacancy: { gt: 0 } }] });

  const rows = await prisma.property.findMany({
    where,
    take: 600,
    select: {
      id: true, title: true, address: true, lat: true, lng: true, price: true, priceMax: true, vacancy: true,
      listingType: true, rentSubsidy: true, hasTrashService: true, hasIndoorParking: true,
      fireSafetyCertified: true, source: true,
    },
  });
  let list = rows.map((p) => ({ ...p, distance: Math.round(distanceM(center, p)) }));
  if (a.max_distance_m) list = list.filter((p) => p.distance <= a.max_distance_m);

  const stats = list.length
    ? await prisma.review.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: list.map((p) => p.id) }, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { _all: true },
    })
    : [];
  const sm = new Map(stats.map((s) => [s.propertyId, s]));
  list = list.map((p) => ({ ...p, rating: sm.get(p.id)?._avg.rating ?? null, reviews: sm.get(p.id)?._count._all ?? 0 }));

  const cmp = {
    distance: (x, y) => x.distance - y.distance,
    price: (x, y) => (x.price ?? 1e9) - (y.price ?? 1e9),
    rating: (x, y) => (y.rating ?? 0) - (x.rating ?? 0) || x.distance - y.distance,
  }[a.sort];
  list.sort(cmp);

  return {
    center: center.label,
    total_matched: list.length,
    properties: list.slice(0, a.limit).map((p) => ({
      id: p.id,
      title: p.title,
      address: p.address,
      monthly_rent: p.price == null ? '洽詢' : p.priceMax ? `${p.price}~${p.priceMax}` : p.price,
      distance_m: p.distance,
      vacancy: p.vacancy === 0 ? '滿租' : p.vacancy ?? '未知',
      features: [
        p.rentSubsidy && '可租補', p.hasTrashService && '垃圾代收', p.hasIndoorParking && '室內機車位',
        p.fireSafetyCertified && '學校消防合格', p.listingType === 'SUBLET' && '轉租', p.listingType === 'SHORT_TERM' && '短租',
      ].filter(Boolean),
      avg_rating: p.rating ? Number(p.rating.toFixed(1)) : null,
      review_count: p.reviews,
      source: SOURCE_LABEL[p.source],
      url: propertyLink(p.id),
    })),
  };
}

const idSchema = z.object({ id: z.number().int().positive() });

async function getProperty(args) {
  const { id } = parseArgs(idSchema, args);
  const p = await prisma.property.findUnique({
    where: { id },
    include: { reviews: { where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 15 } },
  });
  if (!p || p.hidden) throw new ToolInputError(`找不到房源 #${id}`);
  const stops = await prisma.garbageStop.findMany();
  const nearestStops = stops
    .map((g) => ({ ...g, d: Math.round(distanceM(p, g)) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 2)
    .map((g) => ({ name: g.name, distance_m: g.d, days: g.days.map((d) => '日一二三四五六'[d]).join(''), time: g.arrivalTime }));
  const avg = p.reviews.length ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : null;
  return {
    id: p.id,
    title: p.title,
    address: p.address,
    monthly_rent: p.price == null ? '洽詢' : p.priceMax ? `${p.price}~${p.priceMax}` : p.price,
    distance_to_ncu_m: Math.round(distanceM(NCU, p)),
    vacancy: p.vacancy === 0 ? '滿租' : p.vacancy ?? '未知',
    listing_type: p.listingType,
    rent_subsidy: p.rentSubsidy,
    trash_service: p.hasTrashService,
    indoor_parking: p.hasIndoorParking,
    fire_safety_certified: p.fireSafetyCertified,
    deposit: p.extra?.deposit ?? null,
    gender_limit: p.extra?.gender ?? null,
    description: (p.description || '').slice(0, 1200),
    avg_rating: avg ? Number(avg.toFixed(1)) : null,
    reviews: p.reviews.map((r) => ({ rating: r.rating, date: fmtTaipei(r.createdAt, { dateOnly: true }), content: r.content.slice(0, 300) })),
    nearest_garbage_stops: nearestStops,
    source: SOURCE_LABEL[p.source],
    source_url: p.sourceUrl,
    url: propertyLink(p.id),
  };
}

const commuteSchema = z.object({ property_id: z.number().int().positive(), destination: z.string().min(1).max(60) });

/** 依直線距離估算通勤時間(含繞路係數);只是概估 */
export function estimateMinutes(meters) {
  const route = meters * 1.3; // 實際路線通常比直線長約三成
  return {
    walk_min: Math.max(1, Math.round(route / 75)),
    bike_min: Math.max(1, Math.round(route / 250)),
    scooter_min: Math.max(2, Math.round(route / 450 + 2)), // +2 分鐘停車
  };
}

async function estimateCommute(args) {
  const a = parseArgs(commuteSchema, args);
  const p = await prisma.property.findUnique({ where: { id: a.property_id }, select: { id: true, title: true, lat: true, lng: true } });
  if (!p) throw new ToolInputError(`找不到房源 #${a.property_id}`);
  const dest = await resolvePlace(a.destination);
  const d = Math.round(distanceM(p, dest));
  return {
    property: `#${p.id} ${p.title}`,
    destination: dest.label,
    straight_distance_m: d,
    ...estimateMinutes(d),
    note: '依直線距離加三成繞路估算,實際時間依路線與交通狀況而定',
  };
}

/* ---------------- 校園消息 ---------------- */

const newsSchema = z.object({
  tags: z.array(z.string()).max(6).optional(),
  query: z.string().max(50).optional(),
  upcoming_only: z.boolean().optional(),
  days: z.number().int().min(1).max(365).default(60),
  limit: z.number().int().min(1).max(10).default(6),
});

const TZ = 8 * 3600e3;
const startOfTodayTaipei = () => new Date(Math.floor((Date.now() + TZ) / 864e5) * 864e5 - TZ);

async function searchCampusNews(args) {
  const a = parseArgs(newsSchema, args);
  const bad = (a.tags || []).filter((t) => !TAG_NAMES.includes(t));
  if (bad.length) throw new ToolInputError(`不認得的標籤:${bad.join('、')}。可用標籤:${TAG_NAMES.join('、')}`);
  const where = { AND: [] };
  if (a.tags?.length) where.AND.push({ tags: { hasSome: a.tags } });
  if (a.query) where.AND.push({ OR: ['title', 'summary', 'content', 'clubName'].map((f) => ({ [f]: { contains: a.query, mode: 'insensitive' } })) });
  if (a.upcoming_only) {
    where.AND.push({ OR: [{ eventEnd: { gte: new Date() } }, { eventEnd: null, eventStart: { gte: startOfTodayTaipei() } }] });
  } else {
    where.AND.push({ OR: [{ publishedAt: { gte: new Date(Date.now() - a.days * 864e5) } }, { publishedAt: null }] });
  }
  const posts = await prisma.campusPost.findMany({
    where,
    orderBy: a.upcoming_only ? [{ eventStart: 'asc' }] : [{ publishedAt: { sort: 'desc', nulls: 'last' } }],
    take: a.limit,
  });
  return {
    count: posts.length,
    posts: posts.map((p) => ({
      id: p.id,
      title: p.title,
      published: fmtTaipei(p.publishedAt, { dateOnly: true }),
      publisher: p.publisher,
      tags: p.tags,
      summary: p.summary || excerpt(p.content, 200),
      event_start: fmtTaipei(p.eventStart),
      event_end: fmtTaipei(p.eventEnd),
      location: p.location,
      club: p.clubName,
      attachments: countAttachments(p.content),
      url: p.url,
    })),
  };
}

async function getCampusNews(args) {
  const { id } = parseArgs(idSchema, args);
  const p = await prisma.campusPost.findUnique({ where: { id } });
  if (!p) throw new ToolInputError(`找不到公告 #${id}`);
  const { body, attachments } = splitAttachments(p.content);
  return {
    id: p.id, title: p.title, published: fmtTaipei(p.publishedAt, { dateOnly: true }), publisher: p.publisher,
    tags: p.tags, summary: p.summary, event_start: fmtTaipei(p.eventStart), event_end: fmtTaipei(p.eventEnd),
    location: p.location, content: body.slice(0, 3000), attachments, url: p.url,
  };
}

async function listNewsTags() {
  const rows = await prisma.$queryRaw`
    SELECT t AS tag, COUNT(*)::int AS count FROM "CampusPost", unnest("tags") AS t
    WHERE "publishedAt" >= NOW() - INTERVAL '180 days' OR "publishedAt" IS NULL GROUP BY t`;
  const counts = new Map(rows.map((r) => [r.tag, r.count]));
  return { tags: TAGS.map(({ tag }) => ({ tag, recent_posts: counts.get(tag) || 0 })) };
}

const clubSchema = z.object({
  query: z.string().max(50).optional(),
  nature: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(15).default(8),
});

async function searchClubs(args) {
  const a = parseArgs(clubSchema, args);
  const where = {};
  if (a.nature) where.nature = a.nature;
  if (a.query) where.OR = [{ name: { contains: a.query, mode: 'insensitive' } }, { intro: { contains: a.query, mode: 'insensitive' } }];
  const clubs = await prisma.club.findMany({ where, orderBy: { name: 'asc' }, take: a.limit });
  return {
    count: clubs.length,
    clubs: clubs.map((c) => ({ name: c.name, nature: c.nature, intro: (c.intro || '').slice(0, 200), links: c.links, url: c.url })),
  };
}

/* ---------------- 工具清單 ---------------- */

const str = (description) => ({ type: 'string', description });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });

export const TOOLS = [
  {
    name: 'search_properties',
    title: '搜尋房源',
    description: '搜尋中央大學周邊的租屋房源,可依租金、距離某地點的遠近、租補、垃圾代收、室內機車位、學校消防合格、是否有空房篩選。回傳房源 id、租金、距離、特色、平均評分。租金單位為新台幣/月。',
    inputSchema: {
      type: 'object',
      properties: {
        max_price: int('每月租金上限(元)'),
        min_price: int('每月租金下限(元)'),
        rent_subsidy: bool('只要可申請租屋補貼的'),
        trash_service: bool('只要有垃圾代收的'),
        indoor_parking: bool('只要有室內機車位的'),
        fire_safe: bool('只要列在學校消防合格名單的'),
        vacant_only: bool('排除已滿租的'),
        listing_type: { type: 'string', enum: ['RENT', 'SUBLET', 'SHORT_TERM'], description: 'RENT 一般租屋、SUBLET 轉租、SHORT_TERM 短租' },
        near: str('以哪個地點為中心計算距離,例如「中央大學」「中壢火車站」;預設中央大學'),
        max_distance_m: int('與中心點的最大直線距離(公尺)', { maximum: 20000 }),
        sort: { type: 'string', enum: ['distance', 'price', 'rating'], description: '排序方式,預設 distance' },
        limit: int('回傳幾筆(1~10,預設 6)', { minimum: 1, maximum: 10 }),
      },
    },
    handler: searchProperties,
  },
  {
    name: 'get_property',
    title: '房源詳情',
    description: '取得單一房源的完整資訊:說明、押金、性別限制、學生評論(已審核)、最近的垃圾車站與時間、原始資料來源網址。',
    inputSchema: { type: 'object', properties: { id: int('房源 id') }, required: ['id'] },
    handler: getProperty,
  },
  {
    name: 'estimate_commute',
    title: '估算通勤時間',
    description: '估算從某間房源到指定地點(例如「中央大學」「中壢火車站」「工程五館」)的步行、腳踏車、機車時間。依直線距離概估。',
    inputSchema: {
      type: 'object',
      properties: { property_id: int('房源 id'), destination: str('目的地名稱') },
      required: ['property_id', 'destination'],
    },
    handler: estimateCommute,
  },
  {
    name: 'search_campus_news',
    title: '搜尋校園消息',
    description: `搜尋中央大學的最新公告與活動(學校公告、中大新聞、課外組/社團公告)。可用標籤篩選,標籤只能是:${TAG_NAMES.join('、')}。upcoming_only=true 會只回傳還沒結束的活動並依活動時間排序。`,
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string', enum: TAG_NAMES }, description: '標籤(符合任一即可)' },
        query: str('關鍵字,比對標題、摘要、內文、社團名稱'),
        upcoming_only: bool('只看即將舉辦、尚未結束的活動'),
        days: int('往回找幾天內的公告(預設 60)', { minimum: 1, maximum: 365 }),
        limit: int('回傳幾筆(1~10,預設 6)', { minimum: 1, maximum: 10 }),
      },
    },
    handler: searchCampusNews,
  },
  {
    name: 'get_campus_news',
    title: '公告全文',
    description: '取得單則校園公告的完整原始內文與附件連結。',
    inputSchema: { type: 'object', properties: { id: int('公告 id') }, required: ['id'] },
    handler: getCampusNews,
  },
  {
    name: 'list_news_tags',
    title: '校園消息標籤',
    description: '列出所有校園消息標籤與近 180 天的公告數量。',
    inputSchema: { type: 'object', properties: {} },
    handler: listNewsTags,
  },
  {
    name: 'search_clubs',
    title: '搜尋社團',
    description: '搜尋中央大學的學生社團(名稱、性質、介紹、IG/FB 連結)。',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('關鍵字,例如「吉他」「登山」「程式」'),
        nature: str('社團性質,例如 學術性、康樂性、聯誼性、服務性、體能性、系學會'),
        limit: int('回傳幾筆(1~15,預設 8)', { minimum: 1, maximum: 15 }),
      },
    },
    handler: searchClubs,
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** 執行工具;回傳 { ok, result } 或 { ok:false, error }(不丟例外) */
export async function runTool(name, args, tools = TOOL_MAP) {
  const tool = tools.get(name);
  if (!tool) return { ok: false, error: `沒有這個工具:${name}` };
  try {
    return { ok: true, result: await tool.handler(args ?? {}) };
  } catch (e) {
    if (e instanceof ToolInputError) return { ok: false, error: e.message };
    console.error(`[tool:${name}]`, e);
    return { ok: false, error: '工具執行時發生錯誤,請稍後再試' };
  }
}
