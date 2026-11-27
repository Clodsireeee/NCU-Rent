# NCU-Rent Backend (Phase 3)

## 啟動
```bash
npm install
cp .env.example .env     # 填入 Google / Cloudinary / DB 設定(AI、Google Maps 金鑰可之後再補)
npx prisma migrate dev    # 會套用 migrations/ 內所有變更,包含本次新增的 20261124060000_sources_moderation_campus
npm test                  # 單元測試(解析器、審核規則、標籤…,不需要資料庫)
npm run dev
```
Google Cloud Console 的「已授權重新導向 URI」需加入 `GOOGLE_CALLBACK_URL`。

## 資料同步(第一次部署後依序執行)
| 指令 | 頻率 | 說明 |
|---|---|---|
| `npm run import:fire` | 每年(學校公告新名單時) | 匯入 `data/ncu-fire-safety-113.json`:中大軍訓室「消防合格名單」77 個地址 |
| `npm run sync:houses` | 每週 | 教育部雲端租屋網:中大 + 鄰近學校(`NEARBY_SCHOOLS`)位於中大周邊的房源 |
| `npm run sync:news` | 每天 | 中大校園公告、中大新聞、課外組/社團公告 → AI 標籤 |
| `npm run sync:clubs` | 每學期 | 課外組社團總覽 |
| `npm run sync:eateries` | 每週 | Google Places 中大周邊店家(需 `GOOGLE_MAPS_API_KEY`) |

所有腳本都支援 `--dry-run`(只解析、不寫入)。`.github/workflows/sync.yml` 已設定好 GitHub Actions 定時執行,只要在 repo 的 Secrets 填入 `DATABASE_URL` 等變數即可。

### 1. 房源資料不足 → 三個來源
- **NCU_HOUSE**:中大校外賃居網。爬蟲直接呼叫網站自己用的清單 API(`POST https://house.nfu.edu.tw/data/house`,內容 `{"arrSchId":[94]}`),一次拿到全部房源與經緯度;新的或有更新的房源再去抓詳細頁補屋況說明與設備。
- **NEARBY_SCHOOL**:中原、元智等學校也用同一個平台。到 `https://house.nfu.edu.tw/<學校代碼>` 用 F12 → Network → `house` → Payload 找到該校的 `arrSchId` 數字,加進 `.env` 的 `HOUSE_SCHOOL_IDS`(例如 `94,12`)。只保留距離中大 `NEARBY_RADIUS_KM` 公里內的。
- **FIRE_LIST**:學校消防合格名單。地址與既有房源相同時,房源會加上「🧯消防合格」徽章;沒有對應房源的地址會建立「租金洽詢」的佔位標記。定位失敗的地址可在 `data/ncu-fire-safety-113.json` 該筆手動加上 `"lat"`、`"lng"`。

來源網站下架的房源,下次同步時會自動在地圖上隱藏。

> 隱私:API 會回傳房東姓名與電話,爬蟲**刻意不儲存**,前端只提供「查看原網頁」連結。

### 2. 評論審核
送出 / 修改評論時:**規則檢查**(髒話、威脅、仇恨、性騷擾、個資、廣告,含「幹 . 你 . 娘」「ㄍㄋㄋ」這類規避寫法)→ 有設定 `AI_API_KEY` 再交給 **AI 判斷語意**,取兩者較嚴格的結果:
- `allow` → 直接公開
- `review` → 存為 `PENDING`,只有作者看得到「審核中」,管理員在前端「審核後台」核准或駁回
- `block` → 回 422,請使用者修改

具體的負面經驗(押金不退、漏水、房東很兇)**不會**被攔,這是平台價值所在,測試裡有專門的案例。被 `REPORT_THRESHOLD`(預設 3)位使用者檢舉會自動下架等審核。調整規則:`src/services/moderation.js` 的 `RULES`。

### 3. 周邊美食(Google Places API)
使用官方 Places API (New),不爬 Google 地圖網頁(違反條款、容易被封)。依 Google 條款:
- 資料庫只存 `place_id`(可永久保存)、座標(最多 30 天,同步腳本自動更新/清除)與分類
- 店名、地址、評分、營業時間在使用者**點開店家時即時查詢**,並顯示「Google Maps」標示與連結
- 學生自行新增的店家(`source=USER`)不受此限

### 4. 校園最新資訊 + AI 標籤
- 來源設定在 `src/crawlers/news/sources.js`,學校網站改版時通常只要改這裡;要加系所網站也是照格式加一筆
- 標籤是固定字彙(`src/services/tagger.js` 的 `TAGS`,共 21 個,例如 社團活動 / 講座演講 / 獎助學金 / 徵才實習 / 停水停電),前端可複選篩選
- 有 AI 金鑰時另外產生:一兩句摘要、活動時間、地點、社團名稱(「只看即將舉辦的活動」靠這個)
- 沒有 AI 金鑰時用關鍵字規則貼標;之後補上金鑰可執行 `node scripts/sync-news.js --retag`
- 社團的 IG / FB 貼文沒有抓(違反 Meta 條款),社團名錄會附上社團的 IG / FB 連結

### 5. 生成式 AI(需要 Claude API 金鑰)
在 `.env` 設定 `AI_API_KEY` 後執行 `npm run ai:check`,會實際測試金鑰與各項 AI 功能。

