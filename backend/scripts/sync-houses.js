// 同步教育部雲端租屋網(house.nfu.edu.tw)的房源到 NCU-Rent。
//
// 用法:
//   npm run sync:houses                        # 抓 .env 的 HOUSE_SCHOOL_IDS(預設 94 = 中央大學)
//   node scripts/sync-houses.js --dry-run      # 只印出結果,不寫入資料庫
//   node scripts/sync-houses.js --no-details   # 不去抓每間的詳細頁(較快,但沒有屋況說明、設備)
//   node scripts/sync-houses.js --all-details  # 每間都重新抓詳細頁(預設只抓新的或有更新的)
//   node scripts/sync-houses.js --ids-file data/house-ids.txt   # 備用:手動列出房源(每行 "NCU/3570")
//
// 想加入鄰近學校(中原、元智…):
//   用瀏覽器打開 https://house.nfu.edu.tw/<學校代碼> → F12 → Network → Fetch/XHR → 點「house」→ Payload,
//   看到的 arrSchId 數字就是該校代號,加到 .env:HOUSE_SCHOOL_IDS=94,其他代號
//   鄰近學校只會保留距離中大 NEARBY_RADIUS_KM 公里內的房源。
import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { politeFetch } from '../src/lib/fetcher.js';
import { HOST, fetchHouseList, mapApiHouse, parseHouseDetail, buildDescription } from '../src/crawlers/houseNfu.js';
import { geocode } from '../src/services/geocode.js';
import { NCU, distanceM } from '../src/lib/geo.js';
import { getSystemUser } from '../src/services/systemUser.js';
import { crossMatchFireList } from '../src/services/propertyImport.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] ?? true : null; };
const DRY = args.includes('--dry-run');
const NO_DETAILS = args.includes('--no-details');
const ALL_DETAILS = args.includes('--all-details');

const NCU_SCH_ID = 94;
const SCH_IDS = String(process.env.HOUSE_SCHOOL_IDS || NCU_SCH_ID).split(',').map((s) => Number(s.trim())).filter(Boolean);
const RADIUS = {
  ncu: (Number(process.env.NCU_RADIUS_KM) || 8) * 1000,
  other: (Number(process.env.NEARBY_RADIUS_KM) || 2.5) * 1000,
};

/** 合併詳細頁資料(屋況說明、設備、安全設施、租補/垃圾/機車位) */
async function withDetails(m) {
  const r = await politeFetch(m.sourceUrl);
  const d = r.ok ? parseHouseDetail(r.text) : null;
  if (!d) return { fields: m.fields, flags: null, rooms: [] };
  return { fields: { ...m.fields, ...d.fields }, flags: d.flags, rooms: d.rooms };
}

function describe(m, fields, rooms) {
  const base = buildDescription({ fields, rooms: rooms || [] });
  const extra = [
    m.totalRooms != null && `總房數 ${m.totalRooms} 間${m.vacancy != null ? `,空房 ${m.vacancy} 間` : ''}`,
    fields['樓層'] && `樓層:${fields['樓層']}`,
    fields['看房'],
    fields['說明'],
  ].filter(Boolean).join('\n');
  return `${extra}\n${base}`.trim().slice(0, 2000);
}

