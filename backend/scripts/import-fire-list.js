// 匯入中大軍訓室「消防合格名單」。
//   npm run import:fire                       # 讀 data/ncu-fire-safety-113.json
//   node scripts/import-fire-list.js 其他.json
//
// 每個地址會:
//   1. 若已有同地址房源 → 標記「消防合格」徽章
//   2. 否則建立一筆「消防合格賃居處所」佔位房源(租金未知,請學生向房東洽詢)
// 重複執行安全。
import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { geocode } from '../src/services/geocode.js';
import { normalizeAddress } from '../src/lib/geo.js';
import { getSystemUser } from '../src/services/systemUser.js';
import { crossMatchFireList } from '../src/services/propertyImport.js';

const file = process.argv[2] || 'data/ncu-fire-safety-113.json';
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const owner = await getSystemUser();
let created = 0, updated = 0, failed = 0;

for (const item of doc.items) {
  const key = normalizeAddress(item.address) + (item.note ? `#${item.note}` : '');
  const existing = await prisma.property.findUnique({ where: { source_externalId: { source: 'FIRE_LIST', externalId: key } } });
  const pos = existing ? { lat: existing.lat, lng: existing.lng } : await geocode(item.address);
  if (!pos) { failed++; console.warn('無法定位:', item.address); continue; }

  const data = {
    title: item.name ? `${item.name}(學校消防合格)` : '學校消防合格賃居處所',
    address: item.address,
    lat: pos.lat,
    lng: pos.lng,
    price: null,
    fireSafetyCertified: true,
    description: `本址列於中大軍訓室公告之 ${doc.year} 年「消防合格名單」。${item.note ? `(${item.note})` : ''}\n租金與空房請向房東洽詢,或參考學校校外賃居網。`,
    sourceUrl: doc.sourceUrl,
    lastSyncedAt: new Date(),
    extra: { year: doc.year, geocodePrecision: pos.precision || null },
  };
  await prisma.property.upsert({
    where: { source_externalId: { source: 'FIRE_LIST', externalId: key } },
    update: data,
    create: { ...data, source: 'FIRE_LIST', externalId: key, ownerId: owner.id },
  });
  existing ? updated++ : created++;
}

const m = await crossMatchFireList();
console.log(`完成:新增 ${created}、更新 ${updated}、定位失敗 ${failed};已有房源標記消防合格 ${m.marked} 筆`);
await prisma.$disconnect();
