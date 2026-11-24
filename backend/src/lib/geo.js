// 中央大學校門(中大路 300 號)附近
export const NCU = { lat: 24.9684, lng: 121.1953 };

export function distanceM(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** 往東/北位移 dx, dy 公尺後的座標 */
export function offset(p, dx, dy) {
  return {
    lat: p.lat + dy / 111320,
    lng: p.lng + dx / (111320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

const FW = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 地址正規化,用來比對「同一棟」:
 * 全形轉半形、台→臺、去掉縣市/里/鄰/空白、只保留到「號」。
 *   "桃園市中壢區五權里2鄰中央路232巷47號3樓" → "中壢區中央路232巷47號"
 */
export function normalizeAddress(a = '') {
  let s = FW(a).replace(/\s+/g, '').replace(/台/g, '臺').replace(/之/g, '-');
  s = s.replace(/^(臺灣)?(桃園市|桃園縣)/, '');
  s = s.replace(/(區|鎮|鄉|市)[一-鿿]{1,3}里/, '$1');
  s = s.replace(/\d+鄰/g, '');
  const m = s.match(/^(.*?\d+(?:-\d+)?號)/);
  return m ? m[1] : s;
}

/** 補上「桃園市」方便地理編碼 */
export const fullAddress = (a) => (/^(桃園|臺|台|新北|新竹)/.test(a) ? a : `桃園市${a}`);
