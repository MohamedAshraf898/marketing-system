// One-command first-time setup:  npm run setup
//  1. creates .env from .env.example (with a random SESSION_SECRET)
//  2. creates/updates the SQLite database (prisma migrate deploy)
//  3. loads demo data (npm run seed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\nCommand failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
};

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(envPath, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
  console.log('Created .env with a fresh random SESSION_SECRET');
} else {
  console.log('.env already exists - keeping it');
}

console.log('\n> Applying database migrations');
run('npx', ['prisma', 'migrate', 'deploy']);

if (!process.argv.includes('--no-seed')) {
  console.log('\n> Loading demo data');
  run('npm', ['run', 'seed']);
}

console.log('\nAll set. Start the app with:  npm run dev');
console.log('Open http://localhost:5173  (see the README for the demo logins)');