| 功能 | 位置 | 說明 |
|---|---|---|
| 評論審核 | `src/services/moderation.js` | 規則先擋明顯的髒話,AI 再判斷語意(拐彎罵人、人身攻擊) |
| 校園消息標籤、摘要、活動時間地點 | `src/services/tagger.js` | 新公告自動處理;舊公告用 `node scripts/sync-news.js --retag` 重新處理 |
| 租屋代理人 | `src/services/agent.js`、`POST /api/ai/agent` | Claude 透過工具呼叫(tool use)自己查房源、評論、通勤、校園消息,最多 `AGENT_MAX_STEPS` 輪 |
| 新生入學包 | `src/services/freshman.js`、`POST /api/ai/freshman` | 依身分/住宿/興趣整理指南;時程日期只能來自真實公告,並附來源 |
| MCP 伺服器 | `src/routes/mcp.js`、`POST /mcp` | 讓 Claude 等 AI 助理直接查 NCU-Rent;支援 MCP 2026-07-28 與 2025-11-25 以前的版本 |

代理人與 MCP 共用 `src/services/rentTools.js` 的 7 個唯讀工具:`search_properties`、`get_property`、`estimate_commute`、`search_campus_news`、`get_campus_news`、`list_news_tags`、`search_clubs`。

費用控制:`AGENT_HOURLY_LIMIT`(登入者每小時)、`AGENT_GUEST_HOURLY_LIMIT`(訪客每小時,設 0 = 必須登入)、`AGENT_DAILY_LIMIT`(全站每天)。建議另外在 Anthropic Console 設定每月花費上限。

在 Claude 連接 MCP:Claude 設定 → 連接器(Connectors)→ 新增自訂連接器 → 網址填 `https://你的網站/mcp`。
用官方工具測試:`npx @modelcontextprotocol/inspector`,Transport 選 Streamable HTTP,網址填 `http://localhost:4000/mcp`。

## API 一覽
| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET | /auth/google | - | 導向 Google 登入 |
| GET | /auth/google/callback | - | 回呼,驗證 @g.ncu.edu.tw,寫入 httpOnly cookie |
| GET | /auth/me | 登入 | 目前使用者 |
| POST | /auth/logout | - | 登出 |
| GET | /api/properties | 公開 | `?bbox=&subsidy=&trash=&parking=&minPrice=&maxPrice=&type=&fireSafe=true&vacantOnly=true&source=NCU_HOUSE` |
| GET | /api/properties/:id | 公開 | 詳情 + 匿名評價(本人另可看到自己審核中的評價) |
| POST | /api/properties | 登入 | multipart: title,address,lat,lng,price,description,rentSubsidy,hasTrashService,hasIndoorParking,images[] |
| PUT | /api/properties/:id | 擁有者/管理員 | 修改欄位 |
| DELETE | /api/properties/:id | 擁有者/管理員 | 刪除(連帶圖片、評價) |
| POST | /api/properties/:id/images | 擁有者/管理員 | 追加圖片 |
| DELETE | /api/properties/:id/images/:imageId | 擁有者/管理員 | 刪除圖片 |
| GET | /api/properties/:id/reviews | 公開 | 匿名評價列表 |
| POST | /api/properties/:id/reviews | 登入 | `{rating:1-5, content}`;審核未過回 422,重複評價回 409;回應的 `notice` 表示需人工審核 |
| PUT | /api/reviews/:id | 本人 | 修改自己的評價(重新審核) |
| DELETE | /api/reviews/:id | 本人/管理員 | 刪除評價 |
| POST | /api/reviews/:id/report | 登入 | 檢舉 `{reason}` |
| GET | /api/eateries | 公開 | `?bbox=&category=&source=GOOGLE\|USER`(Google 店家 `name` 為 null) |
| GET | /api/eateries/:id | 公開 | 詳情;Google 店家附即時 `google` 欄位 |
| POST | /api/eateries/:id/reviews | 登入 | 店家評論(同樣經過審核) |
| POST | /api/eateries/reviews/:rid/report | 登入 | 檢舉店家評論 |
| GET | /api/campus/tags | 公開 | 標籤清單與近 180 天數量 |
| GET | /api/campus/posts | 公開 | `?tags=社團活動,講座演講&match=any\|all&upcoming=true&source=&q=&page=` |
| GET | /api/campus/sources | 公開 | 消息來源 |
| GET | /api/campus/clubs | 公開 | `?q=&nature=` 社團名錄 |
| GET | /api/admin/moderation | 管理員 | `?status=PENDING&reported=true` 審核佇列 |
| POST | /api/admin/moderation/:kind/:id | 管理員 | `{action: approve\|reject\|delete, reason}`,kind = review / eateryReview |
| GET | /api/admin/stats | 管理員 | 待審數、檢舉數、各來源房源數 |
| GET | /api/ai/status | 公開 | AI 功能是否啟用 |
| POST | /api/ai/agent | 公開(有次數限制) | `{messages:[{role,content}]}` → `{reply, steps, propertyIds, usage}` |
| POST | /api/ai/freshman | 公開(有次數限制) | `{identity, housing, interests[], lang}` → 入學指南 |
| POST | /mcp | 公開(唯讀) | MCP 伺服器(JSON-RPC) |

## 前端串接注意
- fetch / axios 需帶 `credentials: 'include'`。
- 前後端不同網域(Vercel ↔ Render)時,production 會自動使用 `SameSite=None; Secure`。
- 登入失敗會導回 `${FRONTEND_URL}/login?error=DOMAIN_NOT_ALLOWED`。
- 管理員帳號:把信箱加到 `.env` 的 `ADMIN_EMAILS`,重新登入後右上角會出現「審核後台」。
