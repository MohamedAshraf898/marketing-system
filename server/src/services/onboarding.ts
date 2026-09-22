import type { Prisma } from '@prisma/client';
import type { OnboardingStatus } from '../../../shared/src/enums';
import { prisma } from '../db';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The checklist every new client starts with. The English title is what is stored (a stable key); the web app
 * translates these known titles, so Arabic users see them in Arabic.
 */
export const DEFAULT_ONBOARDING_TITLES = [
  'Contract signed',
  'First invoice sent',
  'Access to ad accounts',
  'Brand assets received',
  'Social media access',
  'Kickoff meeting completed',
  'First campaign planned',
  'First deliverable approved',
] as const;

/** Creates the default checklist (only when the client has no items yet). Returns how many items were created. */
export async function createDefaultChecklist(clientId: string, db: Db = prisma): Promise<number> {
  const existing = await db.onboardingItem.count({ where: { clientId } });
  if (existing > 0) return 0;
  await db.onboardingItem.createMany({
    data: DEFAULT_ONBOARDING_TITLES.map((title, position) => ({ clientId, title, position })),
  });
  return DEFAULT_ONBOARDING_TITLES.length;
}

export interface OnboardingProgress {
  total: number;
  done: number;
  percent: number; // 0-100
  overdue: number;
}

export function startOfTodayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function progressOf(items: Array<{ done: boolean; dueDate: Date | null }>, now = new Date()): OnboardingProgress {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const today = startOfTodayUtc(now);
  const overdue = items.filter((i) => !i.done && i.dueDate && i.dueDate < today).length;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100), overdue };
}

export function statusFromCounts(total: number, done: number): OnboardingStatus {
  if (total === 0) return 'NOT_STARTED';
  return done === total ? 'COMPLETED' : 'IN_PROGRESS';
}

/** Keeps Client.onboardingStatus consistent with its checklist. Call after every change to the items. */
export async function syncOnboardingStatus(clientId: string, db: Db = prisma): Promise<OnboardingStatus> {
  const [total, done] = await Promise.all([
    db.onboardingItem.count({ where: { clientId } }),
    db.onboardingItem.count({ where: { clientId, done: true } }),
  ]);
  const status = statusFromCounts(total, done);
  await db.client.update({ where: { id: clientId }, data: { onboardingStatus: status } });
  return status;
}
