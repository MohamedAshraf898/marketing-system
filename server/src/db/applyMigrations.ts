import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { ROOT, config, resolveDbFile, isRemoteDbUrl } from '../config';

/**
 * Applies prisma/migrations/*\/migration.sql using plain SQL over the libSQL protocol.
 *
 * - Called with an explicit `dbFile` (every test does this, with a fresh temp path): always
 *   targets that local SQLite file, regardless of what DATABASE_URL is set to.
 * - Called with no argument: targets `config.databaseUrl` directly - a local file path as
 *   before, or a remote libSQL host (e.g. Turso) when DATABASE_URL is a `libsql://`/`https://`
 *   URL. This is what production migrations use instead of `prisma migrate deploy`, since
 *   Prisma's CLI/schema-engine for a "sqlite" datasource only supports local file URLs and
 *   this project cannot download Prisma's engine binaries in some sandboxes anyway - this
 *   raw-SQL path already has no such dependency and is exercised by every test run.
 *
 * Idempotent: a `_og_migrations` bookkeeping table (parallel to Prisma's own
 * `_prisma_migrations`) records which migration folders already ran, so calling this again on
 * every container start - which a redeploy or restart against a remote database does - only
 * applies migrations that are new, instead of re-running `CREATE TABLE` against tables that
 * already exist.
 */
export async function applyMigrations(dbFile?: string): Promise<void> {
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const remote = dbFile === undefined && isRemoteDbUrl(config.databaseUrl);
  const client = remote
    ? createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken })
    : createClient({ url: `file:${dbFile ?? resolveDbFile(config.databaseUrl)}` });
  try {
    await client.execute(
      'CREATE TABLE IF NOT EXISTS "_og_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const already = new Set((await client.execute('SELECT "name" FROM "_og_migrations"')).rows.map((r) => String(r.name)));
    for (const f of folders) {
      if (already.has(f)) continue;
      await client.executeMultiple(fs.readFileSync(path.join(dir, f, 'migration.sql'), 'utf8'));
      await client.execute({ sql: 'INSERT INTO "_og_migrations" ("name") VALUES (?)', args: [f] });
    }
  } finally {
    client.close();
  }
}
