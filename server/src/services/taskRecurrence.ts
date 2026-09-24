// Recurring tasks. The task a TaskRecurrence hangs off is the blueprint; every occurrence becomes a NEW task.
//
// Duplicate-proof by construction:
//  - (recurrenceSourceId, occurrenceDate) is UNIQUE in the database, so the same occurrence can never be created twice,
//    even by two job runs racing each other;
//  - nextDate is advanced with a compare-and-set update (only if it still holds the value this run read).
// Missed occurrences older than CATCH_UP_DAYS are skipped rather than flooding the board after downtime.
import type { RecurrenceFrequency } from '@prisma/client';
import { prisma } from '../db';
import { addDaysKey, dateOnly, keyOf, weekdayOfKey } from '../lib/zoned';
import { todayUtc } from './projects';
import { resolveCustomStatus } from './tasks';
import { afterCreate, insertTask, SYSTEM } from './taskWrite';

export const CATCH_UP_DAYS = 7;
const MAX_PER_RUN = 31;

export interface Rule { frequency: RecurrenceFrequency; interval: number; weekdays: string | null; monthDay: number | null }

export const parseWeekdays = (raw: string | null): number[] =>
  raw ? [...new Set(raw.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const weekIndex = (key: string) => Math.floor((dateOnly(key).getTime() / 86_400_000 + 3) / 7); // Monday-based week number

/** The first occurrence on or after `fromKey` (inclusive) - used to anchor a new rule. */
export function firstOccurrence(rule: Rule, fromKey: string): string {
  if (rule.frequency === 'WEEKLY') {
    const days = parseWeekdays(rule.weekdays);
    if (days.length === 0) return fromKey;
    for (let i = 0; i < 7; i++) {
      const k = addDaysKey(fromKey, i);
      if (days.includes(weekdayOfKey(k))) return k;
    }
  }
  if (rule.frequency === 'MONTHLY' && rule.monthDay) {
    const d = dateOnly(fromKey);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = Math.min(rule.monthDay, daysInMonth(y, m));
    const candidate = keyOf(new Date(Date.UTC(y, m, day)));
    if (candidate >= fromKey) return candidate;
    return keyOf(new Date(Date.UTC(y, m + 1, Math.min(rule.monthDay, daysInMonth(y, m + 1)))));
  }
  return fromKey;
}

/** The occurrence after `key` (exclusive). */
export function nextOccurrence(rule: Rule, key: string): string {
  const n = Math.max(1, rule.interval);
  switch (rule.frequency) {
    case 'DAILY':
    case 'CUSTOM':
      return addDaysKey(key, n);
    case 'WEEKLY': {
      const days = parseWeekdays(rule.weekdays);
      if (days.length === 0) return addDaysKey(key, 7 * n);
      const base = weekIndex(key);
      for (let i = 1; i <= 7 * n + 7; i++) {
        const k = addDaysKey(key, i);
        const diff = weekIndex(k) - base;
        if (days.includes(weekdayOfKey(k)) && (diff === 0 || diff % n === 0)) return k;
      }
      return addDaysKey(key, 7 * n);
    }
    case 'MONTHLY': {
      const d = dateOnly(key);
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
      const day = Math.min(rule.monthDay ?? d.getUTCDate(), daysInMonth(target.getUTCFullYear(), target.getUTCMonth()));
      return keyOf(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day)));
    }
  }
}

/** Creates one occurrence of a blueprint task. Returns the new id, or null when that occurrence already exists. */
async function createOccurrence(sourceId: string, occurrence: string): Promise<string | null> {
  const src = await prisma.task.findUnique({
    where: { id: sourceId },
    include: {
      assignees: { select: { userId: true } },
      tagLinks: { select: { tag: { select: { name: true } } } },
      checklist: { orderBy: { position: 'asc' }, select: { text: true } },
      list: { select: { spaceId: true } },
    },
  });
  if (!src || src.archivedAt) return null;
  const due = dateOnly(occurrence);
  // keep the blueprint's start -> due span
  const span = src.startDate && src.dueDate ? src.dueDate.getTime() - src.startDate.getTime() : null;
  const status = await resolveCustomStatus(src.list?.spaceId ?? null, { status: 'TODO' });
  try {
    const id = await insertTask(prisma, {
      title: src.title, description: src.description, priority: src.priority, status: 'TODO', customStatusId: status.customStatusId,
      startDate: span !== null ? new Date(due.getTime() - span) : null, dueDate: due, estimatedHours: src.estimatedHours, visibility: src.visibility,
      links: { clientId: src.clientId, projectId: src.projectId, campaignId: src.campaignId, listId: src.listId, spaceId: src.list?.spaceId ?? null, parentId: src.parentId, depth: src.depth },
      deliverableId: null, requestId: src.requestId, reviewerId: src.reviewerId,
      assigneeIds: src.assignees.map((a) => a.userId), primaryAssigneeId: src.assignedToId,
      tagNames: src.tagLinks.map((l) => l.tag.name), blockOnDependencies: false, createdById: src.createdById,
      checklist: src.checklist.map((c) => c.text), recurrenceSourceId: src.id, occurrenceDate: due,
    });
    await afterCreate(SYSTEM, id, { extraAudit: { recurring: true, sourceId: src.id, occurrence } });
    return id;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return null; // already generated (unique key) - never a duplicate
    throw err;
  }
}

/** Generates every due occurrence (maintenance job). Safe to run as often as you like. */
export async function generateRecurringTasks(now = new Date()): Promise<number> {
  const today = keyOf(todayUtc());
  void now;
  const due = await prisma.taskRecurrence.findMany({ where: { active: true, nextDate: { lte: dateOnly(today) } }, take: 500 });
  let created = 0;
  for (const rec of due) {
    let k = keyOf(rec.nextDate);
    const end = rec.endDate ? keyOf(rec.endDate) : null;
    let steps = 0;
    while (k <= today && steps < MAX_PER_RUN && (!end || k <= end)) {
      if (k >= addDaysKey(today, -CATCH_UP_DAYS) && (await createOccurrence(rec.taskId, k))) created++;
      k = nextOccurrence(rec, k);
      steps++;
    }
    const finished = !!end && k > end;
    // compare-and-set: a concurrent run that already advanced this rule wins, this one changes nothing
    await prisma.taskRecurrence.updateMany({ where: { id: rec.id, nextDate: rec.nextDate }, data: { nextDate: dateOnly(k), lastRunAt: new Date(), ...(finished ? { active: false } : {}) } });
  }
  return created;
}
