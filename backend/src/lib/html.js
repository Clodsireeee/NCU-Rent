// 輕量 HTML 工具:不依賴 cheerio,爬蟲用的「夠用就好」解析。
// 學校網站改版時,通常只要調整 src/crawlers/news/sources.js 的設定即可。

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|dd|dt|dl|blockquote|pre|hr|nav|main|aside|form|label|option)\b[^>]*>/gi;

/** HTML → 純文字(保留區塊換行) */
export function htmlToText(html = '') {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, '')
      .replace(BLOCK, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\f\v 　]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** 取出 <a href> 連結(含在原始 HTML 中的位置,方便抓前後文的日期/分類) */
export function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = decodeEntities(m[3].trim());
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) continue;
    let href;
    try { href = new URL(raw, baseUrl).href; } catch { continue; }
    const attrs = m[1] + m[4];
    const title = attrs.match(/title\s*=\s*(["'])(.*?)\1/i)?.[2];
    const text = htmlToText(m[5]).replace(/\n/g, ' ').trim() || decodeEntities(title || '');
    out.push({ href, text, index: m.index, end: re.lastIndex });
  }
  return out;
}

/** 取第一個符合 tag 的內容區塊(例如 article / main),找不到回傳 null */
export function firstBlock(html, tagOrClassHints = ['article', 'main']) {
  for (const hint of tagOrClassHints) {
    let m;
    if (/^[a-z]+$/.test(hint)) {
      m = html.match(new RegExp(`<${hint}\\b[^>]*>([\\s\\S]*?)<\\/${hint}>`, 'i'));
    } else {
      // class 片段,例如 ".editor"、".content"
      const cls = hint.replace(/^\./, '');
      const open = html.search(new RegExp(`<(div|section)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>`, 'i'));
      if (open >= 0) m = [null, html.slice(open, open + 60000)];
    }
    if (m?.[1] && htmlToText(m[1]).length > 40) return m[1];
  }
  return null;
}

const DATE_RE = /(20\d{2}|1\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;

/** 找出文字中的日期(支援西元與民國年),回傳 [{date, index}] */
export function findDates(text) {
  const out = [];
  let m;
  DATE_RE.lastIndex = 0;
  while ((m = DATE_RE.exec(text))) {
    let y = Number(m[1]);
    if (y < 1000) y += 1911; // 民國
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    out.push({ date: new Date(Date.UTC(y, mo - 1, d, -8)), index: m.index }); // 台灣時間 00:00
  }
  return out;
}

export const collapse = (s = '') => s.replace(/\s+/g, ' ').trim();
