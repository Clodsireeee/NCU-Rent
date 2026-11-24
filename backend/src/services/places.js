// Google Places API (New)。
// 使用官方 API 而不是爬 Google 地圖網頁(爬網頁違反 Google 服務條款,也很容易被封鎖)。
//
// Google 條款重點(https://developers.google.com/maps/documentation/places/web-service/policies):
//   - place_id 可以永久保存
//   - 座標最多快取 30 天 → 同步腳本會定期更新 / 清除
//   - 店名、地址、評分、評論等「不可」存進自己的資料庫 → 使用者點開店家時才即時查詢
//   - 顯示資料時要標示「Google Maps」並提供 googleMapsUri 連結
import { offset, distanceM } from '../lib/geo.js';

const BASE = 'https://places.googleapis.com/v1';
const key = () => process.env.GOOGLE_MAPS_API_KEY;
export const placesEnabled = () => !!key();

export const DEFAULT_TYPES = ['restaurant', 'cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop', 'ice_cream_shop', 'meal_takeaway'];
const SAFE_TYPES = ['restaurant', 'cafe', 'bakery', 'meal_takeaway'];

async function call(path, { method = 'GET', body, fields }) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key(),
      'X-Goog-FieldMask': fields,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Places API ${r.status}: ${data.error?.message || r.statusText}`);
    err.status = r.status;
    err.reason = data.error?.status;
    throw err;
  }
  return data;
}

/** 某個圓內的店家(一次最多 20 筆,Google 不提供下一頁) */
export async function searchNearby({ lat, lng, radius, types = DEFAULT_TYPES }) {
  const body = (t) => ({
    includedTypes: t,
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    languageCode: 'zh-TW',
    regionCode: 'TW',
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
  });
  const fields = 'places.id,places.location,places.types,places.primaryType,places.businessStatus';
  try {
    return (await call('/places:searchNearby', { method: 'POST', body: body(types), fields })).places || [];
  } catch (e) {
    // 若某個類型名稱不被支援,改用最保守的類型清單重試
    if (e.reason === 'INVALID_ARGUMENT' && types !== SAFE_TYPES) {
      console.warn('[places] 類型清單不被接受,改用基本類型:', e.message);
      return (await call('/places:searchNearby', { method: 'POST', body: body(SAFE_TYPES), fields })).places || [];
    }
    throw e;
  }
}

export const DETAIL_FIELDS = [
  'id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'priceLevel',
  'regularOpeningHours.weekdayDescriptions', 'currentOpeningHours.openNow', 'googleMapsUri',
  'nationalPhoneNumber', 'websiteUri', 'businessStatus',
].join(',');

/** 即時查詢單一店家(不寫入資料庫) */
export async function placeDetails(placeId, fields = DETAIL_FIELDS) {
  return call(`/places/${encodeURIComponent(placeId)}?languageCode=zh-TW&regionCode=TW`, { fields });
}

const PRICE = {
  PRICE_LEVEL_FREE: '免費', PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

/** 轉成前端要的格式 */
export function toPublicDetails(p) {
  return {
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? 0,
    priceLevel: PRICE[p.priceLevel] ?? null,
    openNow: p.currentOpeningHours?.openNow ?? null,
    hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    mapsUri: p.googleMapsUri ?? null,
    businessStatus: p.businessStatus ?? null,
  };
}

// 前端分類(與 frontend/src/App.jsx 的 CATS 一致)
const CATEGORY_RULES = [
  ['早餐', /breakfast|brunch|bagel|sandwich/],
  ['飲料', /tea_house|juice|bubble|smoothie|drink/],
  ['咖啡甜點', /cafe|coffee|dessert|bakery|ice_cream|donut|chocolate|confectionery|cake|pastry/],
  ['日式', /japanese|ramen|sushi|izakaya|udon|tonkatsu/],
  ['異國', /korean|thai|vietnamese|indian|italian|american|mexican|french|spanish|mediterranean|middle_eastern|pizza|hamburger|steak|indonesian|turkish|greek|brazilian|western/],
  ['小吃', /fast_food|meal_takeaway|snack|street_food|food_court|deli|noodle|dumpling/],
  ['中式', /chinese|taiwanese|hot_pot|dim_sum|cantonese|sichuan|barbecue|seafood|vegetarian|vegan/],
  ['宵夜', /bar|pub|night/],
];

export function categoryFromTypes(types = [], primaryType = '') {
  const list = [primaryType, ...types].filter(Boolean).join(' ');
  for (const [cat, re] of CATEGORY_RULES) if (re.test(primaryType || '')) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(list)) return cat;
  return /restaurant/.test(list) ? '中式' : '其他'; // 中大周邊一般餐廳以台式/中式為主
}

/** 涵蓋半徑 areaRadius 圓形區域的網格中心點,每格圓半徑 = step / √2(剛好蓋滿正方形格) */
export function gridCenters(center, areaRadius, step) {
  const out = [];
  const n = Math.ceil(areaRadius / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const p = offset(center, i * step, j * step);
      if (distanceM(center, p) <= areaRadius + step / 2) out.push(p);
    }
  }
  return { centers: out, radius: Math.ceil((step / Math.SQRT2) * 1.02) };
}
