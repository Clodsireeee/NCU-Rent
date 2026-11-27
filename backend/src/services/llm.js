// 統一的 LLM 呼叫介面。沒設定金鑰時回傳 null,呼叫端會改用規則版(仍可運作、免費)。
//
//   AI_PROVIDER=anthropic   AI_API_KEY=sk-ant-...   AI_MODEL=claude-haiku-5-5(預設)
//   AI_PROVIDER=openai      AI_API_KEY=...          AI_MODEL=<必填>   AI_BASE_URL=https://api.openai.com/v1
//     (openai 模式也可接任何 OpenAI 相容服務,例如本機 Ollama: AI_BASE_URL=http://localhost:11434/v1)

const provider = () => (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
export const aiEnabled = () =>
  !!process.env.AI_API_KEY || (provider() === 'openai' && !!process.env.AI_BASE_URL && !!process.env.AI_MODEL);
export const aiModel = () =>
  process.env.AI_MODEL || (provider() === 'anthropic' ? 'claude-haiku-5-5' : '');

/** 送出一則對話,回傳模型文字;失敗或未設定回傳 null */
export async function complete({ system, prompt, maxTokens = 600, timeout = 30000 }) {
  if (!aiEnabled()) return null;
  try {
    if (provider() === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.AI_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: aiModel(),
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const data = await r.json();
      return data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') ?? null;
    }
    const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.AI_API_KEY ? { authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: aiModel(),
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('[llm] 呼叫失敗,改用規則版:', e.message);
    return null;
  }
}

/** 從模型輸出中撈出第一個 JSON 物件(模型偶爾會加 ```json 或前後說明) */
export function parseJsonLoose(text) {
  if (!text) return null;
  const s = text.replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/**
 * 直接呼叫 Claude Messages API(支援工具呼叫)。只支援 AI_PROVIDER=anthropic。
 * 回傳 API 原始回應;失敗時丟出錯誤(由呼叫端決定怎麼告訴使用者)。
 */
export async function claudeMessages({ system, messages, tools, toolChoice, model, maxTokens = 1500, timeout = 60000 }) {
  if (provider() !== 'anthropic' || !process.env.AI_API_KEY) {
    throw Object.assign(new Error('AI 功能需要設定 AI_PROVIDER=anthropic 與 AI_API_KEY'), { status: 503 });
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.AI_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || aiModel(),
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools?.length ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(`Claude API ${r.status}: ${data.error?.message || r.statusText}`), { status: r.status === 429 ? 429 : 502 });
  }
  return data;
}

/**
 * 要求 AI 回傳「符合指定格式」的資料。
 * Anthropic:用強制工具呼叫(tool_choice),API 保證回傳的是已解析好的物件,
 *           不會因為中文內容裡的引號、換行而解析失敗。
 * 其他服務:退回一般文字回覆 + 盡量解析 JSON。
 * 失敗回傳 null(呼叫端會改用規則版)。
 */
export async function completeJson({ system, prompt, schema, name = 'submit_result', maxTokens = 600, timeout = 30000 }) {
  if (!aiEnabled()) return null;
  if (provider() !== 'anthropic') {
    const out = parseJsonLoose(await complete({ system, prompt, maxTokens, timeout }));
    if (!out) console.warn('[llm] AI 回覆無法解析成 JSON');
    return out;
  }
  try {
    const res = await claudeMessages({
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name, description: '回傳結果(必須呼叫此工具)', input_schema: schema }],
      toolChoice: { type: 'tool', name },
      maxTokens,
      timeout,
    });
    const use = (res.content || []).find((b) => b.type === 'tool_use' && b.name === name);
    if (!use) {
      console.warn(`[llm] AI 沒有回傳結構化結果(stop_reason=${res.stop_reason})`);
      return null;
    }
    return use.input;
  } catch (e) {
    console.warn('[llm] 呼叫失敗,改用規則版:', e.message);
    return null;
  }
}
