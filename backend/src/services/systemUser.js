import { prisma } from '../lib/prisma.js';

/** 爬蟲 / 同步資料的擁有者帳號(不是真人,無法登入) */
export function getSystemUser() {
  return prisma.user.upsert({
    where: { googleId: 'system-sync' },
    update: {},
    create: { googleId: 'system-sync', email: 'system-sync@ncu-rent.local', name: '資料同步' },
  });
}
