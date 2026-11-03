// 部署後在 .env.production 設 VITE_API_URL=https://你的後端網址;開發時留空,走 vite proxy
const BASE = import.meta.env.VITE_API_URL || '';

export async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'include', // 帶上登入 cookie
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.details?.[0]?.message || data?.error || '發生錯誤');
  return data;
}

export const loginUrl = BASE + '/auth/google';
