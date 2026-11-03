import busData from './data/busStops.json';

// 近似座標,請用 Google Maps 校正
export const STATIONS = [
  { name: '中壢車站', lat: 24.9537, lng: 121.2256 },
  { name: '桃園高鐵站', lat: 25.0128, lng: 121.2148 },
];
const DETOUR = 1.3; // 直線距離 → 實際路徑的估計倍率
export const dist = (a, b) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
export const rideMin = (a, b) => Math.max(1, Math.round((dist(a, b) * DETOUR) / 500)); // 機車約 30km/h
export const walkMin = (a, b) => Math.max(1, Math.round((dist(a, b) * DETOUR) / 80)); // 步行約 80m/min
export const nearestStop = (p) =>
  (busData.stops || []).reduce((best, s) => { const d = dist(p, s); return !best || d < best.d ? { ...s, d } : best; }, null);

export const TYPE_LABEL = { RENT: '一般租賃', SUBLET: '轉租', SHORT_TERM: '學期短租' };
export const fmtTime = (d) => new Date(d).toLocaleString('zh-TW', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export const isOld = (d) => Date.now() - new Date(d) > 2 * 365 * 864e5;
export const DAYS = '日一二三四五六';
