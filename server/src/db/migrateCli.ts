// Tiny CLI wrapper so production startup (scripts/start-prod.sh) can apply migrations without
// Prisma's CLI/schema-engine - see applyMigrations.ts for why. Run with: tsx src/db/migrateCli.ts
import { applyMigrations } from './applyMigrations';
import { config, isRemoteDbUrl } from '../config';

applyMigrations()
  .then(() => {
    console.log(`Migrations applied (${isRemoteDbUrl(config.databaseUrl) ? 'remote' : 'local'} database).`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
