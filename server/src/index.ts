import fs from 'node:fs';
import { createApp } from './app';
import { config } from './config';
import { tuneSqlite } from './db';
import { startMaintenance } from './services/maintenance';

async function main() {
  // Only needed for the local-disk storage driver; S3-compatible storage has no local folder.
  if (config.storageDriver !== 's3') fs.mkdirSync(config.uploadDir, { recursive: true });
  await tuneSqlite();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Famolya API listening on http://localhost:${config.port}  (${config.env})`);
    if (!config.isProd) console.log(`Web app (dev): ${config.clientOrigins[0]}`);
    startMaintenance(); // contract expiry, overdue invoices, task reminders
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
