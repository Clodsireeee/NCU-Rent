// 生成式 AI 功能測試:不呼叫真的 Claude、不連資料庫(都用假的替身)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, sanitizeHistory, anthropicTools } from '../src/services/agent.js';
import { handleMcp, decodeHeader, originAllowed } from '../src/routes/mcp.js';
import { validateGuide, buildFreshmanGuide, freshmanSchema } from '../src/services/freshman.js';
import { checkQuota, _resetQuota } from '../src/services/aiQuota.js';
import { TOOLS, runTool, estimateMinutes, ToolInputError } from '../src/services/rentTools.js';

// 假工具:記錄被呼叫的參數
const calls = [];
const fakeTools = new Map([
  ['search_properties', {
    name: 'search_properties', title: '搜尋房源', description: 'd', inputSchema: { type: 'object', properties: {} },
    handler: async (a) => { calls.push(['search_properties', a]); return { center: '中央大學', total_matched: 2, properties: [{ id: 12 }, { id: 7 }] }; },
  }],
  ['get_property', {
    name: 'get_property', title: '房源詳情', description: 'd', inputSchema: { type: 'object', properties: {} },
    handler: async (a) => { if (a.id === 999) throw new ToolInputError('找不到房源 #999'); return { title: '嵐苑', reviews: [{}, {}] }; },
  }],
]);

test('runAgent:Claude 先呼叫工具、拿到結果後回答', async () => {
  calls.length = 0;
  const sent = [];
  const script = [
    { stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 }, content: [
      { type: 'text', text: '我先找找看' },
      { type: 'tool_use', id: 't1', name: 'search_properties', input: { max_price: 7000 } },
    ] },
    { stop_reason: 'tool_use', usage: { input_tokens: 150, output_tokens: 20 }, content: [
      { type: 'tool_use', id: 't2', name: 'get_property', input: { id: 12 } },
      { type: 'tool_use', id: 't3', name: 'get_property', input: { id: 999 } },
    ] },
    { stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 80 }, content: [{ type: 'text', text: '推薦 [房源#12],其次 [房源#7]。' }] },
  ];
  const call = async (req) => { sent.push(structuredClone(req)); return script[sent.length - 1]; };

  const out = await runAgent([{ role: 'user', content: '7000 以內的套房' }], { call, tools: fakeTools });
  assert.equal(out.reply, '推薦 [房源#12],其次 [房源#7]。');
  assert.deepEqual(out.propertyIds, [12, 7]);
  assert.deepEqual(calls[0], ['search_properties', { max_price: 7000 }]);
  assert.equal(out.steps.length, 3);
  assert.equal(out.steps[2].ok, false);
  assert.deepEqual(out.usage, { input_tokens: 550, output_tokens: 120 });
  // 第三次呼叫 Claude 時,要帶著兩個工具結果,錯誤的那個標 is_error
  const lastMsg = sent[2].messages.at(-1);
  assert.equal(lastMsg.role, 'user');
  assert.equal(lastMsg.content.length, 2);
  assert.equal(lastMsg.content[1].tool_use_id, 't3');
  assert.equal(lastMsg.content[1].is_error, true);
  assert.match(lastMsg.content[1].content, /找不到房源 #999/);
  assert.equal(sent[0].tools[0].input_schema.type, 'object');
  assert.match(sent[0].system, /\[房源#編號\]/);
});

test('runAgent:沒有問題時回 400;sanitizeHistory 過濾不合法訊息', async () => {
  await assert.rejects(runAgent([], { call: async () => ({}), tools: fakeTools }), /請輸入問題/);
  assert.deepEqual(
    sanitizeHistory([{ role: 'assistant', content: '你好' }, { role: 'system', content: 'x' }, { role: 'user', content: '  ' }, { role: 'user', content: 'a'.repeat(3000) }]).map((m) => [m.role, m.content.length]),
    [['user', 2000]],
  );
});

test('所有工具都有 JSON Schema,轉成 Anthropic 格式', () => {
  assert.equal(TOOLS.length, 7);
  for (const t of anthropicTools()) {
    assert.ok(t.name && t.description && t.input_schema.type === 'object', t.name);
  }
});

test('runTool:參數錯誤回傳可讀的訊息,不丟例外', async () => {
  const r = await runTool('search_properties', { max_price: '很便宜' });
  assert.equal(r.ok, false);
  assert.match(r.error, /參數錯誤.*max_price/);
  assert.equal((await runTool('no_such_tool', {})).ok, false);
  const bad = await runTool('search_campus_news', { tags: ['不存在的標籤'] });
  assert.match(bad.error, /不認得的標籤/);
});

test('estimateMinutes 概估通勤', () => {
  assert.deepEqual(estimateMinutes(1000), { walk_min: 17, bike_min: 5, scooter_min: 5 });
  assert.deepEqual(estimateMinutes(10), { walk_min: 1, bike_min: 1, scooter_min: 2 });
});

/* ---------------- MCP ---------------- */

const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const modernHeaders = (method, name) => ({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) });

