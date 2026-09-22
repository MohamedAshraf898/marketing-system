import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { ROOT, config, resolveDbFile } from '../config';

/**
 * Applies prisma/migrations/*\/migration.sql to a SQLite file using plain SQL.
 * Used by the automated tests (fresh temp DB per test file). For your real database use
 * `npx prisma migrate deploy` / `migrate dev` - that is the supported path.
 */
export async function applyMigrations(dbFile = resolveDbFile(config.databaseUrl)): Promise<void> {
  const dir = path.join(ROOT, 'prisma', 'migrations');
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const client = createClient({ url: `file:${dbFile}` });
  try {
    for (const f of folders) {
      await client.executeMultiple(fs.readFileSync(path.join(dir, f, 'migration.sql'), 'utf8'));
    }
  } finally {
    client.close();
  }
}
