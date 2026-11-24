import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleTags, parseTaipei, tagPost, TAG_NAMES } from '../src/services/tagger.js';
import { categoryFromTypes, gridCenters, toPublicDetails } from '../src/services/places.js';
import { NCU, distanceM } from '../src/lib/geo.js';

delete process.env.AI_API_KEY;

test('ruleTags 依標題/分類/來源貼標', () => {
  assert.deepEqual(ruleTags({ title: '[演講公告] A Tutorial on Analyzing Machine Learning Algorithms', rawCategory: '演講' }), ['講座演講']);
  assert.ok(ruleTags({ title: '國立中央大學資訊工程學系 誠徵專任行政助理1名', rawCategory: '徵才' }).includes('徵才實習'));
  const club = ruleTags({ title: '115學年度全國學生音樂比賽決賽報名期程', source: 'club-news' });
  assert.deepEqual(club.slice(0, 3), ['社團活動', '競賽', '藝文展演']);
  assert.ok(ruleTags({ title: '116年全校共同寒休日,期間暫停受理各項業務' }).includes('放假行事曆'));
  assert.deepEqual(ruleTags({ title: '會議紀錄公告' }), ['行政公告']);
  for (const t of ruleTags({ title: '宿舍停水停電公告 颱風防災 交換學生 獎學金 社團 演講' })) assert.ok(TAG_NAMES.includes(t));
  assert.ok(ruleTags({ title: '宿舍停水停電公告 颱風防災 交換學生 獎學金 社團 演講' }).length <= 4);
});

test('parseTaipei 視為台灣時間', () => {
  assert.equal(parseTaipei('2026-12-03T14:00').toISOString(), '2026-12-03T06:00:00.000Z');
  assert.equal(parseTaipei('2026-12-03').toISOString(), '2026-12-02T16:00:00.000Z');
  assert.equal(parseTaipei(null), null);
  assert.equal(parseTaipei('下週三'), null);
});

test('tagPost 沒有 AI 金鑰時使用規則版', async () => {
  const r = await tagPost({ title: '社團博覽會攤位登記', content: '', source: 'club-news' });
  assert.equal(r.taggedBy, 'rules');
  assert.ok(r.tags.includes('社團活動'));
});

test('Google 類型對應到平台分類', () => {
  assert.equal(categoryFromTypes(['ramen_restaurant', 'restaurant', 'food'], 'ramen_restaurant'), '日式');
  assert.equal(categoryFromTypes(['cafe', 'food'], 'cafe'), '咖啡甜點');
  assert.equal(categoryFromTypes(['breakfast_restaurant', 'restaurant'], 'breakfast_restaurant'), '早餐');
  assert.equal(categoryFromTypes(['barbecue_restaurant'], 'barbecue_restaurant'), '中式');
  assert.equal(categoryFromTypes(['tea_house'], 'tea_house'), '飲料');
  assert.equal(categoryFromTypes(['restaurant', 'food'], 'restaurant'), '中式');
  assert.equal(categoryFromTypes(['store'], ''), '其他');
});

test('gridCenters 蓋滿整個區域', () => {
  const { centers, radius } = gridCenters(NCU, 1500, 500);
  assert.ok(centers.length > 20 && centers.length < 60, String(centers.length));
  assert.ok(radius >= 354);
  // 區域內任一點都要落在某一格的圓內
  for (const [dx, dy] of [[1000, 1000], [-1400, 0], [0, 1499], [333, -777]]) {
    const p = { lat: NCU.lat + dy / 111320, lng: NCU.lng + dx / (111320 * Math.cos((NCU.lat * Math.PI) / 180)) };
    assert.ok(centers.some((c) => distanceM(c, p) <= radius), `${dx},${dy}`);
  }
});

test('toPublicDetails', () => {
  const d = toPublicDetails({ displayName: { text: '中大雞排' }, rating: 4.3, userRatingCount: 12, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', googleMapsUri: 'https://maps.google.com/?cid=1' });
  assert.equal(d.name, '中大雞排');
  assert.equal(d.priceLevel, '$');
  assert.deepEqual(d.hours, []);
});
