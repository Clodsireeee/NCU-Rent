import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHouseDetail, discoverIds, buildDescription, mentionsSubsidy } from '../src/crawlers/houseNfu.js';
import { parseList, parseDetail, parseClub } from '../src/crawlers/news/parse.js';
import { SOURCES, CLUBS } from '../src/crawlers/news/sources.js';
import { htmlToText, findDates, extractLinks } from '../src/lib/html.js';
import { normalizeAddress, distanceM, NCU } from '../src/lib/geo.js';
import { parseRobots } from '../src/lib/fetcher.js';
import { parseJsonLoose } from '../src/services/llm.js';
import { relaxations } from '../src/services/geocode.js';

// 依照雲端租屋網詳細頁實際出現的欄位順序組成的測試頁
const HOUSE = `<html><head><title>國立中央大學校外賃居網 - 雲端租屋生活網</title></head><body>
<div class="logo">School Logo <span>國立中央大學</span> 校外賃居網</div>
<h4>基本資料 <small>5742人瀏覽</small></h4>
<h3>【近後門・可租補】 房間出租 套房3間</h3>
<p class="price">每月 5,500~6,500 元</p>
<p>桃園市中壢區五權里中央路232巷47號 黃小姐 ( 0916938001 )</p>
<p>詳細資料 於 2026-07-18 更新</p>
<table>
<tr><th>出租房數</th><td>[套房 約7 坪]共 20 間; 空房 3 間; [雅房 約4 坪]共 2 間; 空房 1 間;</td></tr>
<tr><th>房屋類型</th><td>透天</td></tr>
<tr><th>出租類型</th><td>獨立套房</td></tr>
<tr><th>租金</th><td>每月5500~6500元</td></tr>
<tr><th>押金</th><td>二個月</td></tr>
<tr><th>性別要求</th><td>無限制</td></tr>
<tr><th>其他費用</th><td>水費每月100元,垃圾代收</td></tr>
<tr><th>屋內設備</th><td>冷氣機 洗衣機 書桌(椅) 寬頻網路</td></tr>
<tr><th>公共設施</th><td>室內機車停車場 電梯</td></tr>
<tr><th>屋況說明</th><td>可申請租金補貼,步行到中大後門 3 分鐘。</td></tr>
<tr><th>安全設施</th><td>滅火器, 偵煙設備, 監視錄影設備(系統)</td></tr>
</table></body></html>`;

test('parseHouseDetail 抓出租金區間、地址、空房、旗標,且不含房東電話', () => {
  const h = parseHouseDetail(HOUSE);
  assert.equal(h.schoolName, '國立中央大學');
  assert.equal(h.price, 5500);
  assert.equal(h.priceMax, 6500);
  assert.equal(h.address, '桃園市中壢區五權里中央路232巷47號');
  assert.equal(h.vacancy, 4);
  assert.equal(h.rooms.length, 2);
  assert.equal(h.updatedAt, '2026-07-18');
  assert.equal(h.title, '【近後門・可租補】 房間出租 套房3間');
  assert.deepEqual(h.flags, { rentSubsidy: true, hasTrashService: true, hasIndoorParking: true });
  assert.equal(h.fields['押金'], '二個月');
  const desc = buildDescription(h);
  assert.match(desc, /押金:二個月/);
  assert.doesNotMatch(desc, /0916938001|黃小姐/);
});

test('parseHouseDetail:滿租、每學期租金換算、非房源頁回傳 null', () => {
  const full = HOUSE.replace('【近後門・可租補】 房間出租 套房3間', '[滿租]').replace('每月 5,500~6,500 元', '每學期 30000 元');
  const h = parseHouseDetail(full);
  assert.equal(h.vacancy, 0);
  assert.equal(h.price, 6000);
  assert.equal(h.priceMax, null);
  assert.equal(parseHouseDetail('<html><body>查詢條件</body></html>'), null);
});

test('mentionsSubsidy 能分辨「不可申請租補」', () => {
  assert.equal(mentionsSubsidy('可申請租補'), true);
  assert.equal(mentionsSubsidy('雙租補'), true);
  assert.equal(mentionsSubsidy('恕不配合租金補貼'), false);
  assert.equal(mentionsSubsidy('近中大'), false);
});

