// NCU-Rent MCP 伺服器(Model Context Protocol)
// 讓 Claude 等 AI 助理直接連上 NCU-Rent,查詢房源、校園消息、社團。網址:https://你的網站/mcp
//
// 同時支援兩種版本的客戶端(規格稱為 dual-era):
//   - 新版 2026-07-28:無狀態,每個請求的 params._meta 帶協定版本,搭配 MCP-Protocol-Version / Mcp-Method / Mcp-Name 標頭
//   - 舊版 2025-11-25、2025-06-18、2025-03-26:先送 initialize 握手
// 只提供唯讀工具(與租屋代理人共用 src/services/rentTools.js),不需要登入。
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { TOOLS, TOOL_MAP, runTool, siteUrl } from '../services/rentTools.js';

export const MODERN = ['2026-07-28'];
export const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';

const SERVER_INFO = { name: 'ncu-rent', title: 'NCU-Rent 中大租屋與校園資訊', version: '1.0.0' };
const INSTRUCTIONS =
  'NCU-Rent 提供國立中央大學(桃園中壢)周邊的租屋房源、學生評論、校園公告與社團資料。' +
  '找房先用 search_properties,再用 get_property 看評論細節;通勤用 estimate_commute;校園活動用 search_campus_news(標籤可先用 list_news_tags 查)。' +
  '租金單位為新台幣/月。回覆時請附上工具結果中的 url 讓使用者點開。';

const ERR = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602,
  HEADER_MISMATCH: -32020, UNSUPPORTED_VERSION: -32022,
};

/** 解碼 =?base64?...?= 格式的標頭值 */
export function decodeHeader(v) {
  if (typeof v !== 'string') return v;
  const m = v.match(/^=\?base64\?(.*)\?=$/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
}

const toolList = (tools) =>
  [...tools.values()].map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));

/**
 * 處理一個 JSON-RPC 訊息(和 Express 無關,方便測試)。
 * @returns {{ status: number, body?: object, headers?: object }}
 */
export async function handleMcp(msg, headers = {}, tools = TOOL_MAP) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const reply = (id, result, status = 200) => ({ status, body: { jsonrpc: '2.0', id, result } });
  const fail = (id, code, message, status = 200, data) =>
    ({ status, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } } });

  if (Array.isArray(msg)) return fail(null, ERR.INVALID_REQUEST, '不支援批次請求', 400);
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail(msg?.id, ERR.INVALID_REQUEST, 'Invalid Request', 400);
  }
  const { id, method, params = {} } = msg;
  if (id === undefined) return { status: 202 }; // 通知(例如 notifications/initialized):收下即可

  const metaVersion = params?._meta?.[META_VERSION];
  const modern = !!metaVersion;
  const all = [...MODERN, ...LEGACY];

  /* ---------- 新版(2026-07-28)請求:檢查版本與標頭 ---------- */
  if (modern) {
    if (!MODERN.includes(metaVersion)) {
      return fail(id, ERR.UNSUPPORTED_VERSION, 'Unsupported protocol version', 400, { supported: all, requested: metaVersion });
    }
    const hv = h['mcp-protocol-version'];
    if (hv !== metaVersion) return fail(id, ERR.HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version '${hv ?? '(缺少)'}' 與 _meta 的 '${metaVersion}' 不一致`, 400);
    if (h['mcp-method'] !== method) return fail(id, ERR.HEADER_MISMATCH, `Header mismatch: Mcp-Method '${h['mcp-method'] ?? '(缺少)'}' 與 '${method}' 不一致`, 400);
    if (method === 'tools/call') {
      const name = decodeHeader(h['mcp-name']);
      if (name !== params.name) return fail(id, ERR.HEADER_MISMATCH, `Header mismatch: Mcp-Name '${name ?? '(缺少)'}' 與 '${params.name}' 不一致`, 400);
    }
  } else if (method !== 'initialize') {
    /* ---------- 舊版請求:MCP-Protocol-Version 標頭(沒有就視為 2025-03-26) ---------- */
    const hv = h['mcp-protocol-version'];
    if (hv && !LEGACY.includes(hv)) {
      return fail(id, MODERN.includes(hv) ? ERR.HEADER_MISMATCH : ERR.INVALID_REQUEST,
        MODERN.includes(hv) ? `請在 params._meta 帶上 ${META_VERSION}` : `Unsupported protocol version: ${hv}`, 400,
        MODERN.includes(hv) ? undefined : { supported: all, requested: hv });
    }
  }
  const done = (result) => reply(id, modern ? { resultType: 'complete', ...result } : result);

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return reply(id, {
        protocolVersion: LEGACY.includes(requested) ? requested : LEGACY[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { ...SERVER_INFO, websiteUrl: siteUrl() },
        instructions: INSTRUCTIONS,
      });
    }
    case 'server/discover':
      return done({
        supportedVersions: all,
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
        instructions: INSTRUCTIONS,
        ttlMs: 3600000,
        cacheScope: 'public',
      });
    case 'ping':
      return done({});
    case 'tools/list':
      return done({ tools: toolList(tools) });
    case 'tools/call': {
      if (typeof params.name !== 'string') return fail(id, ERR.INVALID_PARAMS, '缺少工具名稱 name');
      if (!tools.has(params.name)) return fail(id, ERR.INVALID_PARAMS, `沒有這個工具:${params.name}`);
      const r = await runTool(params.name, params.arguments ?? {}, tools);
      // 工具執行錯誤(例如參數不對)用 isError 回傳,讓 AI 可以自己修正後重試
      return done(r.ok
        ? { content: [{ type: 'text', text: JSON.stringify(r.result, null, 1) }], structuredContent: r.result, isError: false }
        : { content: [{ type: 'text', text: r.error }], isError: true });
    }
    default:
      return fail(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`, modern ? 404 : 200);
  }
}

/** Origin 檢查(防 DNS rebinding):沒有 Origin(伺服器對伺服器)允許;有的話必須在允許清單 */
export function originAllowed(origin) {
  if (!origin) return true;
  const allow = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_SITE_URL,
    'https://claude.ai',
    ...(process.env.MCP_ALLOWED_ORIGINS || '').split(','),
  ].map((s) => s?.trim().replace(/\/$/, '')).filter(Boolean);
  if (allow.includes(origin)) return true;
  return process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.MCP_RATE_LIMIT) || 60, standardHeaders: true, legacyHeaders: false }));

router.post('/', async (req, res) => {
  if (!originAllowed(req.headers.origin)) {
    return res.status(403).json({ jsonrpc: '2.0', id: null, error: { code: ERR.INVALID_REQUEST, message: 'Origin not allowed' } });
  }
  try {
    const out = await handleMcp(req.body, req.headers);
    if (out.status === 202) return res.status(202).end();
    res.status(out.status).type('application/json').send(JSON.stringify(out.body));
  } catch (e) {
    console.error('[mcp]', e);
    res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'Internal error' } });
  }
});
// 本伺服器不提供 GET 串流、也沒有 session 可刪除
router.get('/', (_req, res) => res.status(405).set('Allow', 'POST').end());
router.delete('/', (_req, res) => res.status(405).set('Allow', 'POST').end());

export default router;
