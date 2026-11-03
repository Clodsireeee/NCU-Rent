import multer from 'multer';
import { HttpError } from '../lib/http.js';

export const MAX_IMAGES = 8;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_IMAGES }, // 單張 5MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new HttpError(400, '僅支援 JPG / PNG / WebP 圖片'));
  },
});
