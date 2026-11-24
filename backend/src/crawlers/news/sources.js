// 校園消息來源設定。學校網站改版時,通常只需要調整這裡。
// 要新增來源(例如系所網站),照格式加一筆即可:
//   id         唯一代號(存在 CampusPost.source)
//   name       顯示名稱
//   listUrl    (page) => 第 page 頁列表網址
//   maxPages   每次最多往回翻幾頁(增量更新時遇到已存在的就會提早停)
//   isDetail   (url: URL) => 這個連結是不是公告內文頁
//   categories 列表上可能出現的分類字樣(會存成 rawCategory)
//   publisher  預設公告單位

export const SOURCES = [
  {
    id: 'ncu-events',
    name: '中大校園公告',
    listUrl: (p) => `https://www.ncu.edu.tw/tw/events/index.php?page=${p}`,
    maxPages: 5,
    isDetail: (u) => u.hostname === 'www.ncu.edu.tw' && /^\/tw\/events\//.test(u.pathname) && !/index\.php$/.test(u.pathname),
    categories: ['行政', '演講', '徵才', '活動', '其他'],
  },
  {
    id: 'ncu-news',
    name: '中大新聞',
    listUrl: (p) => `https://www.ncu.edu.tw/tw/news/index.php?page=${p}`,
    maxPages: 2,
    isDetail: (u) => u.hostname === 'www.ncu.edu.tw' && /^\/tw\/news\//.test(u.pathname) && !/index\.php$/.test(u.pathname),
    categories: ['頭條新聞', '學術研究', '校園新聞', '榮譽榜'],
    publisher: '秘書室',
  },
  {
    id: 'club-news',
    name: '課外組/社團公告',
    listUrl: (p) => (p === 1 ? 'https://club.adm.ncu.edu.tw/' : `https://club.adm.ncu.edu.tw/?page=${p}`),
    maxPages: 4,
    isDetail: (u) => u.hostname === 'club.adm.ncu.edu.tw' && /^\/news\/\d+$/.test(u.pathname),
    categories: [],
    publisher: '學務處課外活動組',
  },
];

export const CLUBS = {
  listUrl: (p) => (p === 1 ? 'https://club.adm.ncu.edu.tw/clubs' : `https://club.adm.ncu.edu.tw/clubs?page=${p}`),
  maxPages: 10,
  isDetail: (u) => u.hostname === 'club.adm.ncu.edu.tw' && /^\/clubs\/[^/]+$/.test(u.pathname),
  // 網站頁尾固定連結,不是社團自己的
  ignoreLinks: [/facebook\.com\/ncustudent/i, /facebook\.com\/NCUSPCAREYOU/i, /ncu\.edu\.tw/i],
};