test('MCP 舊版:initialize 握手 → initialized 通知 → tools/list → tools/call', async () => {
  const init = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }, {}, fakeTools);
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(init.body.result.serverInfo.name, 'ncu-rent');

  const old = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, {}, fakeTools);
  assert.equal(old.body.result.protocolVersion, '2025-11-25'); // 不支援就回最新的舊版

  assert.equal((await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, {}, fakeTools)).status, 202);

  const list = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-protocol-version': '2025-06-18' }, fakeTools);
  assert.deepEqual(list.body.result.tools.map((t) => t.name), ['search_properties', 'get_property']);
  assert.equal(list.body.result.tools[0].annotations.readOnlyHint, true);
  assert.equal(list.body.result.resultType, undefined);

  const call = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_properties', arguments: { max_price: 6000 } } }, {}, fakeTools);
  assert.equal(call.body.result.isError, false);
  assert.equal(call.body.result.structuredContent.total_matched, 2);
  assert.match(call.body.result.content[0].text, /"total_matched": 2/);

  const err = await handleMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_property', arguments: { id: 999 } } }, {}, fakeTools);
  assert.equal(err.body.result.isError, true);
  assert.equal(err.body.result.content[0].text, '找不到房源 #999');

  const unknown = await handleMcp({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, {}, fakeTools);
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.error.code, -32601);

  const badVer = await handleMcp({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' }, fakeTools);
  assert.equal(badVer.status, 400);
});

test('MCP 新版 2026-07-28:server/discover、標頭驗證、版本錯誤', async () => {
  const disc = await handleMcp({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: modernMeta } }, modernHeaders('server/discover'), fakeTools);
  assert.equal(disc.status, 200);
  assert.equal(disc.body.result.resultType, 'complete');
  assert.deepEqual(disc.body.result.supportedVersions, ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.equal(disc.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ncu-rent');

  const ok = await handleMcp(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_properties', arguments: {}, _meta: modernMeta } },
    modernHeaders('tools/call', 'search_properties'), fakeTools,
  );
  assert.equal(ok.body.result.resultType, 'complete');
  assert.equal(ok.body.result.isError, false);

  const b64 = Buffer.from('search_properties').toString('base64');
  const enc = await handleMcp(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_properties', arguments: {}, _meta: modernMeta } },
    modernHeaders('tools/call', `=?base64?${b64}?=`), fakeTools,
  );
  assert.equal(enc.status, 200);

  const mismatch = await handleMcp(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_properties', arguments: {}, _meta: modernMeta } },
    modernHeaders('tools/call', 'get_property'), fakeTools,
  );
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, -32020);

  const noHeader = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: modernMeta } }, {}, fakeTools);
  assert.equal(noHeader.status, 400);
  assert.equal(noHeader.body.error.code, -32020);

  const future = { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
  const ver = await handleMcp({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: future } },
    { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' }, fakeTools);
  assert.equal(ver.status, 400);
  assert.equal(ver.body.error.code, -32022);
  assert.equal(ver.body.error.data.requested, '2099-01-01');

  const nf = await handleMcp({ jsonrpc: '2.0', id: 6, method: 'prompts/list', params: { _meta: modernMeta } }, modernHeaders('prompts/list'), fakeTools);
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, -32601);

  assert.equal((await handleMcp([{ jsonrpc: '2.0', id: 1, method: 'ping' }], {}, fakeTools)).status, 400);
  assert.equal((await handleMcp({ id: 1 }, {}, fakeTools)).status, 400);
});

