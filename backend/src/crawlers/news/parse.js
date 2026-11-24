// 列表頁 / 內文頁的通用解析(不綁特定 HTML 結構,靠連結 + 前後文字推斷日期、分類、單位)
import { extractLinks, htmlToText, firstBlock, findDates, collapse } from '../../lib/html.js';

// 有些網站把整則公告(標題 + 日期 + 內文開頭)包成一個大連結 → 標題只取日期前面那段
export const cleanTitle = (t) =>
  collapse(t).split(/\s+(?:20\d{2}|1\d{2})[-/.]\d{1,2}[-/.]\d{1,2}/)[0].slice(0, 200);

const CONTENT_HINTS = ['article', '.editor', '.ck-content', '.content', '.post', '.mpgdetail', '.news', 'main'];

/**
 * 從列表頁抓出公告項目。
 * @returns [{ url, title, publishedAt, rawCategory, publisher }]
 */
export function parseList(html, source, baseUrl) {
  const links = extractLinks(html, baseUrl).filter((l) => {
    try { return source.isDetail(new URL(l.href)) && l.text.length >= 4; } catch { return false; }
  });
  const seen = new Set();
  const items = [];
  links.forEach((l, i) => {
    const url = l.href.replace(/#.*$/, '');
    if (seen.has(url)) {
      // 同一則公告可能有兩個連結(圖片 + 標題),保留較長的標題
      const it = items.find((x) => x.url === url);
      if (it && cleanTitle(l.text).length > it.title.length) it.title = cleanTitle(l.text);
      return;
    }
    seen.add(url);
    const prevEnd = i > 0 ? links[i - 1].end : Math.max(0, l.index - 1500);
    const nextStart = i < links.length - 1 ? links[i + 1].index : l.end + 1500;
    const before = htmlToText(html.slice(Math.max(prevEnd, l.index - 1500), l.index)).replace(/\n/g, ' ');
    const after = htmlToText(html.slice(l.end, Math.min(nextStart, l.end + 600))).replace(/\n/g, ' ');

    const datesBefore = findDates(before);
    const datesAfter = findDates(after);
    const publishedAt = (datesBefore.at(-1) || datesAfter[0] || findDates(l.text)[0])?.date ?? null;

    let rawCategory = null;
    for (const c of source.categories || []) {
      const at = before.lastIndexOf(c);
      if (at >= 0 && (rawCategory === null || at > before.lastIndexOf(rawCategory))) rawCategory = c;
    }

    // 單位:「演講 學務處住宿服務組2025-04-17」或「2025/09/17‧物理學系」
    let publisher =
      before.match(/(?:行政|演講|徵才|活動|其他)\s+([^\d\s|]{2,25}?)\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*$/)?.[1] ||
      after.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*[‧·・]\s*([^\s|]{2,25})/)?.[1] ||
      null;
    publisher ||= source.publisher || null;

    items.push({ url, title: cleanTitle(l.text), publishedAt, rawCategory, publisher });
  });
  return items;
}

// 內文裡常見、但不是公告內容的雜訊行(導覽、分享按鈕…)
const NOISE = /^(首頁|回首頁|回上頁|上一頁|下一頁|回列表|返回列表|列印|分享|分享至.*|友善列印|字級.*|:::|TOP|Top|點閱.*|瀏覽人次.*|更新時間.*|Facebook|Line|Twitter|X|Email)$/;
const FILE_RE = /\.(pdf|docx?|odt|xlsx?|ods|pptx?|odp|zip|rar|7z|jpe?g|png)(\?|#|$)/i;

/**
 * 內文頁:主要內容純文字、附件連結、單位、日期(若列表頁沒抓到)
 * @param {string} html
 * @param {string} [url] 內文頁網址,用來把附件的相對路徑轉成完整網址
 */
export function parseDetail(html, url = 'https://www.ncu.edu.tw/') {
  const block = firstBlock(html, CONTENT_HINTS);
  const scope = block || html.replace(/<(header|nav|footer)\b[\s\S]*?<\/\1>/gi, '');
  const text = htmlToText(scope)
    .split('\n')
    .filter((l) => !NOISE.test(l.trim()))
    .join('\n');
  const full = htmlToText(html);
  const publisher =
    full.match(/(?:公告單位|發布單位|發佈單位|單位)\s*[:：]?\s*\n?\s*([^\n:：]{2,25})/)?.[1]?.trim() || null;
  const dateLine = full.match(/(?:公告日期|發布日期|發佈日期|張貼時間|日期|Date)\s*[:：]?\s*\n?\s*([^\n]{6,30})/i)?.[1];
  const publishedAt = dateLine ? findDates(dateLine)[0]?.date ?? null : null;

  // 附件:內容區塊中的檔案連結(PDF、Word…),或網址含 download / attach / file 的連結
  const seen = new Set();
  const attachments = extractLinks(block ? scope : html, url)
    .filter((l) => FILE_RE.test(l.href) || /download|attach|files?\//i.test(l.href))
    .filter((l) => !/\.(css|js)(\?|$)/i.test(l.href) && !seen.has(l.href) && seen.add(l.href))
    .map((l) => ({
      name: (l.text || decodeURIComponent(l.href.split('/').pop().split('?')[0]) || '附件').slice(0, 120),
      url: l.href,
    }))
    .slice(0, 20);

  return { content: text.slice(0, 4000), attachments, publisher, publishedAt };
}

/** 存進資料庫的內文:本文 + 附件清單(前端會把網址變成可點的連結) */
export function composeContent(detail) {
  const body = (detail.content || '').trim();
  if (!detail.attachments?.length) return body;
  const list = detail.attachments.map((a) => `• ${a.name}｜${a.url}`).join('\n');
  return `${body}\n\n附件:\n${list}`.slice(0, 6000);
}

const NATURE = /^(學術性|康樂性|聯誼性|服務性|系學會|體能性|自治性|學藝性|綜合性|體育性|音樂性|宗教性)(社團)?$/;

/** 社團詳細頁 */
export function parseClub(html, url, ignoreLinks = []) {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const lines = htmlToText(html).split('\n');
  const natureIdx = lines.findIndex((l) => NATURE.test(l));
  const endIdx = lines.findIndex((l, i) => i > natureIdx && /^(基本資訊|聯絡我們|社辦地點)/.test(l));
  const intro = natureIdx >= 0
    ? lines.slice(natureIdx + 1, endIdx > 0 ? endIdx : natureIdx + 12).join('\n').slice(0, 1500)
    : null;
  const links = [...new Set(
    extractLinks(html, url)
      .map((l) => l.href)
      .filter((h) => /instagram\.com|facebook\.com|fb\.com|linktr\.ee|youtube\.com|discord\.gg|line\.me/i.test(h))
      .filter((h) => !ignoreLinks.some((re) => re.test(h))),
  )].slice(0, 6);
  return { name, nature: natureIdx >= 0 ? lines[natureIdx].replace(/社團$/, '') : null, intro, url, links };
}
