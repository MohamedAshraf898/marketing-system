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

// A remote libSQL database (e.g. Turso) has no local file to VACUUM INTO, and it has its own,
// better backup story (point-in-time recovery / branching) - point at that instead of guessing.
if (/^(libsql|https?):\/\//i.test(url)) {
  console.log('DATABASE_URL points at a remote database (not a local file), so there is nothing here to copy.');
  console.log('Use your database host\'s own backup/export feature instead - for Turso: `turso db shows <name>`');
  console.log('and `turso db export`, or point-in-time-recovery / branching from the Turso dashboard/CLI.');
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver === 's3') {
    console.log('Uploaded files are in your S3-compatible bucket (STORAGE_DRIVER=s3) - back that up via its own tools.');
  } else {
    const uploads = process.env.UPLOAD_DIR ? path.resolve(root, process.env.UPLOAD_DIR) : path.join(root, 'uploads');
    console.log('Uploaded files still live on local disk - copy it too:  ' + uploads);
  }
  process.exit(0);
}

const rel = url.replace(/^file:/, '');
const dbPath = path.isAbsolute(rel) ? rel : path.resolve(root, 'prisma', rel);
if (!fs.existsSync(dbPath)) {
  console.error(`Database file not found: ${dbPath}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(root, 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `og-system-${stamp}.db`);

// VACUUM INTO produces a consistent snapshot even while the server is running.
const { createClient } = await import('@libsql/client');
const client = createClient({ url: `file:${dbPath}` });
await client.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
client.close();
console.log(`Database backed up to ${target}`);
const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
if (driver === 's3') {
  console.log('Uploaded files are in your S3-compatible bucket (STORAGE_DRIVER=s3) - back that up via its own tools.');
} else {
  const uploads = process.env.UPLOAD_DIR ? path.resolve(root, process.env.UPLOAD_DIR) : path.join(root, 'uploads');
  console.log('Uploaded files live in the uploads folder - copy it too:  ' + uploads);
}
