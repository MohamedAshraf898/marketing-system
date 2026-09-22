import dotenv from 'dotenv';
import path from 'node:path';

/** Repository root (server/src -> server -> root). */
export const ROOT = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(ROOT, '.env') });

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const sessionSecret = env.SESSION_SECRET ?? (isTest ? 'test-secret-test-secret-test-secret-123' : '');

if (!isTest) {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or shorter than 32 characters. Copy .env.example to .env (or run "npm run setup") and set a long random value.',
    );
  }
  if (isProd && /change-me/i.test(sessionSecret)) {
    throw new Error('Refusing to start in production with the example SESSION_SECRET. Generate a random one.');
  }
}

export const config = {
  env: nodeEnv,
  isProd,
  isTest,
  port: Number(env.PORT ?? 4000),
  clientOrigins: (env.CLIENT_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  sessionSecret,
  sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 14),
  cookieSecure: env.COOKIE_SECURE === 'true',
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR ?? './uploads'),
  maxUploadBytes: Math.round(Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024),
  currency: env.APP_CURRENCY ?? 'USD',
  databaseUrl: env.DATABASE_URL ?? 'file:./dev.db',
  webDist: path.join(ROOT, 'client', 'dist'),
  cookieName: 'og_session',
} as const;

/**
 * Prisma resolves relative SQLite paths against the folder of schema.prisma.
 * We do the same so the CLI (migrate/studio) and the running app use one file.
 */
export function resolveDbFile(url: string): string {
  const raw = url.replace(/^file:/, '');
  if (raw === ':memory:') return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, 'prisma', raw);
}
