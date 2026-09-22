import { prisma } from '../db';
import type { SeedCtx } from './ctx';

/**
 * Demo data for the "time" group (runs AFTER the work / content seeds, so it queries the tasks / projects that exist).
 * Three weeks of finished entries for Sara and Omar, roughly 5-7 hours per weekday. No timer is left running.
 * Falls back to project-only or client-only entries when there are no tasks.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES_EN = ['Creative review', 'Ad copy drafts', 'Audience research', 'Client call and follow-up', 'Reporting and analysis', 'Design revisions', 'Campaign optimisation', 'Content planning', 'Asset preparation', 'Internal sync'];
const NOTES_AR = ['مراجعة التصاميم', 'كتابة نصوص الإعلانات', 'بحث الجمهور المستهدف', 'مكالمة مع العميل ومتابعتها', 'تحليل الأداء وإعداد التقرير', 'تعديلات على التصميم', 'تحسين الحملة', 'تخطيط المحتوى', 'تجهيز الملفات', 'اجتماع داخلي'];

interface Target { taskId: string | null; projectId: string | null; clientId: string | null }

export async function seedTime(ctx: SeedCtx): Promise<void> {
  const people = [
    { user: ctx.sara, clientIds: [ctx.lumen.id], seed: 101 },
    { user: ctx.omar, clientIds: [ctx.ufuq.id], seed: 202 },
  ];

  const now = Date.now();
  const rows: Array<{ userId: string; taskId: string | null; projectId: string | null; clientId: string | null; startedAt: Date; endedAt: Date; durationSec: number; notes: string | null }> = [];
  const touchedTasks = new Set<string>();

  for (const p of people) {
    const rnd = prng(p.seed);
    const arabic = p.user.locale === 'ar';

    // where this person's time can go: their own tasks, else tasks of their clients, else projects, else the clients themselves
    const tasks = await prisma.task.findMany({
      where: { OR: [{ assignedToId: p.user.id }, { clientId: { in: p.clientIds } }] },
      select: { id: true, projectId: true, clientId: true, project: { select: { clientId: true } } },
      take: 60,
    });
    const projects = tasks.length ? [] : await prisma.project.findMany({ where: { clientId: { in: p.clientIds } }, select: { id: true, clientId: true }, take: 20 });
    const targets: Target[] = tasks.length
      ? tasks.map((t) => ({ taskId: t.id, projectId: t.projectId, clientId: t.clientId ?? t.project?.clientId ?? null }))
      : projects.length
        ? projects.map((pr) => ({ taskId: null, projectId: pr.id, clientId: pr.clientId }))
        : p.clientIds.map((clientId) => ({ taskId: null, projectId: null, clientId }));

    for (let back = 21; back >= 1; back--) {
      const day = new Date(now - back * 86_400_000);
      const dow = day.getUTCDay();
      if (dow === 5 || dow === 6) continue; // Friday / Saturday off (agency week Sun-Thu); demo days stay in the past
      const dayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      const total = (5 + rnd() * 2) * HOUR; // 5-7 h logged
      let remaining = total;
      let cursor = dayStart + (7 + Math.floor(rnd() * 2)) * HOUR + Math.floor(rnd() * 4) * 15 * MIN; // 07:00-08:45 UTC start
      while (remaining >= 15 * MIN) {
        // a few short (15-30 min) and long (2-3 h) blocks, mostly 45 min - 2 h
        const r = rnd();
        let len = r < 0.2 ? (1 + Math.floor(rnd() * 2)) * 15 * MIN : r > 0.85 ? (2 + rnd()) * HOUR : (0.75 + rnd() * 1.25) * HOUR;
        len = Math.min(Math.round(len / (5 * MIN)) * 5 * MIN, remaining);
        if (len < 15 * MIN) break;
        const target = rnd() < 0.08 ? { taskId: null, projectId: null, clientId: p.clientIds[0] } : targets[Math.floor(rnd() * targets.length)];
        const notes = rnd() < 0.55 ? (arabic ? NOTES_AR : NOTES_EN)[Math.floor(rnd() * NOTES_EN.length)] : null;
        rows.push({
          userId: p.user.id, ...target,
          startedAt: new Date(cursor), endedAt: new Date(cursor + len), durationSec: Math.round(len / 1000), notes,
        });
        if (target.taskId) touchedTasks.add(target.taskId);
        remaining -= len;
        cursor += len + (rnd() < 0.3 ? 30 * MIN : 5 * MIN); // lunch / short break
      }
    }
  }

  if (rows.length) await prisma.timeEntry.createMany({ data: rows });

  // Task.actualHours = hours of the task's finished entries, recomputed from the DB
  if (touchedTasks.size) {
    const sums = await prisma.timeEntry.groupBy({ by: ['taskId'], where: { taskId: { in: [...touchedTasks] }, endedAt: { not: null } }, _sum: { durationSec: true } });
    for (const s of sums) {
      if (!s.taskId) continue;
      await prisma.task.update({ where: { id: s.taskId }, data: { actualHours: Math.round(((s._sum.durationSec ?? 0) / 3600) * 100) / 100 } });
    }
  }
}
