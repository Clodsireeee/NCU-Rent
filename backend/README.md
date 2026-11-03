# NCU-Rent Backend (Phase 2)

## 啟動
```bash
npm install
cp .env.example .env     # 填入 Google / Cloudinary / DB 設定
npx prisma migrate dev --name init
npm run dev
```
Google Cloud Console 的「已授權重新導向 URI」需加入 `GOOGLE_CALLBACK_URL`。

## API 一覽
| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET | /auth/google | - | 導向 Google 登入 |
| GET | /auth/google/callback | - | 回呼,驗證 @g.ncu.edu.tw,寫入 httpOnly cookie |
| GET | /auth/me | 登入 | 目前使用者 |
| POST | /auth/logout | - | 登出 |
| GET | /api/properties | 公開 | `?bbox=minLng,minLat,maxLng,maxLat&subsidy=true&trash=true&parking=true&minPrice=&maxPrice=` |
| GET | /api/properties/:id | 公開 | 詳情 + 匿名評價 |
| POST | /api/properties | 登入 | multipart: title,address,lat,lng,price,description,rentSubsidy,hasTrashService,hasIndoorParking,images[] |
| PUT | /api/properties/:id | 擁有者/管理員 | 修改欄位 |
| DELETE | /api/properties/:id | 擁有者/管理員 | 刪除(連帶圖片、評價) |
| POST | /api/properties/:id/images | 擁有者/管理員 | 追加圖片 |
| DELETE | /api/properties/:id/images/:imageId | 擁有者/管理員 | 刪除圖片 |
| GET | /api/properties/:id/reviews | 公開 | 匿名評價列表 |
| POST | /api/properties/:id/reviews | 登入 | `{rating:1-5, content}`,重複評價回 409 |
| PUT | /api/reviews/:id | 本人 | 修改自己的評價 |
| DELETE | /api/reviews/:id | 本人/管理員 | 刪除評價 |

## 前端串接注意
- fetch / axios 需帶 `credentials: 'include'`。
- 前後端不同網域(Vercel ↔ Render)時,production 會自動使用 `SameSite=None; Secure`。
- 登入失敗會導回 `${FRONTEND_URL}/login?error=DOMAIN_NOT_ALLOWED`。
