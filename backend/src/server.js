import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRONTEND_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('缺少環境變數:', missing.join(', '));
  process.exit(1);
}

// 環境變數檢查通過後才載入 app(passport / cloudinary 在 import 時就會讀取 env)
const { default: app } = await import('./app.js');
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`NCU-Rent API running on :${port}`));