async function saveOne(m, owner, seen, stats) {
  const source = m.schId === NCU_SCH_ID || m.schoolCode === 'NCU' ? 'NCU_HOUSE' : 'NEARBY_SCHOOL';
  let pos = m.lat && m.lng ? { lat: m.lat, lng: m.lng, precision: 'source' } : await geocode(m.address);
  if (!pos) { stats.noLocation++; console.warn('  無法定位:', m.address); return; }

  const d = distanceM(NCU, pos);
  if (d > (source === 'NCU_HOUSE' ? RADIUS.ncu : RADIUS.other)) { stats.skippedFar++; return; }

  const existing = DRY ? null : await prisma.property.findUnique({
    where: { source_externalId: { source, externalId: m.externalId } },
  });
  seen.add(`${source}:${m.externalId}`);

  // 詳細頁:新的、或來源網站有更新的才抓(省時間也減輕學校伺服器負擔)
  // (試跑模式預設不抓詳細頁,幾秒就能看到結果;要連詳細頁一起試請加 --all-details)
  const needDetail = !NO_DETAILS && (ALL_DETAILS || (!DRY && (!existing || existing.extra?.sourceUpdatedAt !== m.modifyDate)));
  const det = needDetail ? await withDetails(m) : null;
  const fields = det?.fields || existing?.extra?.fields || m.fields;
  const flags = det?.flags || (existing
    ? { rentSubsidy: existing.rentSubsidy, hasTrashService: existing.hasTrashService, hasIndoorParking: existing.hasIndoorParking }
    : {});

  const data = {
    title: m.title,
    address: m.address,
    lat: pos.lat,
    lng: pos.lng,
    price: m.price,
    priceMax: m.priceMax,
    vacancy: m.vacancy,
    description: det ? describe(m, fields, det.rooms) : existing?.description || describe(m, fields, []),
    ...flags,
    sourceUrl: m.sourceUrl,
    hidden: false,
    lastSyncedAt: new Date(),
    extra: {
      school: m.schoolName,
      schId: m.schId,
      totalRooms: m.totalRooms,
      imageUrl: m.imageUrl,
      fields,
      deposit: fields['押金'] || null,
      gender: fields['性別要求'] || null,
      houseType: fields['房屋類型'] || null,
      rentType: fields['出租類型'] || null,
      sourceUpdatedAt: m.modifyDate,
      geocodePrecision: pos.precision || null,
      distanceM: Math.round(d),
    },
  };

  const price = `$${data.price ?? '?'}${data.priceMax ? `~${data.priceMax}` : ''}`;
  if (DRY) {
    console.log(`  ${m.externalId} ${data.title} ${price} ${data.address} (${Math.round(d)}m)${data.vacancy === 0 ? ' [滿租]' : ''}`);
    stats.saved++;
    return;
  }
  await prisma.property.upsert({
    where: { source_externalId: { source, externalId: m.externalId } },
    update: data,
    create: { ...data, source, externalId: m.externalId, ownerId: owner.id },
  });
  stats.saved++;
  console.log(`  ✓ ${m.externalId} ${data.title} ${price} (${Math.round(d)}m)`);
}

async function fromApi(owner, stats) {
  console.log(`呼叫房源清單 API(學校代號 ${SCH_IDS.join(', ')})…`);
  const list = await fetchHouseList(SCH_IDS);
  console.log(`取得 ${list.length} 筆房源`);
  const seen = new Set();
  for (const h of list) await saveOne(mapApiHouse(h), owner, seen, stats);

  // 這次清單裡沒有的房源 = 已從來源網站下架 → 在地圖上隱藏
  if (!DRY && list.length > 0) {
    const codes = [...new Set(list.map((h) => mapApiHouse(h).schoolCode))];
    const old = await prisma.property.findMany({
      where: { source: { in: ['NCU_HOUSE', 'NEARBY_SCHOOL'] }, hidden: false, OR: codes.map((c) => ({ externalId: { startsWith: `${c}/` } })) },
      select: { id: true, source: true, externalId: true },
    });
    const gone = old.filter((p) => !seen.has(`${p.source}:${p.externalId}`));
    if (gone.length) {
      await prisma.property.updateMany({ where: { id: { in: gone.map((p) => p.id) } }, data: { hidden: true } });
      console.log(`已下架(隱藏)${gone.length} 筆`);
    }
  }
}

async function fromIdsFile(file, owner, stats) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const seen = new Set();
  for (const line of lines) {
    const [code, id] = line.includes('/') ? line.split('/').slice(-2) : ['NCU', line];
    const url = `${HOST}/${code}/house/${id}`;
    const r = await politeFetch(url);
    const h = r.ok ? parseHouseDetail(r.text) : null;
    if (!h) { stats.notFound++; console.warn('  讀不到:', url); continue; }
    await saveOne({
      externalId: `${code}/${id}`, schoolCode: code, schId: code === 'NCU' ? NCU_SCH_ID : null, schoolName: h.schoolName,
      title: h.title || h.fields['出租類型'] || '房屋出租', address: h.address, lat: null, lng: null,
      price: h.price, priceMax: h.priceMax, vacancy: h.vacancy, totalRooms: null, sourceUrl: url,
      modifyDate: h.updatedAt, imageUrl: null, fields: h.fields,
    }, owner, seen, stats);
  }
}

async function main() {
  const owner = DRY ? { id: 0 } : await getSystemUser();
  const stats = { saved: 0, skippedFar: 0, noLocation: 0, notFound: 0 };
  if (opt('ids-file')) await fromIdsFile(opt('ids-file'), owner, stats);
  else await fromApi(owner, stats);

  if (!DRY) {
    const m = await crossMatchFireList();
    console.log(`消防合格比對:新增標記 ${m.marked} 筆`);
  }
  console.log('完成', { 寫入: stats.saved, 太遠略過: stats.skippedFar, 無法定位: stats.noLocation, 讀取失敗: stats.notFound });
}

main()
  .catch((e) => { console.error('同步失敗:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