test('discoverIds 從連結與 JS 字串找出房源編號', () => {
  const html = `<a href="/NCU/17135">A</a><a href="https://house.nfu.edu.tw/index.php/NCU/9001?x=1">B</a>
    <a href="/CYUT/555">別校</a><script>go('/NCU/42')</script><a href="/NCU/announce">公告</a>`;
  assert.deepEqual(discoverIds(html, 'NCU').sort(), ['17135', '42', '9001']);
});

// 仿中大官網「校園公告」列表:分類 單位日期 → 標題
const NCU_EVENTS = `<ul class="list">
<li><span class="cate">演講</span> <span>學務處住宿服務組</span><span>2025-04-17</span>
  <a href="show.php?num=8812&page=3">宿舍導師講座_05/08(四) 跟世界做朋友</a></li>
<li><span class="cate">徵才</span> <span>人事室</span><span>2025-04-17</span>
  <a href="/tw/events/show.php?num=8811">天文研究所鹿林天文台誠徵專任人員(行政助理)1名</a></li>
<li><span class="cate">活動</span> <span>藝術學研究所</span><span>2025-04-16</span>
  <a href="show.php?num=8809"><img src="x.png"></a><a href="show.php?num=8809">逐域——2025藝術史暨視覺文化研究生聯合論文發表會 徵稿啟事</a></li>
</ul><a href="index.php?page=4">下一頁</a>`;

test('parseList:中大校園公告(分類、單位、日期、去重)', () => {
  const src = SOURCES.find((s) => s.id === 'ncu-events');
  const items = parseList(NCU_EVENTS, src, 'https://www.ncu.edu.tw/tw/events/index.php?page=3');
  assert.equal(items.length, 3);
  assert.equal(items[0].url, 'https://www.ncu.edu.tw/tw/events/show.php?num=8812&page=3');
  assert.equal(items[0].rawCategory, '演講');
  assert.equal(items[0].publisher, '學務處住宿服務組');
  assert.equal(items[0].publishedAt.toISOString(), '2025-04-16T16:00:00.000Z'); // 台灣 4/17 00:00
  assert.equal(items[1].rawCategory, '徵才');
  assert.equal(items[2].title, '逐域——2025藝術史暨視覺文化研究生聯合論文發表會 徵稿啟事');
});

test('parseList:課外組公告(日期在前、/news/{id})', () => {
  const html = `<div class="news"><div>2026-11-23</div><a href="/news/15562">116年全校共同寒休日：1/8（五）、1/25（一）、2/3（三）</a></div>
    <div class="news"><div>2026-11-18</div><a href="https://club.adm.ncu.edu.tw/news/15560">115學年度全國學生音樂比賽決賽報名期程</a></div>
    <a href="/clubs">社團總覽</a>`;
  const src = SOURCES.find((s) => s.id === 'club-news');
  const items = parseList(html, src, 'https://club.adm.ncu.edu.tw/');
  assert.equal(items.length, 2);
  assert.equal(items[1].url, 'https://club.adm.ncu.edu.tw/news/15560');
  assert.equal(items[1].publisher, '學務處課外活動組');
  assert.equal(items[0].publishedAt.toISOString().slice(0, 10), '2026-11-22');
});

test('parseDetail 取主要內容並略過導覽列', () => {
  const html = `<nav>首頁 社團總覽 下載專區</nav><main><h1>寒休公告</h1><p>公告日期:2026-11-23</p>
    <div class="editor"><p>全校共同寒休日共三天,分別為1月8日、1月25日與2月3日,期間暫停受理各項業務,請及早辦理。</p></div></main>`;
  const d = parseDetail(html);
  assert.match(d.content, /寒休日共三天/);
  assert.doesNotMatch(d.content, /下載專區/);
  assert.equal(d.publishedAt.toISOString().slice(0, 10), '2026-11-22');
});

