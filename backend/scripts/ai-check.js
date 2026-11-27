// 檢查 Claude API 金鑰,並實際跑一次各項 AI 功能。
//   npm run ai:check                          # 檢查金鑰 + 評論審核 + 校園消息標籤/摘要/活動時間
//   node scripts/ai-check.js --agent "7000 以內、可以租補的套房"   # 另外測試租屋代理人(需要資料庫裡有房源)
import 'dotenv/config';
import { claudeMessages, aiModel } from '../src/services/llm.js';
import { moderate } from '../src/services/moderation.js';
import { tagPost } from '../src/services/tagger.js';

const line = (s = '') => console.log(s);
const args = process.argv.slice(2);

function explain(e) {
  const m = e.message || '';
  if (/401|authentication|x-api-key/i.test(m)) return '金鑰錯誤:請確認 .env 的 AI_API_KEY 有完整貼上(sk-ant- 開頭),前後沒有空白或引號';
  if (/404|not_found|model/i.test(m)) return `找不到模型「${aiModel()}」:請確認 .env 的 AI_MODEL,或刪掉那行使用預設值`;
  if (/credit|billing|balance/i.test(m)) return '帳戶餘額不足:請到 https://console.anthropic.com 的 Billing 儲值';
  if (/429|rate/i.test(m)) return '請求太頻繁:等一分鐘再試';
  return m;
}

line('=== 1. 檢查設定 ===');
if (!process.env.AI_API_KEY) {
  line('❌ .env 沒有設定 AI_API_KEY。請在 backend/.env 加上:AI_API_KEY=sk-ant-你的金鑰');
  process.exit(1);
}
line(`✓ AI_API_KEY 已設定(${process.env.AI_API_KEY.slice(0, 10)}…)`);
line(`✓ 使用模型:${aiModel()}${process.env.AGENT_MODEL ? `;租屋代理人與入學包:${process.env.AGENT_MODEL}` : ''}`);

line('\n=== 2. 連線測試 ===');
try {
  const r = await claudeMessages({ system: '只回覆兩個字:成功', messages: [{ role: 'user', content: '測試' }], maxTokens: 20 });
  line(`✓ Claude 回覆:${r.content?.[0]?.text}(用了 ${r.usage?.input_tokens} + ${r.usage?.output_tokens} tokens)`);
} catch (e) {
  line(`❌ ${explain(e)}`);
  process.exit(1);
}

line('\n=== 3. 評論審核(規則 + AI) ===');
for (const text of [
  '隔音很差,押金拖了兩個月才退,不推薦。',
  '房東根本沒腦,活該一輩子收不到房租。',
  '這間超讚,房東人很好,有問題都馬上修。',
]) {
  const r = await moderate(text);
  const label = { allow: '✅ 公開', review: '⏸ 待審', block: '⛔ 擋下' }[r.decision];
  line(`${label}  ${text}`);
  line(`      判斷來源:${r.by.join(' + ')}${r.reason ? `;原因:${r.reason}` : ''}`);
}
line('(預期:第一則公開、第二則待審或擋下、第三則公開。第二則沒有髒話,要靠 AI 才抓得到)');

line('\n=== 4. 校園消息標籤、摘要、活動時間地點 ===');
const sample = {
  source: 'club-news',
  title: '吉他社期末成果發表會',
  publisher: '學務處課外活動組',
  rawCategory: '活動',
  publishedAt: new Date(),
  content: '吉他社將於 12 月 18 日(四)晚上 7 點在大講堂舉辦期末成果發表會,免費入場,歡迎全校師生參加。現場另有抽獎活動。',
};
const t = await tagPost(sample);
line(`貼標方式:${t.taggedBy}`);
line(`標籤:${t.tags.join('、')}`);
line(`摘要:${t.summary ?? '(無)'}`);
line(`活動時間:${t.eventStart ? t.eventStart.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '(無)'}`);
line(`地點:${t.location ?? '(無)'};社團:${t.clubName ?? '(無)'}`);
if (t.taggedBy === 'rules') line('⚠️ 沒有用到 AI,請看上面是否有 [llm] 錯誤訊息');

const ai = args.indexOf('--agent');
if (ai >= 0) {
  line('\n=== 5. 租屋代理人 ===');
  const { runAgent } = await import('../src/services/agent.js');
  const q = args[ai + 1] || '中大附近 8000 以內的套房,推薦三間';
  line(`問題:${q}\n(查詢中,約需 10~30 秒…)`);
  const out = await runAgent([{ role: 'user', content: q }]);
  for (const s of out.steps) line(`  🔧 ${s.tool} ${JSON.stringify(s.input)} → ${s.summary}`);
  line(`\n${out.reply}`);
  line(`\n(用了 ${out.usage.input_tokens} + ${out.usage.output_tokens} tokens)`);
  const { prisma } = await import('../src/lib/prisma.js');
  await prisma.$disconnect();
}
line('\n檢查完成 🎉');
