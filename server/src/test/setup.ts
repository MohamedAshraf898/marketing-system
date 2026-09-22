// Runs before every test file: gives that file its own throw-away SQLite database + upload folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { beforeAll, afterAll } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:${path.join(dir, `${crypto.randomUUID()}.db`)}`;
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.SESSION_SECRET = 'test-secret-test-secret-test-secret-123';

beforeAll(async () => {
  const { applyMigrations } = await import('../db/applyMigrations');
  await applyMigrations();
});

afterAll(async () => {
  const { prisma } = await import('../db');
  await prisma.$disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});
