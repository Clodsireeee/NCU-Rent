// 教育部「雲端租屋生活網」(house.nfu.edu.tw) 房源抓取與解析。
//
// 主要資料來源(用瀏覽器 F12 → Network 找到的):
//   POST https://house.nfu.edu.tw/data/house   內容 {"arrSchId":[94]}   (94 = 國立中央大學)
//   → 一次回傳該校所有房源,包含經緯度,不需要再做地址轉座標
// 詳細頁(補充屋況說明、設備等):https://house.nfu.edu.tw/{學校代碼}/house/{房源編號}
//
// 隱私:API 回傳的房東姓名、電話(lessor_*)刻意「不」儲存,前端只提供原網頁連結。
import { htmlToText, extractLinks, collapse } from '../lib/html.js';

export const HOST = 'https://house.nfu.edu.tw';

const LABELS = [
  '出租房數', '房屋類型', '建物樓層', '出租類型', '獨立電表', '租金', '隔間材質', '押金', '性別要求',
  '其他費用', '無菸租屋', '其他條件', '身份要求', '其他說明', '適用婚育房型', '屋內設備', '公共設施',
  '屋況說明', '學校訪評項目', '熱水器', '安全設施', '證明文件', '關懷訪視', '資訊聲明',
  '可複製QR Code分享房屋資訊 House QR Code',
];
const LABEL_SET = new Set(LABELS);

const ADDRESS_RE =
  /((?:臺北|台北|新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江)縣)?[一-鿿]{1,3}[區鄉鎮市][^\s()（）]{1,40}?號(?:[^\s()（）]{0,12}?樓)?(?:之\d+)?/;

const num = (s) => Number(String(s).replace(/,/g, ''));
const PERIOD_MONTHS = { 月: 1, 季: 3, 學期: 5, 年: 12 };

/** 依標籤切出欄位:標籤那一行之後、到下一個標籤之前的文字 */
function fieldsByLabel(lines) {
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    if (!LABEL_SET.has(lines[i])) continue;
    const vals = [];
    for (let j = i + 1; j < lines.length && !LABEL_SET.has(lines[j]); j++) vals.push(lines[j]);
    if (!(lines[i] in out)) out[lines[i]] = vals.join(' ').trim();
  }
  return out;
}

/** 判斷文字是否提到「可以」申請租補(排除「不可申請租補」) */
export function mentionsSubsidy(text) {
  if (/(不可|無法|不能|不提供|不接受|不得|恕不)[^。，,;；]{0,6}(租補|租金補貼|租屋補助)/.test(text)) return false;
  return /(可|能|接受|配合|同意|提供)[^。，,;；]{0,6}(申請)?(租補|租金補貼|租屋補助)|雙租補/.test(text);
}

/**
 * 解析房源詳細頁 HTML。
 * @returns {null | {title, address, price, priceMax, vacancy, full, updatedAt, schoolName, fields, flags}}
 */
