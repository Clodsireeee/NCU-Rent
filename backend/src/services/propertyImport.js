import { prisma } from '../lib/prisma.js';
import { normalizeAddress } from '../lib/geo.js';

/**
 * 交叉比對:消防合格名單上的地址 ↔ 其他來源的房源。
 * 同一地址若已有真實房源(使用者刊登或雲端租屋網),就把它標成消防合格,
 * 並把重複的「名單佔位」房源設為 hidden,避免地圖上同一棟出現兩個標記。
 */
export async function crossMatchFireList() {
  const fire = await prisma.property.findMany({ where: { source: 'FIRE_LIST' }, select: { id: true, address: true, hidden: true } });
  const fireKeys = new Map(fire.map((f) => [normalizeAddress(f.address), f.id]));
  const others = await prisma.property.findMany({
    where: { source: { not: 'FIRE_LIST' } },
    select: { id: true, address: true, fireSafetyCertified: true },
  });

  let marked = 0;
  const covered = new Set();
  for (const p of others) {
    const key = normalizeAddress(p.address);
    if (!fireKeys.has(key)) continue;
    covered.add(fireKeys.get(key));
    if (!p.fireSafetyCertified) {
      await prisma.property.update({ where: { id: p.id }, data: { fireSafetyCertified: true } });
      marked++;
    }
  }
  // (同地址多筆名單資料,例如 A 棟 / B 棟,會被同一個真實房源一起覆蓋)
  for (const f of fire) {
    const dup = fire.some((g) => covered.has(g.id) && normalizeAddress(g.address) === normalizeAddress(f.address));
    if (f.hidden !== dup) await prisma.property.update({ where: { id: f.id }, data: { hidden: dup } });
  }
  return { marked, covered: covered.size };
}
