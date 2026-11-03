import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 開發時把 /api 與 /auth 轉給後端(4000),瀏覽器只看到同一個網址,免去跨網域 cookie 問題
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/auth': 'http://localhost:4000' },
  },
});