test('parseClub 抓社團性質、介紹、社群連結(排除頁尾)', () => {
  const html = `<h2>社團介紹</h2><p>港澳同學會 NCUHKMAC</p><p>港澳同學會</p><p>聯誼性</p>
    <p>本會宗旨是令各位在臺之中央大學港澳生互相交流。</p><p>IG: ncu.hk.mac.114</p><h3>基本資訊</h3>
    <a href="https://www.instagram.com/ncu.hk.mac.114/">IG</a><a href="https://www.facebook.com/ncustudent/">學生會</a>`;
  const c = parseClub(html, 'https://club.adm.ncu.edu.tw/clubs/%E6%B8%AF%E6%BE%B3%E5%90%8C%E5%AD%B8%E6%9C%83', CLUBS.ignoreLinks);
  assert.equal(c.name, '港澳同學會');
  assert.equal(c.nature, '聯誼性');
  assert.match(c.intro, /港澳生互相交流/);
  assert.deepEqual(c.links, ['https://www.instagram.com/ncu.hk.mac.114/']);
});

test('html 工具', () => {
  assert.equal(htmlToText('<p>A&amp;B</p><script>x</script><br>C&#21488;'), 'A&B\nC台');
  assert.equal(findDates('民國115年11月23日 與 2026/1/5')[0].date.toISOString().slice(0, 10), '2026-11-22');
  assert.equal(findDates('2026/1/5').length, 1);
  assert.equal(extractLinks('<a href="javascript:void(0)">x</a><a href="/a">A</a>', 'https://x.tw/b/').length, 1);
});

test('normalizeAddress 把同一棟的不同寫法視為相同', () => {
  const a = normalizeAddress('桃園市中壢區五權里2鄰中央路232巷47號3樓');
  assert.equal(a, '中壢區中央路232巷47號');
  assert.equal(normalizeAddress('中壢區中央路２３２巷４７號'), a);
  assert.equal(normalizeAddress('中壢區五權里中央路232巷50之1號'), '中壢區中央路232巷50-1號');
});

test('geo / robots / JSON / 地址放寬', () => {
  assert.ok(Math.abs(distanceM(NCU, { lat: 24.9537, lng: 121.2256 }) - 3530) < 200);
  assert.deepEqual(parseRobots('User-agent: Googlebot\nUser-agent: *\nDisallow: /admin\n\nUser-agent: Bad\nDisallow: /'), ['/admin']);
  assert.deepEqual(parseJsonLoose('好的:\n```json\n{"a":"}{","b":[1]}\n```'), { a: '}{', b: [1] });
  assert.equal(parseJsonLoose('沒有 JSON'), null);
  assert.deepEqual(relaxations('中壢區五權里2鄰中央路232巷47號3樓'), [
    '桃園市中壢區中央路232巷47號3樓', '桃園市中壢區中央路232巷47號', '桃園市中壢區中央路232巷', '桃園市中壢區中央路',
  ]);
});

// 依照雲端租屋網 POST /data/house 實際回傳的欄位(房東資料為假資料)
import { mapApiHouse, parseHouseUrl } from '../src/crawlers/houseNfu.js';
const API_HOUSE = {
  all_room_num: 90, ammeter: '有', contact_desc: '房東', deposit: '3000', ex_ori_img_path: 'data/NCU/images_house/3570x1.jpg',
  house_address: '中央路232巷36號', house_city: '桃園市', house_desc: '[滿租]', house_id: 3570, house_name: '嵐苑',
  house_title: '', house_town: '中壢區', house_type: '透天', house_url: 'http://house.nfu.edu.tw/NCU/house/3570',
  latitude: '24.964814', layer: 6, lessor_id: 1, lessor_main_phone: '0900000000', lessor_name: '王先生',
  longitude: '121.1921178', look_flag_desc: '可預約看房', material: '水泥', modify_date: '2026-09-12',
  rent_type: '獨立套房', rental: '3833~5000', rental_min: 3833, rest_room_num: 0, sch_id: 94, sch_name: '國立中央大學', sex_limit: '無限制',
};

