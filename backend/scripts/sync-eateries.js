// 從 Google Places 同步中大周邊店家。建議每週執行一次(座標依 Google 條款最多保存 30 天)。
//
//   npm run sync:eateries               # 預設以中大為中心、半徑 1500 公尺
//   EATERY_RADIUS_M=2500 npm run sync:eateries
//   node scripts/sync-eateries.js --dry-run
//
// 需要 .env 的 GOOGLE_MAPS_API_KEY(Google Cloud 啟用「Places API (New)」)。
// 費用:每次同步約 30~140 次 Nearby Search,一般在 Google 每月免費額度內;實際以 Google 計價頁為準。
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { NCU, offset } from '../src/lib/geo.js';
import { searchNearby, placeDetails, categoryFromTypes, gridCenters, placesEnabled, DEFAULT_TYPES } from '../src/services/places.js';
import { getSystemUser } from '../src/services/systemUser.js';

const DRY = process.argv.includes('--dry-run');
const AREA = Number(process.env.EATERY_RADIUS_M) || 1500;
const STEP = Number(process.env.EATERY_GRID_STEP_M) || 500;
const TYPES = process.env.PLACES_TYPES ? process.env.PLACES_TYPES.split(',') : DEFAULT_TYPES;
const KEEP_DAYS = 30;
const REFRESH_DAYS = 25; // 快到期就重新查一次座標

if (!placesEnabled()) {
  console.error('缺少 GOOGLE_MAPS_API_KEY,無法同步 Google 店家');
  process.exit(1);
}

const found = new Map(); // placeId → place
let calls = 0;

async function scan(center, radius, depth = 0) {
  calls++;
  const places = await searchNearby({ ...center, radius, types: TYPES });
  for (const p of places) if (p.businessStatus !== 'CLOSED_PERMANENTLY') found.set(p.id, p);
  // 回傳剛好 20 筆 = 這格店家太多被截斷 → 切成 4 小格再查(最多切兩層)
  if (places.length >= 20 && depth < 2) {
    const d = radius / 2;
    for (const [dx, dy] of [[-d, -d], [d, -d], [-d, d], [d, d]]) {
      await scan(offset(center, dx, dy), Math.ceil(radius / 1.9), depth + 1);
    }
  }
}

const { centers, radius } = gridCenters(NCU, AREA, STEP);
console.log(`掃描 ${centers.length} 格(每格半徑 ${radius}m)…`);
for (const c of centers) await scan(c, radius);
console.log(`呼叫 ${calls} 次,找到 ${found.size} 家店`);

if (DRY) {
  const byCat = {};
  for (const p of found.values()) {
    const c = categoryFromTypes(p.types, p.primaryType);
    byCat[c] = (byCat[c] || 0) + 1;
  }
  console.log('分類統計', byCat);
  process.exit(0);
}

const owner = await getSystemUser();
const now = new Date();
for (const p of found.values()) {
  const data = {
    lat: p.location.latitude,
    lng: p.location.longitude,
    category: categoryFromTypes(p.types, p.primaryType),
    syncedAt: now,
  };
  await prisma.eatery.upsert({
    where: { googlePlaceId: p.id },
    update: data,
    create: { ...data, source: 'GOOGLE', googlePlaceId: p.id, name: null, ownerId: owner.id },
  });
}

// 這次沒掃到、但座標快過期的店家:個別查詢更新;已歇業或查不到就移除
const stale = await prisma.eatery.findMany({
  where: { source: 'GOOGLE', syncedAt: { lt: new Date(Date.now() - REFRESH_DAYS * 864e5) } },
  select: { id: true, googlePlaceId: true, syncedAt: true },
});
let refreshed = 0, removed = 0;
for (const e of stale) {
  try {
    const d = await placeDetails(e.googlePlaceId, 'id,location,businessStatus');
    if (d.businessStatus === 'CLOSED_PERMANENTLY') throw Object.assign(new Error('closed'), { status: 404 });
    await prisma.eatery.update({ where: { id: e.id }, data: { lat: d.location.latitude, lng: d.location.longitude, syncedAt: now } });
    refreshed++;
  } catch (err) {
    const expired = e.syncedAt < new Date(Date.now() - KEEP_DAYS * 864e5);
    if (err.status === 404 || expired) {
      await prisma.eatery.delete({ where: { id: e.id } }); // 評論會一併刪除(onDelete: Cascade)
      removed++;
    }
  }
}
console.log(`完成:寫入 ${found.size} 家、更新過期座標 ${refreshed} 家、移除 ${removed} 家`);
await prisma.$disconnect();
