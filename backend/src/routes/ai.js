// 生成式 AI 功能:租屋代理人、新生入學包
import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/http.js';
import { optionalAuth } from '../middleware/auth.js';
import { runAgent, agentModel } from '../services/agent.js';
import { buildFreshmanGuide, freshmanSchema } from '../services/freshman.js';
import { checkQuota } from '../services/aiQuota.js';

const router = Router();
const enabled = () => (process.env.AI_PROVIDER || 'anthropic') === 'anthropic' && !!process.env.AI_API_KEY;

function guard(req) {
  if (!enabled()) throw new HttpError(503, 'AI 功能尚未啟用(伺服器沒有設定 AI_API_KEY)');
  const q = checkQuota(req.user ? `u${req.user.id}` : `ip${req.ip}`, !req.user);
  if (!q.ok) throw new HttpError(429, q.message);
}

/** GET /api/ai/status 前端用來判斷要不要顯示 AI 功能 */
router.get('/status', (_req, res) => res.json({ enabled: enabled(), model: enabled() ? agentModel() : null }));

/** POST /api/ai/agent  { messages: [{role:'user'|'assistant', content}] } */
router.post('/agent', optionalAuth, asyncHandler(async (req, res) => {
  guard(req);
  try {
    res.json(await runAgent(req.body?.messages));
  } catch (e) {
    console.error('[ai/agent]', e.message);
    throw new HttpError(e.status || 502, e.status === 400 ? e.message : 'AI 助理暫時無法回應,請稍後再試');
  }
}));

/** POST /api/ai/freshman  { identity, housing, interests[], lang } */
router.post('/freshman', optionalAuth, asyncHandler(async (req, res) => {
  const input = freshmanSchema.parse(req.body);
  guard(req);
  try {
    res.json(await buildFreshmanGuide(input));
  } catch (e) {
    console.error('[ai/freshman]', e.message);
    throw new HttpError(e.status || 502, e.status === 502 && e.message.includes('格式') ? e.message : '入學包產生失敗,請稍後再試');
  }
}));

export default router;
