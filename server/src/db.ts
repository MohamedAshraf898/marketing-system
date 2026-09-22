import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { config, resolveDbFile, isRemoteDbUrl } from './config';

const globalForPrisma = globalThis as unknown as { __ogPrisma?: PrismaClient };

/** True when DATABASE_URL points at a remote libSQL host (e.g. Turso) instead of a local file. */
export const isRemoteDatabase = isRemoteDbUrl(config.databaseUrl);

function create(): PrismaClient {
  const adapter = isRemoteDatabase
    ? new PrismaLibSQL({ url: config.databaseUrl, authToken: config.databaseAuthToken })
    : new PrismaLibSQL({ url: `file:${resolveDbFile(config.databaseUrl)}` });
  return new PrismaClient({
    adapter,
    log: config.isProd || config.isTest ? ['error'] : ['error', 'warn'],
  });
}

/** Single shared Prisma client (all database access goes through here). */
export const prisma: PrismaClient = globalForPrisma.__ogPrisma ?? create();
if (!config.isProd) globalForPrisma.__ogPrisma = prisma;

/**
 * Small SQLite tuning: WAL keeps readers from blocking the writer. Safe to ignore failures.
 * Only meaningful for a local file database - a remote libSQL host (Turso) manages its own
 * concurrency and does not support these pragmas over its network protocol.
 */
export async function tuneSqlite(): Promise<void> {
  if (isRemoteDatabase) return;
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  } catch {
    /* not fatal */
  }
}
