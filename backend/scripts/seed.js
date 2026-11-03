// 用法: npm run seed            (讀 data/seed.json)
//       node scripts/seed.js 其他檔.json
// 重複執行安全:相同 title+address 的房源會略過。
import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const items = JSON.parse(fs.readFileSync(process.argv[2] || 'data/seed.json', 'utf8'));

const mkUser = (key) =>
  prisma.user.upsert({
    where: { googleId: `seed-${key}` },
    update: {},
    create: { googleId: `seed-${key}`, email: `seed-${key}@ncu-rent.local`, name: '初始資料匯入' },
  });

let added = 0;
for (const [i, { reviews = [], ...p }] of items.entries()) {
  const exists = await prisma.property.findFirst({ where: { title: p.title, address: p.address } });
  if (exists) { console.log('略過(已存在):', p.title); continue; }
  const owner = await mkUser('owner');
  const property = await prisma.property.create({ data: { ...p, ownerId: owner.id } });
  for (const [j, r] of reviews.entries()) {
    const u = await mkUser(`${i}-${j}`); // 每則評價一個匿名帳號,避開「同人只能評一次」限制
    await prisma.review.create({ data: { rating: r.rating, content: r.content, userId: u.id, propertyId: property.id } });
  }
  added++;
  console.log('已匯入:', p.title, `(${reviews.length} 則評價)`);
}
console.log(`完成,新增 ${added} 間`);
await prisma.$disconnect();
