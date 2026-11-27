// 地址 → 座標。
//   GEOCODER=nominatim(預設):OpenStreetMap,免費、結果可永久保存(ODbL),每秒最多 1 次。
//   GEOCODER=google:精準度較高,需 GOOGLE_MAPS_API_KEY;注意 Google 條款限制座標快取最多 30 天,
//                   長期保存請改用 nominatim 或定期重新同步。
import { politeFetch } from '../lib/fetcher.js';
import { fullAddress } from '../lib/geo.js';

const memo = new Map();
const TW = { minLat: 21.5, maxLat: 25.5, minLng: 119, maxLng: 122.5 };
const inTW = (p) => p && p.lat > TW.minLat && p.lat < TW.maxLat && p.lng > TW.minLng && p.lng < TW.maxLng;

async function google(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('GEOCODER=google 需要 GOOGLE_MAPS_API_KEY');
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.search = new URLSearchParams({ address, key, region: 'tw', language: 'zh-TW' });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const d = await r.json();
  const hit = d.results?.[0];
  if (!hit) return null;
  const precise = ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(hit.geometry.location_type);
  return { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng, precision: precise ? 'exact' : 'approx' };
}

async function nominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'tw', limit: '1', 'accept-language': 'zh-TW' });
  const r = await politeFetch(u.href, { robots: false }); // 遵守 Nominatim 使用政策:有 UA、每秒 ≤ 1 次
  if (!r.ok) return null;
  const hit = JSON.parse(r.text || '[]')[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

/** 逐步放寬:完整地址 → 去掉樓層 → 只到巷 → 只到路(標記為 approx) */
export function relaxations(address) {
  // 地理編碼服務不認得「五權里」「2鄰」,先拿掉
  const a = fullAddress(address).replace(/\s+/g, '').replace(/(區|鎮|鄉)[\u4e00-\u9fff]{1,3}里/, '$1').replace(/\d+鄰/g, '');
  const steps = [a, a.replace(/號.*$/, '號')];
  const lane = a.match(/^(.*?(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?\d+巷)/);
  if (lane) steps.push(lane[1]);
  const road = a.match(/^(.*?(?:路|街|大道)(?:[一二三四五六七八九十\d]+段)?)/);
  if (road) steps.push(road[1]);
  return [...new Set(steps)];
}

/** 回傳 { lat, lng, precision: 'exact' | 'approx' } 或 null */
export async function geocode(address) {
  if (!address) return null;
  if (memo.has(address)) return memo.get(address);
  let result = null;
  try {
    if ((process.env.GEOCODER || 'nominatim') === 'google') {
      result = await google(fullAddress(address));
    } else {
      const steps = relaxations(address);
      for (const [i, q] of steps.entries()) {
        const hit = await nominatim(q);
        if (inTW(hit)) { result = { ...hit, precision: i <= 1 ? 'exact' : 'approx' }; break; }
      }
    }
  } catch (e) {
    console.warn('[geocode]', address, e.message);
  }
  if (!inTW(result)) result = null;
  memo.set(address, result);
  return result;
}

/**
 * 地標名稱 → 座標(例如「中壢火車站」「工程五館」)。依序嘗試:原文、加上「中壢」、加上「桃園市」。
 * 回傳 { lat, lng, label } 或 null。
 */
export async function geocodePlace(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  const key = `place:${q}`;
  if (memo.has(key)) return memo.get(key);
  let hit = null;
  for (const query of [q, `${q} 中壢`, `桃園市${q}`]) {
    try {
      hit = (process.env.GEOCODER || 'nominatim') === 'google' ? await google(query) : await nominatim(query);
    } catch { hit = null; }
    if (inTW(hit)) break;
    hit = null;
  }
  const out = hit ? { lat: hit.lat, lng: hit.lng, label: q } : null;
  memo.set(key, out);
  return out;
}
