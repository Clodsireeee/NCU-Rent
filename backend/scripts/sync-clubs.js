// 同步課外組「社團總覽」(https://club.adm.ncu.edu.tw/clubs)到 Club 資料表。每學期跑一次即可。
//   npm run sync:clubs
//   node scripts/sync-clubs.js --dry-run
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { politeFetch } from '../src/lib/fetcher.js';
import { extractLinks } from '../src/lib/html.js';
import { CLUBS } from '../src/crawlers/news/sources.js';
import { parseClub } from '../src/crawlers/news/parse.js';

const DRY = process.argv.includes('--dry-run');
const urls = new Set();

for (let page = 1; page <= CLUBS.maxPages; page++) {
  const r = await politeFetch(CLUBS.listUrl(page));
  if (!r.ok) break;
  const before = urls.size;
  for (const l of extractLinks(r.text, r.url)) {
    try { if (CLUBS.isDetail(new URL(l.href))) urls.add(l.href.replace(/[?#].*$/, '')); } catch { /* 略過 */ }
  }
  if (urls.size === before) break; // 沒有新社團 = 沒有下一頁
}
console.log(`找到 ${urls.size} 個社團`);

let saved = 0;
for (const url of urls) {
  const r = await politeFetch(url);
  if (!r.ok) continue;
  const c = parseClub(r.text, url, CLUBS.ignoreLinks);
  if (DRY) { console.log(`- ${c.name} [${c.nature ?? '?'}] ${c.links.join(' ')}`); continue; }
  await prisma.club.upsert({
    where: { name: c.name },
    update: { ...c, syncedAt: new Date() },
    create: c,
  });
  saved++;
}
if (!DRY) console.log(`完成:更新 ${saved} 個社團`);
await prisma.$disconnect();
