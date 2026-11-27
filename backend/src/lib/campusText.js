// 校園公告內文的共用小工具(campus 路由、AI 工具、新生入學包都會用到)

/** 內文開頭:去掉附件清單,取前 n 字 */
export function excerpt(content, n = 150) {
  if (!content) return null;
  const body = content.split('\n附件:')[0].replace(/\s+/g, ' ').trim();
  return body.length > n ? `${body.slice(0, n)}…` : body || null;
}

/** 把存在資料庫的內文拆成 { body, attachments: [{name, url}] } */
export function splitAttachments(content = '') {
  const [body, list = ''] = (content || '').split('\n附件:\n');
  const attachments = list
    .split('\n')
    .map((l) => l.match(/^• (.+)｜(https?:\/\/\S+)$/))
    .filter(Boolean)
    .map((m) => ({ name: m[1], url: m[2] }));
  return { body: body.trim(), attachments };
}

export const countAttachments = (content) => (content?.match(/^• .+｜https?:\/\//gm) || []).length;

/** Date → 台灣時間字串,例如 "2026-12-03 14:00";只有日期時省略 00:00 */
export function fmtTaipei(d, { dateOnly = false } = {}) {
  if (!d) return null;
  const s = new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false }).slice(0, 16);
  return dateOnly || s.endsWith('00:00') ? s.slice(0, 10) : s;
}