export function parseHouseDetail(html) {
  const text = htmlToText(html);
  const lines = text.split('\n');

  const schoolName =
    text.match(/School Logo\s*\n?\s*([^\n]+?)\s*校外賃居網/)?.[1]?.trim() ||
    html.match(/<title>\s*([^<]+?)\s*校外賃居網/i)?.[1]?.trim() ||
    null;

  // 租金:「每月 5500~6500 元」;也支援每季/每學期/每年(換算成月)
  const pm = text.match(/每(月|季|學期|年)\s*([\d,]+)\s*(?:[~～\-至]\s*([\d,]+))?\s*元/);
  if (!pm) return null; // 不是房源頁
  const months = PERIOD_MONTHS[pm[1]];
  const price = Math.round(num(pm[2]) / months);
  const priceMax = pm[3] ? Math.round(num(pm[3]) / months) : null;

  const priceLineIdx = lines.findIndex((l) => l.includes(pm[0]) || /^每(月|季|學期|年)/.test(l));
  // 地址通常緊接在租金那一行之後;找不到就全文搜尋
  let address = null;
  for (let i = Math.max(0, priceLineIdx); i < Math.min(lines.length, priceLineIdx + 4); i++) {
    const m = lines[i].match(ADDRESS_RE);
    if (m) { address = m[0]; break; }
  }
  address ||= text.match(ADDRESS_RE)?.[0] || null;
  if (!address) return null;

  // 標題:「基本資料 N人瀏覽」與租金之間的那一行
  const statIdx = lines.findIndex((l) => /基本資料/.test(l));
  let title = null;
  for (let i = statIdx + 1; i > 0 && i < priceLineIdx; i++) {
    const l = lines[i].replace(/^\[?滿租\]?$/, '').trim();
    if (l && !/人瀏覽/.test(l)) { title = l; break; }
  }

  const fields = fieldsByLabel(lines);

  // 房型與空房:「[套房 約7 坪]共 208 間; 空房 0 間;」
  const rooms = [...(fields['出租房數'] || text).matchAll(/\[(套房|雅房|整層|家庭式)\s*約?\s*([\d.]+)?\s*坪?\]\s*共\s*(\d+)\s*間[;；]?\s*空房\s*(\d+)\s*間/g)]
    .map((m) => ({ type: m[1], ping: m[2] ? Number(m[2]) : null, total: Number(m[3]), vacant: Number(m[4]) }));
  const full = /滿租/.test(text);
  const vacancy = full ? 0 : rooms.length ? rooms.reduce((s, r) => s + r.vacant, 0) : null;

  const updatedAt = text.match(/於\s*(\d{4}-\d{2}-\d{2})\s*更新/)?.[1] || null;
  const all = [fields['屋況說明'], fields['其他費用'], fields['其他說明'], fields['公共設施'], title].filter(Boolean).join(' ');

  return {
    title: title ? collapse(title).slice(0, 100) : null,
    address: collapse(address),
    price,
    priceMax: priceMax && priceMax !== price ? priceMax : null,
    vacancy,
    full,
    rooms,
    updatedAt,
    schoolName,
    fields,
    flags: {
      rentSubsidy: mentionsSubsidy(all),
      hasTrashService: /垃圾代收|代收垃圾|代丟垃圾|垃圾.{0,3}(處理|集中)/.test(all),
      hasIndoorParking: /室內.{0,4}(機車|車位|停車)|(機車|停車).{0,4}室內|地下.{0,3}(機車|停車)/.test(all),
    },
  };
}

/** 從列表 / 地圖頁 HTML 中找出房源編號 */
export function discoverIds(html, school) {
  const ids = new Set();
  const re = new RegExp(`/(?:index\\.php/)?${school}/(\\d{2,7})(?=["'?#/\\s]|$)`, 'g');
  for (const { href } of extractLinks(html, `${HOST}/${school}`)) {
    for (const m of href.matchAll(re)) ids.add(m[1]);
  }
  // 有些頁面用 JS / data 屬性帶編號
  for (const m of html.matchAll(new RegExp(`["']/?(?:index\\.php/)?${school}/(\\d{2,7})["']`, 'g'))) ids.add(m[1]);
  return [...ids];
}

/** 組成要存進 Property 的描述文字(不含個資) */
export function buildDescription(h) {
  const f = h.fields;
  const parts = [
    h.rooms.length ? `房型:${h.rooms.map((r) => `${r.type}${r.ping ? `約${r.ping}坪` : ''} 共${r.total}間/空${r.vacant}間`).join('、')}` : null,
    f['房屋類型'] && `房屋類型:${f['房屋類型']}`,
    f['出租類型'] && `出租類型:${f['出租類型']}`,
    f['押金'] && `押金:${f['押金']}`,
    f['性別要求'] && `性別:${f['性別要求']}`,
    f['其他費用'] && `其他費用:${f['其他費用']}`,
    f['屋內設備'] && `設備:${f['屋內設備']}`,
    f['公共設施'] && `公共設施:${f['公共設施']}`,
    f['安全設施'] && `安全設施:${f['安全設施']}`,
    f['屋況說明'] && `\n${f['屋況說明']}`,
    '\n(資料來源:教育部雲端租屋網。房東聯絡方式請至原網頁查看)',
  ];
  return parts.filter(Boolean).join('\n').slice(0, 2000);
}

/* ===================== 清單 API ===================== */

const UA = `NCU-Rent-Bot/1.0 (student project; ${process.env.CRAWLER_CONTACT || 'contact: see repo'})`;

