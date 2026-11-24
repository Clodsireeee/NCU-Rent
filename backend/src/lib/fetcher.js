// 有禮貌的爬蟲 fetch:每個網站之間保持間隔、遵守 robots.txt、逾時與重試。
// 請不要把 CRAWL_DELAY_MS 調太小,學校伺服器很容易被打掛。

const DELAY = Number(process.env.CRAWL_DELAY_MS) || 1500;
const UA =
  process.env.CRAWLER_USER_AGENT ||
  `NCU-Rent-Bot/1.0 (student project; ${process.env.CRAWLER_CONTACT || 'contact: see repo'})`;

const lastHit = new Map();
const robotsCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTurn(host) {
  const wait = (lastHit.get(host) || 0) + DELAY - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** 解析 robots.txt 中適用於所有爬蟲(*)的 Disallow 規則 */
export function parseRobots(txt) {
  const rules = [];
  let applies = false;
  let lastWasUA = false; // 連續多行 User-agent 屬於同一組
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k.trim())) {
      const match = v === '*' || /ncu-rent/i.test(v);
      applies = lastWasUA ? applies || match : match;
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (applies && /^disallow$/i.test(k.trim()) && v) rules.push(v);
  }
  return rules;
}

async function allowed(url) {
  if (process.env.CRAWL_IGNORE_ROBOTS === '1') return true;
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (r.ok) rules = parseRobots(await r.text());
    } catch { /* 拿不到 robots.txt 視為允許 */ }
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  return !robotsCache.get(u.origin).some((rule) => path.startsWith(rule));
}

/**
 * 取得網頁文字。回傳 { ok, status, text, url }。
 * 不丟例外(爬蟲一頁失敗不該讓整批停掉),由呼叫端判斷 ok。
 */
export async function politeFetch(url, { retries = 2, timeout = 20000, headers = {}, robots = true } = {}) {
  // robots=false 只用於「公開 API」(例如 Nominatim),不是爬網頁
  if (robots && !(await allowed(url))) {
    console.warn('[robots] 不允許抓取,略過:', url);
    return { ok: false, status: 0, text: '', url };
  }
  const host = new URL(url).host;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitTurn(host);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '', url: r.url || url };
    } catch (e) {
      if (attempt === retries) {
        console.warn(`[fetch] 失敗 ${url}: ${e.message}`);
        return { ok: false, status: 0, text: '', url };
      }
      await sleep(2000 * (attempt + 1));
    }
  }
}