test('MCP Origin 檢查與 base64 標頭', () => {
  process.env.FRONTEND_URL = 'https://ncu-rent.onrender.com';
  process.env.NODE_ENV = 'production';
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed('https://ncu-rent.onrender.com'), true);
  assert.equal(originAllowed('https://claude.ai'), true);
  assert.equal(originAllowed('https://evil.example'), false);
  assert.equal(originAllowed('http://localhost:6274'), false);
  process.env.NODE_ENV = 'development';
  assert.equal(originAllowed('http://localhost:6274'), true);
  assert.equal(decodeHeader(`=?base64?${Buffer.from('你好').toString('base64')}?=`), '你好');
  assert.equal(decodeHeader('plain'), 'plain');
});

/* ---------------- 新生入學包 ---------------- */

const posts = [
  { id: 1, title: '115 學年度宿舍床位申請', url: 'https://ncu.edu.tw/1', publishedAt: new Date('2026-07-01'), tags: ['宿舍住宿'], content: '申請期間 7/10~7/20' },
  { id: 2, title: '新生選課說明', url: 'https://ncu.edu.tw/2', publishedAt: new Date('2026-08-01'), tags: ['課務選課'], content: '9/1 開放選課' },
];
const clubs = [{ name: '吉他社', url: 'https://club/1', links: ['https://instagram.com/g'], nature: '康樂性', intro: '彈吉他' }];

test('validateGuide:只保留真實存在的公告與社團,依日期排序', () => {
  const g = validateGuide({
    intro: '歡迎',
    timeline: [
      { date: '2026-09-01', title: '選課', detail: '', postId: 2 },
      { date: '2026-07-10', title: '申請宿舍', detail: '', postId: 1 },
      { date: '2026-08-15', title: 'AI 自己編的日期', detail: '', postId: 99 },
      { date: '九月', title: '格式錯誤', postId: 1 },
    ],
    checklist: [{ item: '帶身分證', postId: 99 }, { item: '', postId: 1 }],
    housing: [{ tip: '先申請宿舍', postId: 1 }],
    clubs: [{ name: '吉他社', why: '你喜歡音樂' }, { name: '不存在社', why: 'x' }],
  }, posts, clubs);
  assert.deepEqual(g.timeline.map((t) => [t.date, t.postId, t.url]), [['2026-07-10', 1, 'https://ncu.edu.tw/1'], ['2026-09-01', 2, 'https://ncu.edu.tw/2']]);
  assert.deepEqual(g.checklist, [{ item: '帶身分證', detail: '', postId: null }]);
  assert.equal(g.housing[0].source, '115 學年度宿舍床位申請');
  assert.deepEqual(g.clubs.map((c) => c.name), ['吉他社']);
});

test('buildFreshmanGuide:送出身分資料、解析 AI 回覆、快取', async () => {
  let n = 0;
  let prompt = '';
  let choice = null;
  const call = async (req) => {
    n++;
    prompt = req.messages[0].content;
    choice = req.toolChoice;
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'submit_guide', input: {
      intro: '嗨', timeline: [{ date: '2026-07-10', title: '申請宿舍', postId: 1 }], checklist: [], housing: [],
      clubs: [{ name: '吉他社', why: '音樂' }], notes: '',
    } }] };
  };
  const input = freshmanSchema.parse({ identity: '國際生', housing: '宿舍', interests: ['吉他'], lang: 'en' });
  const g1 = await buildFreshmanGuide(input, { call, materials: { posts, clubs } });
  assert.equal(g1.intro, '嗨');
  assert.equal(g1.timeline.length, 1);
  assert.match(prompt, /身分=國際生/);
  assert.match(prompt, /英文/);
  assert.match(prompt, /<data>/);
  assert.deepEqual(choice, { type: 'tool', name: 'submit_guide' });
  const g2 = await buildFreshmanGuide(input, { call, materials: { posts, clubs } });
  assert.equal(g2.cached, true);
  assert.equal(n, 1);
  await assert.rejects(
    buildFreshmanGuide({ ...input, interests: ['x'] }, { call: async () => ({ content: [{ type: 'text', text: '抱歉' }] }), materials: { posts, clubs } }),
    /格式有誤/,
  );
  assert.throws(() => freshmanSchema.parse({ identity: '老師', housing: '宿舍' }));
});