test('mapApiHouse:欄位對應正確,且不含房東個資', () => {
  const m = mapApiHouse(API_HOUSE);
  assert.equal(m.externalId, 'NCU/3570');
  assert.equal(m.title, '嵐苑');
  assert.equal(m.address, '桃園市中壢區中央路232巷36號');
  assert.equal(m.lat, 24.964814);
  assert.equal(m.lng, 121.1921178);
  assert.equal(m.price, 3833);
  assert.equal(m.priceMax, 5000);
  assert.equal(m.vacancy, 0); // [滿租]
  assert.equal(m.totalRooms, 90);
  assert.equal(m.sourceUrl, 'https://house.nfu.edu.tw/NCU/house/3570');
  assert.equal(m.imageUrl, 'https://house.nfu.edu.tw/data/NCU/images_house/3570x1.jpg');
  assert.equal(m.fields['說明'], null);
  assert.doesNotMatch(JSON.stringify(m), /0900000000|王先生|lessor/);
});

test('mapApiHouse:有空房、單一租金、沒有座標', () => {
  const m = mapApiHouse({ ...API_HOUSE, house_desc: '近後門', rental: '6000', rental_min: 6000, rest_room_num: 2, latitude: '', longitude: '0', house_name: '', house_title: '' });
  assert.equal(m.vacancy, 2);
  assert.equal(m.priceMax, null);
  assert.equal(m.lat, null);
  assert.equal(m.lng, null);
  assert.equal(m.title, '獨立套房(中央路232巷36號)');
  assert.equal(m.fields['說明'], '近後門');
  assert.deepEqual(parseHouseUrl('https://house.nfu.edu.tw/CYCU/house/12'), ['CYCU', '12']);
});

import { composeContent } from '../src/crawlers/news/parse.js';

test('parseDetail 抓附件、去掉雜訊行;composeContent 附上附件清單', () => {
  const html = `<nav>首頁</nav><main><div class="editor">
    <p>115-1 社團大型活動經費補助審查結果如附件。</p><p>列印</p><p>分享</p>
    <p><a href="/files/news/審查結果.pdf">115-1審查結果.pdf</a></p>
    <p><a href="https://club.adm.ncu.edu.tw/download/abc">申請表</a></p>
    <p><a href="/clubs">社團總覽</a></p></div></main>`;
  const d = parseDetail(html, 'https://club.adm.ncu.edu.tw/news/15476');
  assert.match(d.content, /審查結果如附件/);
  assert.doesNotMatch(d.content, /^列印$|^分享$/m);
  assert.deepEqual(d.attachments, [
    { name: '115-1審查結果.pdf', url: 'https://club.adm.ncu.edu.tw/files/news/%E5%AF%A9%E6%9F%A5%E7%B5%90%E6%9E%9C.pdf' },
    { name: '申請表', url: 'https://club.adm.ncu.edu.tw/download/abc' },
  ]);
  const c = composeContent(d);
  assert.match(c, /\n\n附件:\n• 115-1審查結果\.pdf｜https:\/\/club\.adm\.ncu\.edu\.tw\/files\/news\//);
  assert.equal(composeContent({ content: '只有內文', attachments: [] }), '只有內文');
});

import { cleanTitle } from '../src/crawlers/news/parse.js';
test('cleanTitle:整則公告包成一個連結時只留標題', () => {
  assert.equal(cleanTitle('116年學生社團校外指導老師汽車通行證申請 2026-10-30 課外組公告 公告內容 一、申請期間'), '116年學生社團校外指導老師汽車通行證申請');
  assert.equal(cleanTitle('宿舍導師講座_05/08(四) 跟世界做朋友'), '宿舍導師講座_05/08(四) 跟世界做朋友');
  assert.equal(cleanTitle('2026/1/5 停電公告'), '2026/1/5 停電公告');
  const src = SOURCES.find((s) => s.id === 'club-news');
  const items = parseList('<a href="/news/15531"><h3>116年學生社團校外指導老師汽車通行證申請</h3><span>2026-10-30</span><p>課外組公告 公告內容 一、申請期間</p></a>', src, 'https://club.adm.ncu.edu.tw/');
  assert.equal(items[0].title, '116年學生社團校外指導老師汽車通行證申請');
  assert.equal(items[0].publishedAt.toISOString().slice(0, 10), '2026-10-29');
});
