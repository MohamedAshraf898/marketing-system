// Demo data for phase 3: spaces / folders / lists over the existing tasks, a template, automation rules, subtasks,
// dependencies, a recurring task, attendance history, a holiday and leave requests.
import { prisma } from '../db';
import type { SeedCtx } from './ctx';

export async function seedPhase3(ctx: SeedCtx): Promise<void> {
  const { admin, sara, omar, lumen, ufuq, dayOnly } = ctx;

  // administrators and clients are not on the attendance roster by default (like the migration)
  await prisma.user.updateMany({ where: { role: { not: 'TEAM' } }, data: { trackAttendance: false } });
  const schedule = (await prisma.workSchedule.findFirst({ where: { isDefault: true } }))
    ?? (await prisma.workSchedule.create({ data: { name: 'Standard', isDefault: true } }));

  // ── hierarchy ──
  const ops = await prisma.space.create({ data: { name: 'Agency operations', color: '#6366f1', position: 0, createdById: admin.id } });
  const lumenSpace = await prisma.space.create({ data: { name: 'Lumen Coffee', color: '#f97316', clientId: lumen.id, position: 1, createdById: admin.id } });
  const ufuqSpace = await prisma.space.create({ data: { name: 'Al-Ufuq', color: '#14b8a6', clientId: ufuq.id, position: 2, createdById: admin.id } });
  await prisma.taskStatusOption.createMany({
    data: [
      { spaceId: lumenSpace.id, name: 'Backlog', color: '#71717a', category: 'TODO', position: 0 },
      { spaceId: lumenSpace.id, name: 'In production', color: '#0ea5e9', category: 'IN_PROGRESS', position: 1 },
      { spaceId: lumenSpace.id, name: 'Internal review', color: '#a855f7', category: 'REVIEW', position: 2 },
      { spaceId: lumenSpace.id, name: 'Waiting on client', color: '#eab308', category: 'BLOCKED', position: 3 },
      { spaceId: lumenSpace.id, name: 'Shipped', color: '#22c55e', category: 'DONE', position: 4 },
    ],
  });
  const lumenProjects = await prisma.project.findMany({ where: { clientId: lumen.id }, orderBy: { createdAt: 'asc' } });
  const ufuqProjects = await prisma.project.findMany({ where: { clientId: ufuq.id }, orderBy: { createdAt: 'asc' } });
  const listOf: Record<string, string> = {};
  for (const [space, projects] of [[lumenSpace, lumenProjects], [ufuqSpace, ufuqProjects]] as const) {
    for (const [i, p] of projects.entries()) {
      const folder = await prisma.folder.create({ data: { spaceId: space.id, name: p.name, projectId: p.id, position: i } });
      const list = await prisma.taskList.create({ data: { spaceId: space.id, folderId: folder.id, projectId: p.id, name: 'Tasks', position: 0 } });
      listOf[p.id] = list.id;
    }
  }
  const lumenGeneral = await prisma.taskList.create({ data: { spaceId: lumenSpace.id, name: 'Social media', position: 9 } });
  const opsList = await prisma.taskList.create({ data: { spaceId: ops.id, name: 'Internal', position: 0 } });

  // existing tasks move into their project's list; every assignee also becomes a TaskAssignee row
  const tasks = await prisma.task.findMany({ select: { id: true, projectId: true, clientId: true, assignedToId: true, status: true } });
  const statuses = await prisma.taskStatusOption.findMany({ where: { spaceId: lumenSpace.id } });
  for (const t of tasks) {
    const listId = t.projectId ? listOf[t.projectId] : t.clientId === lumen.id ? lumenGeneral.id : t.clientId ? null : opsList.id;
    const custom = listId && t.clientId === lumen.id ? statuses.find((s) => s.category === t.status)?.id ?? null : null;
    await prisma.task.update({ where: { id: t.id }, data: { listId, customStatusId: custom } });
    if (t.assignedToId) await prisma.taskAssignee.create({ data: { taskId: t.id, userId: t.assignedToId } }).catch(() => undefined);
  }

  // ── a parent with subtasks, a dependency chain, tags and a client-visible task ──
  const parent = await prisma.task.create({
    data: {
      title: 'Autumn menu launch - social post', clientId: lumen.id, listId: lumenGeneral.id, priority: 'HIGH', status: 'IN_PROGRESS', createdById: sara.id, assignedToId: sara.id,
      startDate: dayOnly(2), dueDate: dayOnly(-8), estimatedHours: 6, visibility: 'CLIENT_VISIBLE', description: 'Carousel + story for the new autumn drinks.', position: 1,
      assignees: { create: [{ userId: sara.id }, { userId: admin.id }] },
    },
  });
  const steps = ['Design', 'Copywriting', 'Review', 'Client Approval', 'Publishing'];
  const subIds: string[] = [];
  for (const [i, title] of steps.entries()) {
    const s = await prisma.task.create({
      data: {
        title, parentId: parent.id, depth: 1, clientId: lumen.id, listId: lumenGeneral.id, position: i, createdById: sara.id, assignedToId: i < 2 ? sara.id : admin.id,
        status: i === 0 ? 'DONE' : i === 1 ? 'IN_PROGRESS' : 'TODO', completedAt: i === 0 ? dayOnly(1) : null, dueDate: dayOnly(1 - i * 2), estimatedHours: 1.5,
        visibility: i === 3 ? 'CLIENT_VISIBLE' : 'INTERNAL', blockOnDependencies: i > 0,
        assignees: { create: [{ userId: i < 2 ? sara.id : admin.id }] },
      },
    });
    subIds.push(s.id);
    if (i > 0) await prisma.taskDependency.create({ data: { taskId: s.id, dependsOnId: subIds[i - 1], type: 'BLOCKS', createdById: sara.id } });
  }
  await prisma.taskChecklistItem.createMany({ data: ['Brief approved', 'Sizes: 1080x1350 + 1080x1920', 'Alt text'].map((text, position) => ({ taskId: parent.id, text, position, done: position === 0 })) });
  const tagSocial = await prisma.taskTag.create({ data: { name: 'Social', color: '#ec4899' } });
  const tagLaunch = await prisma.taskTag.create({ data: { name: 'Launch', color: '#f97316' } });
  await prisma.taskTagLink.createMany({ data: [{ taskId: parent.id, tagId: tagSocial.id }, { taskId: parent.id, tagId: tagLaunch.id }] });
  await prisma.taskComment.create({ data: { taskId: parent.id, userId: sara.id, comment: 'First draft is ready - sharing the direction with the client.', clientVisible: true } });

  // ── recurring weekly report (every Monday) ──
  const report = await prisma.task.create({
    data: {
      title: 'Weekly client report', clientId: ufuq.id, listId: ufuqProjects[0] ? listOf[ufuqProjects[0].id] : null, projectId: ufuqProjects[0]?.id ?? null,
      priority: 'NORMAL', createdById: omar.id, assignedToId: omar.id, dueDate: dayOnly(3), estimatedHours: 1, assignees: { create: [{ userId: omar.id }] },
    },
  });
  const nextMonday = (() => { const d = dayOnly(0); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d; })();
  await prisma.taskRecurrence.create({ data: { taskId: report.id, frequency: 'WEEKLY', interval: 1, weekdays: '1', nextDate: nextMonday } });

  // ── template + automations ──
  await prisma.taskTemplate.create({
    data: {
      name: 'Social Media Post', taskTitle: 'Social media post', priority: 'NORMAL', estimatedHours: 5, createdById: admin.id,
      checklist: JSON.stringify(['Brief', 'Sizes', 'Hashtags']), tags: JSON.stringify(['Social']),
      items: { create: steps.map((title, position) => ({ title, position, dueOffsetDays: position + 1, estimatedHours: 1 })) },
    },
  });
  await prisma.taskAutomation.createMany({
    data: [
      { name: 'Notify the reviewer when work is ready', trigger: 'STATUS_CHANGED', triggerStatus: 'REVIEW', action: 'NOTIFY_REVIEWER', createdById: admin.id },
      { name: 'Escalate overdue work', trigger: 'TASK_OVERDUE', action: 'SET_PRIORITY', config: JSON.stringify({ priority: 'URGENT' }), createdById: admin.id },
    ],
  });

  // ── attendance: the last 10 working days for the team, a holiday, leave ──
  const team = [sara, omar];
  const holiday = dayOnly(12);
  if (holiday.getUTCDay() !== 0 && holiday.getUTCDay() !== 6) await prisma.holiday.create({ data: { date: holiday, name: 'National holiday' } });
  for (let n = 14; n >= 1; n--) {
    const d = dayOnly(n);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6 || d.getTime() === holiday.getTime()) continue;
    for (const [i, u] of team.entries()) {
      const late = (n + i) % 5 === 0 ? 25 : (n + i) % 3 === 0 ? 7 : 0;
      const inAt = new Date(d.getTime() + (9 * 60 + late) * 60_000);
      const outAt = new Date(d.getTime() + (17 * 60 + ((n * 7 + i * 11) % 50)) * 60_000);
      const worked = Math.round((outAt.getTime() - inAt.getTime()) / 60_000) - 45;
      await prisma.attendance.create({
        data: {
          userId: u.id, date: d, scheduleId: schedule.id, checkInAt: inAt, checkOutAt: outAt, remote: (n + i) % 4 === 0,
          status: (n + i) % 4 === 0 ? 'WFH' : late > 10 ? 'LATE' : 'PRESENT', breakMinutes: 45, workedMinutes: worked, expectedMinutes: 420,
          lateMinutes: late > 10 ? late : 0, overtimeMinutes: Math.max(0, worked - 420),
          breaks: { create: [{ startAt: new Date(d.getTime() + 13 * 3_600_000), endAt: new Date(d.getTime() + 13 * 3_600_000 + 45 * 60_000) }] },
        },
      });
    }
  }
  const leaveStart = dayOnly(-8);
  const leaveEnd = dayOnly(-10);
  await prisma.leaveRequest.create({ data: { userId: omar.id, type: 'VACATION', startDate: leaveStart, endDate: leaveEnd, days: 3, reason: 'Family visit' } });
  await prisma.leaveRequest.create({
    data: { userId: sara.id, type: 'SICK', startDate: dayOnly(20), endDate: dayOnly(20), days: 1, status: 'APPROVED', reviewedById: admin.id, reviewedAt: dayOnly(19) },
  });
}
