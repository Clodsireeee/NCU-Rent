import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleCheck, moderate, normalize } from '../src/services/moderation.js';

process.env.MODERATION_AI = 'off';

const ALLOW = [
  '房東押金拖了兩個月才退,很不推薦,溝通也很差。',
  '隔音超差,隔壁講電話都聽得到,夏天頂樓很熱。',
  '老闆態度很兇,但雞排真的好吃,份量很大。',
  '幹嘛一定要月繳?房東說不能季繳,有點麻煩。',
  '打房東電話常常沒人接,修冷氣等了一週。',
  '原住民都很熱情的部落市集就在附近,假日很熱鬧。',
  '我媽的意見是太貴了,但地點真的很方便。',
  '這間店有 online 點餐,很方便,哈哈哈哈。',
  '可以申請租補,房東也願意配合,社團學長推薦的。',
  '這家超雷,麵很爛,不會再來。',
  '油炸你會喜歡的那種酥脆,很推。',
];
const REVIEW = [
  ['房東是智障嗎,一直亂收錢', 'insult'],
  ['有問題打給房東 0912345678', 'personal_info'],
  ['優惠請加LINE: abcd1234', 'personal_info'],
  ['想要更多房源請看 https://spam.example.com', 'spam'],
  ['靠北喔這什麼爛房間', 'profanity'],
  ['好好好好好好好好好好好好好', 'spam'],
];
const BLOCK = [
  ['幹你娘這什麼房東', 'profanity'],
  ['幹 . 你 . 娘', 'profanity'],
  ['ㄍㄋㄋ超爛', 'profanity'],
  ['再不退押金我就砍死房東', 'threat'],
  ['老闆去死吧', 'threat'],
  ['支那人開的店不要去', 'hate'],
];

test('normalize 去掉夾雜符號與全形', () => {
  assert.equal(normalize('幹 . 你－娘ＡＢ'), '幹你娘ab');
});

for (const t of ALLOW) {
  test(`allow: ${t}`, () => assert.equal(ruleCheck(t).decision, 'allow', JSON.stringify(ruleCheck(t))));
}
for (const [t, cat] of REVIEW) {
  test(`review: ${t}`, () => {
    const r = ruleCheck(t);
    assert.equal(r.decision, 'review');
    assert.ok(r.flags.includes(cat), r.flags.join());
  });
}
for (const [t, cat] of BLOCK) {
  test(`block: ${t}`, () => {
    const r = ruleCheck(t);
    assert.equal(r.decision, 'block');
    assert.ok(r.flags.includes(cat), r.flags.join());
  });
}

test('moderate 在沒有 AI 時回傳規則結果與原因', async () => {
  const r = await moderate('房東是智障');
  assert.equal(r.decision, 'review');
  assert.match(r.reason, /人身攻擊/);
  assert.deepEqual(r.by, ['rules']);
});