/** 從網頁取得 CSRF token 與 cookie(若 API 要求的話才會用到) */
async function getSession() {
  const r = await fetch(`${HOST}/NCU`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const token = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1];
  const cookies = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]);
  const xsrf = cookies.find((c) => c.startsWith('XSRF-TOKEN='))?.slice(11);
  return { token, cookie: cookies.join('; '), xsrf: xsrf ? decodeURIComponent(xsrf) : null };
}

/**
 * 取得指定學校(sch_id)的所有房源。
 * 先直接呼叫;若被拒絕(403/419,通常是 CSRF 保護),就先開首頁拿 token 再試一次。
 */
export async function fetchHouseList(schIds) {
  const body = JSON.stringify({ arrSchId: schIds });
  const base = {
    'User-Agent': UA,
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: HOST,
    Referer: `${HOST}/NCU`,
  };
  const post = (headers) =>
    fetch(`${HOST}/data/house`, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });

  let r = await post(base);
  if (r.status === 403 || r.status === 419) {
    const s = await getSession();
    r = await post({
      ...base,
      ...(s.cookie ? { Cookie: s.cookie } : {}),
      ...(s.token ? { 'X-CSRF-TOKEN': s.token } : {}),
      ...(s.xsrf ? { 'X-XSRF-TOKEN': s.xsrf } : {}),
    });
  }
  if (!r.ok) throw new Error(`房源清單 API 回應 HTTP ${r.status}`);
  const data = await r.json();
  const list = Array.isArray(data) ? data : data?.data || data?.houses || [];
  if (!Array.isArray(list)) throw new Error('房源清單格式不如預期,網站可能改版');
  return list;
}

/** 從 house_url 取出學校代碼與編號,例如 http://house.nfu.edu.tw/NCU/house/3570 → ['NCU','3570'] */
export function parseHouseUrl(url = '') {
  const m = String(url).match(/\/([A-Za-z0-9_]+)\/house\/(\d+)/);
  return m ? [m[1], m[2]] : [null, null];
}

/** API 的一筆房源 → 我們要的格式(不含任何房東個資) */
export function mapApiHouse(h) {
  const [code, idFromUrl] = parseHouseUrl(h.house_url);
  const id = String(h.house_id ?? idFromUrl ?? '');
  const schoolCode = code || 'NCU';
  const nums = String(h.rental || '').match(/\d[\d,]*/g)?.map((n) => Number(n.replace(/,/g, ''))) || [];
  const price = Number.isFinite(h.rental_min) && h.rental_min > 0 ? h.rental_min : nums[0] ?? null;
  const priceMax = nums.length > 1 && nums[1] !== price ? nums[1] : null;
  const lat = parseFloat(h.latitude);
  const lng = parseFloat(h.longitude);
  const full = /滿租/.test(`${h.house_desc || ''}${h.house_title || ''}`);
  const address = `${h.house_city || ''}${h.house_town || ''}${h.house_address || ''}`.trim();
  const img = h.ex_ori_img_path || h.img_path;
  const titleText = [h.house_name, h.house_title].filter(Boolean).join(' ').trim();

  return {
    externalId: `${schoolCode}/${id}`,
    schoolCode,
    schId: h.sch_id ?? null,
    schoolName: h.sch_name || null,
    title: (titleText || `${h.rent_type || '房屋出租'}(${h.house_address || address})`).slice(0, 100),
    address,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    price,
    priceMax,
    vacancy: full ? 0 : Number.isFinite(h.rest_room_num) ? h.rest_room_num : null,
    totalRooms: Number.isFinite(h.all_room_num) ? h.all_room_num : null,
    sourceUrl: `${HOST}/${schoolCode}/house/${id}`,
    modifyDate: h.modify_date || null,
    imageUrl: img ? `${HOST}/${String(img).replace(/^\//, '')}` : null,
    fields: {
      房屋類型: h.house_type || null,
      出租類型: h.rent_type || null,
      押金: h.deposit || null,
      性別要求: h.sex_limit || null,
      獨立電表: h.ammeter || null,
      隔間材質: h.material || null,
      看房: h.look_flag_desc || null,
      樓層: h.layer ? `${h.layer} 層` : null,
      說明: h.house_desc && !/^\[?滿租\]?$/.test(h.house_desc.trim()) ? h.house_desc : null,
    },
  };
}
