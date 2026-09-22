// Copies the SQLite database (and optionally uploads) into ./backups with a timestamp.
// Usage: npm run db:backup
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
let url = process.env.DATABASE_URL;
if (!url && fs.existsSync(envFile)) {
  const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (m) url = m[1];
}
url = url || 'file:./dev.db';
const rel = url.replace(/^file:/, '');
const dbPath = path.isAbsolute(rel) ? rel : path.resolve(root, 'prisma', rel);
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `og-system-${stamp}.db`);

// VACUUM INTO produces a consistent snapshot even while the server is running.
const { createClient } = await import('@libsql/client');
const client = createClient({ url: `file:${dbPath}` });
await client.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
client.close();
console.log(`Database backed up to ${target}`);
console.log('Uploaded files live in the uploads folder - copy it too:  ' + path.join(root, 'uploads'));
