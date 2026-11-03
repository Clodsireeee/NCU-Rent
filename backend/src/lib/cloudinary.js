import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** 將記憶體中的圖片 buffer 上傳到 Cloudinary,回傳 { url, publicId } */
export function uploadBuffer(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'ncu-rent',
          resource_type: 'image',
          transformation: [{ width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
        },
        (err, result) =>
          err ? reject(err) : resolve({ url: result.secure_url, publicId: result.public_id }),
      )
      .end(buffer);
  });
}

/** 刪除雲端圖片(盡力而為,失敗不影響主流程) */
export async function deleteImages(publicIds) {
  if (!publicIds.length) return;
  try {
    await cloudinary.api.delete_resources(publicIds);
  } catch (e) {
    console.error('Cloudinary 刪除失敗:', e.message);
  }
}
