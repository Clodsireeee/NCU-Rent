// AI 使用次數限制:避免有人狂按把 API 費用刷爆。
//   每個登入使用者每小時 AGENT_HOURLY_LIMIT 次(預設 20),未登入的訪客每個 IP 每小時 AGENT_GUEST_HOURLY_LIMIT 次(預設 5)
//   全站每天最多 AGENT_DAILY_LIMIT 次(預設 300),超過就暫停到隔天
// (存在記憶體裡,伺服器重開就歸零;小型專題夠用)
const hourly = new Map(); // key → { start, count }
let daily = { day: '', count: 0 };

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });

export function checkQuota(key, isGuest) {
  const limit = isGuest ? Number(process.env.AGENT_GUEST_HOURLY_LIMIT ?? 5) : Number(process.env.AGENT_HOURLY_LIMIT ?? 20);
  const dailyLimit = Number(process.env.AGENT_DAILY_LIMIT ?? 300);
  if (daily.day !== today()) daily = { day: today(), count: 0 };
  if (daily.count >= dailyLimit) return { ok: false, message: '今天的 AI 使用量已達上限,明天再來吧!' };
  if (limit <= 0) return { ok: false, message: isGuest ? '請先登入才能使用 AI 助理' : 'AI 助理目前暫停使用' };

  const now = Date.now();
  const h = hourly.get(key);
  if (!h || now - h.start > 3600e3) hourly.set(key, { start: now, count: 0 });
  const cur = hourly.get(key);
  if (cur.count >= limit) {
    const min = Math.ceil((cur.start + 3600e3 - now) / 60000);
    return { ok: false, message: `使用次數已達上限,請 ${min} 分鐘後再試${isGuest ? ',或登入後可使用更多次' : ''}` };
  }
  cur.count++;
  daily.count++;
  if (hourly.size > 5000) for (const [k, v] of hourly) if (now - v.start > 3600e3) hourly.delete(k);
  return { ok: true, remaining: limit - cur.count };
}

export const _resetQuota = () => { hourly.clear(); daily = { day: '', count: 0 }; };
