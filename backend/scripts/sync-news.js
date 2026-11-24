// 爬取中大最新消息 → AI 標籤 → 存進 CampusPost。建議每天執行一次。
//
//   npm run sync:news                       # 所有來源,增量更新(遇到已存在的公告就停止往回翻)
//   node scripts/sync-news.js --source club-news
//   node scripts/sync-news.js --full        # 不提早停止,翻完 maxPages
//   node scripts/sync-news.js --retag       # 重新替近 60 天的公告貼標(例如剛設定好 AI 金鑰)
//   node scripts/sync-news.js --refresh     # 已存在的公告也重新抓內文與附件(例如解析規則更新後)
//   node scripts/sync-news.js --dry-run     # 只印出解析結果,不寫入資料庫、不呼叫 AI
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { politeFetch } from '../src/lib/fetcher.js';
import { SOURCES } from '../src/crawlers/news/sources.js';
import { parseList, parseDetail, composeContent } from '../src/crawlers/news/parse.js';
import { tagPost } from '../src/services/tagger.js';
import { aiEnabled } from '../src/services/llm.js';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] ?? true : null; };
const DRY = args.includes('--dry-run');
const FULL = args.includes('--full');
const REFRESH = args.includes('--refresh');
const KEEP_DAYS = Number(process.env.NEWS_KEEP_DAYS) || 365;

async function syncSource(src) {
  let created = 0;
  for (let page = 1; page <= src.maxPages; page++) {
    const r = await politeFetch(src.listUrl(page));
    if (!r.ok) break;
    const items = parseList(r.text, src, r.url);
    if (!items.length) {
      if (page === 1) console.warn(`[${src.id}] 列表頁沒有解析到任何公告,網站可能改版,請檢查 sources.js 的 isDetail`);
      break;
    }
    const existing = DRY ? [] : await prisma.campusPost.findMany({
      where: { url: { in: items.map((i) => i.url) } }, select: { url: true },
    });
    const have = new Set(existing.map((e) => e.url));
    const fresh = REFRESH ? items : items.filter((i) => !have.has(i.url));
    console.log(`[${src.id}] 第 ${page} 頁:${items.length} 則,新的 ${fresh.length} 則`);

    for (const item of fresh) {
      const d = await politeFetch(item.url);
      const detail = d.ok ? parseDetail(d.text, d.url) : { content: '', attachments: [], publisher: null, publishedAt: null };
      const post = {
        source: src.id,
        url: item.url,
        title: item.title,
        publisher: item.publisher || detail.publisher,
        rawCategory: item.rawCategory,
        publishedAt: item.publishedAt || detail.publishedAt,
        content: composeContent(detail),
      };
      if (DRY) {
        console.log(' -', post.publishedAt?.toISOString().slice(0, 10), `[${post.rawCategory ?? ''}]`, post.publisher ?? '', '|', post.title);
        console.log('     內文:', (detail.content || '(沒有抓到內文)').replace(/\n/g, ' ').slice(0, 80), `…(附件 ${detail.attachments.length} 個)`);
        continue;
      }
      const tagged = await tagPost(post);
      await prisma.campusPost.upsert({ where: { url: post.url }, update: { ...post, ...tagged }, create: { ...post, ...tagged } });
      created++;
      console.log(`  ✓ ${post.title.slice(0, 40)} → ${tagged.tags.join(', ')}`);
    }
    // 增量模式:這一頁全部都已經存在 → 更舊的頁面也不用看了
    if (!FULL && !REFRESH && fresh.length === 0) break;
  }
  return created;
}

async function retag() {
  const posts = await prisma.campusPost.findMany({
    where: { publishedAt: { gte: new Date(Date.now() - 60 * 864e5) } },
    orderBy: { publishedAt: 'desc' },
  });
  console.log(`重新貼標 ${posts.length} 則(${aiEnabled() ? 'AI' : '規則'}版)`);
  for (const p of posts) {
    const tagged = await tagPost(p);
    await prisma.campusPost.update({ where: { id: p.id }, data: tagged });
    console.log(`  ${p.title.slice(0, 40)} → ${tagged.tags.join(', ')}`);
  }
}

async function main() {
  if (args.includes('--retag')) return retag();
  if (!aiEnabled()) console.log('(未設定 AI_API_KEY,使用關鍵字規則貼標;設定後可用 --retag 重新貼標)');
  const list = opt('source') ? SOURCES.filter((s) => s.id === opt('source')) : SOURCES;
  let total = 0;
  for (const src of list) total += await syncSource(src);
  if (!DRY) {
    const { count } = await prisma.campusPost.deleteMany({
      where: { publishedAt: { lt: new Date(Date.now() - KEEP_DAYS * 864e5) } },
    });
    console.log(`完成:新增 ${total} 則,清除 ${KEEP_DAYS} 天前的舊公告 ${count} 則`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
