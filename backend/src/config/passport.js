import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../lib/prisma.js';

const DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'g.ncu.edu.tw').toLowerCase();
const adminEmails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const emailObj = profile.emails?.[0];
        const email = emailObj?.value?.toLowerCase();

        // 伺服器端再次驗證網域與信箱已驗證(前端 hd 參數可被繞過,不可信任)
        const verified = emailObj?.verified === true || emailObj?.verified === 'true';
        if (!email || !verified || !email.endsWith(`@${DOMAIN}`)) {
          return done(null, false, { message: 'DOMAIN_NOT_ALLOWED' });
        }

        const role = adminEmails.includes(email) ? 'ADMIN' : 'STUDENT';
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: { email, name: profile.displayName, role },
          create: { googleId: profile.id, email, name: profile.displayName, role },
        });
        done(null, user);
      } catch (err) {
        done(err);
      }
    },
  ),
);

export default passport;