/* ---------------- 使用量限制 ---------------- */

test('checkQuota:訪客與登入者各自的每小時上限、全站每日上限', () => {
  _resetQuota();
  process.env.AGENT_GUEST_HOURLY_LIMIT = '2';
  process.env.AGENT_HOURLY_LIMIT = '3';
  process.env.AGENT_DAILY_LIMIT = '6';
  assert.equal(checkQuota('ip1', true).ok, true);
  assert.equal(checkQuota('ip1', true).ok, true);
  assert.match(checkQuota('ip1', true).message, /登入後可使用更多次/);
  assert.equal(checkQuota('u1', false).remaining, 2);
  checkQuota('u1', false); checkQuota('u1', false);
  assert.equal(checkQuota('u1', false).ok, false);
  assert.equal(checkQuota('u2', false).ok, true);
  assert.match(checkQuota('u3', false).message, /今天的 AI 使用量已達上限/);
  process.env.AGENT_GUEST_HOURLY_LIMIT = '0';
  _resetQuota();
  assert.match(checkQuota('ip9', true).message, /請先登入/);
  for (const k of ['AGENT_GUEST_HOURLY_LIMIT', 'AGENT_HOURLY_LIMIT', 'AGENT_DAILY_LIMIT']) delete process.env[k];
});

/* ---------------- 結構化輸出(評論審核、公告標籤)---------------- */
import { completeJson } from '../src/services/llm.js';
import { aiCheck } from '../src/services/moderation.js';
import { tagPost } from '../src/services/tagger.js';

test('completeJson / aiCheck / tagPost:用強制工具呼叫,中文內容含引號也不會解析失敗', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push(body);
    const name = body.tool_choice.name;
    const input = body.system.includes('審核員')
      ? { decision: 'review', categories: ['insult'], reason: '評論含"沒腦"等貶低字眼' }
      : { summary: '吉他社 12/18 晚上在大講堂辦"期末成果發表會",免費入場。', tags: ['社團活動', '藝文展演', '亂編的標籤'],
        eventStart: '2026-12-18T19:00', eventEnd: '', location: '大講堂', clubName: '吉他社' };
    return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name, input }], usage: {} }), { status: 200 });
  };
  process.env.AI_API_KEY = 'sk-ant-test';
  try {
    const m = await aiCheck('房東根本沒腦');
    assert.equal(m.decision, 'review');
    assert.equal(m.reason, '評論含"沒腦"等貶低字眼');
    assert.deepEqual(sent[0].tool_choice, { type: 'tool', name: 'submit_result' });
    assert.equal(sent[0].tools[0].input_schema.properties.decision.enum.length, 3);

    const t = await tagPost({ title: '吉他社期末成果發表會', content: '…', source: 'club-news' });
    assert.equal(t.taggedBy, 'ai:claude-haiku-5-5');
    assert.deepEqual(t.tags, ['社團活動', '藝文展演']);
    assert.match(t.summary, /"期末成果發表會"/);
    assert.equal(t.eventStart.toISOString(), '2026-12-18T11:00:00.000Z');
    assert.equal(t.eventEnd, null);
    assert.equal(t.location, '大講堂');

    // API 錯誤時回傳 null,呼叫端改用規則版
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 });
    assert.equal(await completeJson({ system: 's', prompt: 'p', schema: { type: 'object', properties: {} } }), null);
    assert.equal((await tagPost({ title: '社團博覽會', content: '', source: 'club-news' })).taggedBy, 'rules');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.AI_API_KEY;
  }
});
