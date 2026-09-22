/**
 * Creates (or recovers) the first ADMIN account from environment variables.
 * Safe to use in production - it only touches the admin user.
 *
 *   npm run seed:admin                     create the admin from SEED_ADMIN_* in .env
 *   npm run seed:admin -- --reset-password set a new password for that admin
 */
import { hashPassword, passwordProblem } from '../auth/password';
import { prisma } from '../db';

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Admin';
  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in your .env file first (see .env.example).');
  }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`SEED_ADMIN_PASSWORD is not strong enough (${problem}). Use 8+ characters with letters and numbers.`);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (process.argv.includes('--reset-password')) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), status: 'ACTIVE', role: 'ADMIN', clientId: null } });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      console.log(`Password reset for ${email} (all sessions signed out).`);
    } else {
      console.log(`Admin ${email} already exists. Use --reset-password to set a new password.`);
    }
    return;
  }
  await prisma.user.create({ data: { name, email, role: 'ADMIN', passwordHash: await hashPassword(password) } });
  console.log(`Admin created: ${email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
