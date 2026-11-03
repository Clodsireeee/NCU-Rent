import { z } from 'zod';

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** multipart/query 傳來的 "true"/"false" 字串轉布林 */
export const boolStr = z.preprocess(
  (v) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : v),
  z.boolean(),
);
