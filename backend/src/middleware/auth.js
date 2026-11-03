import jwt from 'jsonwebtoken';
import { HttpError } from '../lib/http.js';

function readToken(req) {
  if (req.cookies?.token) return req.cookies.token;
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return null;
}

function decode(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return { id: Number(p.sub), role: p.role };
  } catch {
    return null;
  }
}

/** 有登入就帶入 req.user,沒登入也放行 */
export function optionalAuth(req, _res, next) {
  req.user = decode(req);
  next();
}

/** 必須登入 */
export function requireAuth(req, _res, next) {
  req.user = decode(req);
  if (!req.user) return next(new HttpError(401, '請先使用中大信箱登入'));
  next();
}

export function signToken(user) {
  return jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}
