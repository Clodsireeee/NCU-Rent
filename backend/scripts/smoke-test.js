// 用法(PowerShell):
//   $env:BASE="https://你的網址"; $env:TOKEN="登入後的token"; npm run smoke
// 沒設 TOKEN 只跑公開測試;沒設 BASE 預設測 http://localhost:4000
const BASE = process.env.BASE || 'http://localhost:4000';
const TOKEN = process.env.TOKEN;
let pass = 0, fail = 0;

const auth = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const call = (path, { method = 'GET', json, token = true } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? auth : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} 預期 ${b},實際 ${a}`); };
async function t(name, fn) {
  try { await fn(); console.log('✅', name); pass++; }
  catch (e) { console.log('❌', name, '-', e.message); fail++; }
}

console.log(`測試目標: ${BASE}\n`);
await t('健康檢查', async () => eq((await call('/health')).status, 200, 'status'));
await t('房源列表為陣列', async () => { const r = await call('/api/properties'); eq(r.status, 200, 'status'); if (!Array.isArray(await r.json())) throw new Error('不是陣列'); });
await t('bbox 查詢可用', async () => eq((await call('/api/properties?bbox=121.18,24.96,121.20,24.98&subsidy=true')).status, 200, 'status'));
await t('錯誤 bbox 回 400', async () => eq((await call('/api/properties?bbox=abc')).status, 400, 'status'));
await t('未登入新增房源回 401', async () => eq((await call('/api/properties', { method: 'POST', json: {}, token: false })).status, 401, 'status'));
await t('未登入寫評價回 401', async () => eq((await call('/api/properties/1/reviews', { method: 'POST', json: {}, token: false })).status, 401, 'status'));
await t('消防合格篩選可用', async () => eq((await call('/api/properties?fireSafe=true&vacantOnly=true')).status, 200, 'status'));
await t('美食列表為陣列', async () => { const r = await call('/api/eateries'); eq(r.status, 200, 'status'); if (!Array.isArray(await r.json())) throw new Error('不是陣列'); });
await t('校園標籤清單', async () => { const r = await call('/api/campus/tags'); eq(r.status, 200, 'status'); if (!(await r.json()).some((t) => t.tag === '社團活動')) throw new Error('缺少社團活動標籤'); });
await t('校園消息依標籤篩選', async () => { const r = await call('/api/campus/posts?tags=社團活動,講座演講&match=any'); eq(r.status, 200, 'status'); if (!Array.isArray((await r.json()).items)) throw new Error('沒有 items'); });
await t('即將舉辦活動', async () => eq((await call('/api/campus/posts?upcoming=true')).status, 200, 'status'));
await t('社團名錄', async () => eq((await call('/api/campus/clubs')).status, 200, 'status'));
await t('未登入進審核後台回 401', async () => eq((await call('/api/admin/moderation', { token: false })).status, 401, 'status'));

if (!TOKEN) {
  console.log('\n⚠️ 未設定 TOKEN,略過需登入的測試');
} else {
  let pid, rid;
  await t('登入者資訊', async () => eq((await call('/auth/me')).status, 200, 'status'));
  await t('新增測試房源', async () => {
    const r = await call('/api/properties', { method: 'POST', json: { title: '[smoke]測試', address: '測試地址', lat: 24.968, lng: 121.187, price: 6000, rentSubsidy: true } });
    eq(r.status, 201, 'status'); pid = (await r.json()).id;
  });
  await t('評價太短回 400', async () => eq((await call(`/api/properties/${pid}/reviews`, { method: 'POST', json: { rating: 5, content: '短' } })).status, 400, 'status'));
  await t('星級超出範圍回 400', async () => eq((await call(`/api/properties/${pid}/reviews`, { method: 'POST', json: { rating: 9, content: '這是一則足夠長的評價內容' } })).status, 400, 'status'));
  await t('新增評價', async () => {
    const r = await call(`/api/properties/${pid}/reviews`, { method: 'POST', json: { rating: 4, content: '這是一則足夠長的評價內容' } });
    eq(r.status, 201, 'status'); rid = (await r.json()).id;
  });
  await t('辱罵評價被攔下回 422', async () => {
    const r = await call(`/api/properties/${pid}/reviews`, { method: 'POST', json: { rating: 1, content: '幹你娘這什麼爛房東,去死啦' } });
    eq(r.status, 422, 'status');
  });
  await t('重複評價回 409', async () => eq((await call(`/api/properties/${pid}/reviews`, { method: 'POST', json: { rating: 4, content: '這是一則足夠長的評價內容' } })).status, 409, 'status'));
  await t('詳情不洩漏評價者身分', async () => {
    const txt = JSON.stringify(await (await call(`/api/properties/${pid}`)).json());
    if (/email|googleId|userId|ncu\.edu/i.test(txt)) throw new Error('回傳含有身分欄位!');
  });
  await t('不能檢舉自己的評價', async () => eq((await call(`/api/reviews/${rid}/report`, { method: 'POST', json: { reason: '測試' } })).status, 400, 'status'));
  await t('刪除評價', async () => eq((await call(`/api/reviews/${rid}`, { method: 'DELETE' })).status, 204, 'status'));
  await t('刪除測試房源', async () => eq((await call(`/api/properties/${pid}`, { method: 'DELETE' })).status, 204, 'status'));
}
console.log(`\n通過 ${pass},失敗 ${fail}`);
process.exit(fail ? 1 : 0);
