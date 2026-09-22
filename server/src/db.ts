import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { config, resolveDbFile } from './config';

const globalForPrisma = globalThis as unknown as { __ogPrisma?: PrismaClient };

function create(): PrismaClient {
  const adapter = new PrismaLibSQL({ url: `file:${resolveDbFile(config.databaseUrl)}` });
  return new PrismaClient({
    adapter,
    log: config.isProd || config.isTest ? ['error'] : ['error', 'warn'],
  });
}

/** Single shared Prisma client (all database access goes through here). */
export const prisma: PrismaClient = globalForPrisma.__ogPrisma ?? create();
if (!config.isProd) globalForPrisma.__ogPrisma = prisma;

/** Small SQLite tuning: WAL keeps readers from blocking the writer. Safe to ignore failures. */
export async function tuneSqlite(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  } catch {
    /* not fatal */
  }
}
