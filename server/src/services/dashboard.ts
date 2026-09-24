import type { Prisma } from '@prisma/client';
import {
  ACTIVE_PROJECT_STATUSES, ACTIVE_TASK_STATUSES, CLIENT_STATUSES, CONTENT_STATUSES, OPEN_REQUEST_STATUSES, OUTSTANDING_INVOICE_STATUSES,
  type ContentStatus, type ClientStatus,
} from '../../../shared/src/enums';
import { prisma } from '../db';
import {
  activityWhere, campaignWhere, clientTaskWhere, clientWhere, contentWhere, contractWhere, deliverableWhere, invoiceWhere, projectWhere, reportWhere,
  requestWhere, taskWhere, timeEntryWhere, type Scope,
} from '../authz/scope';
import { dayBoard, loadSchedules, todayKeyFor } from './attendance';
import { assignedTo } from './tasks';
import type { Ctx } from '../lib/context';
import { attachPreviews } from './deliverables';
import { addDaysUtc, loadProjectStats, progressOf, todayUtc } from './projects';
import { and, parseJson } from './serializers';

/**
 * The dashboard is one payload per role. The original fields (kpis, activeCampaigns, recentCampaigns, pendingApprovals,
 * requests, recentReports, recentFeedback, client) are unchanged; the phase-2 widgets are ADDED next to them.
 * A widget the caller has no permission for is simply absent from the response (not merely hidden by the UI), and a
 * CLIENT user never receives anything internal (tasks, hours, onboarding, retainer, notes ...).
 */
export async function buildDashboard(ctx: Ctx) {
  const base = await buildBase(ctx);
  const extra = ctx.user.role === 'CLIENT' ? await buildClientWidgets(ctx) : await buildStaffWidgets(ctx);
  return { ...base, ...extra };
}

/** Phase-1 dashboard, one implementation for all three roles - the scope decides what each role can count. */
async function buildBase(ctx: Ctx) {
  const s = ctx.scope;
  const cw = (extra?: Prisma.CampaignWhereInput) => and<Prisma.CampaignWhereInput>(campaignWhere(s), extra);
  const dw = (extra?: Prisma.DeliverableWhereInput) => and<Prisma.DeliverableWhereInput>(deliverableWhere(s), extra);
  const rw = (extra?: Prisma.RequestWhereInput) => and<Prisma.RequestWhereInput>(requestWhere(s), extra);

  const [
    activeCampaignCount,
    pendingApprovalCount,
    openRequestCount,
    spend,
    activeCampaigns,
    recentCampaigns,
    pendingApprovals,
    openRequests,
    recentReports,
  ] = await Promise.all([
    prisma.campaign.count({ where: cw({ status: 'RUNNING' }) }),
    prisma.deliverable.count({ where: dw({ status: 'PENDING_APPROVAL' }) }),
    prisma.request.count({ where: rw({ status: { in: OPEN_REQUEST_STATUSES } }) }),
    prisma.campaign.aggregate({ where: cw(), _sum: { spent: true } }),
    prisma.campaign.findMany({
      where: cw({ status: 'RUNNING' }),
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } } },
    }),
    prisma.campaign.findMany({
      where: cw(),
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } } },
    }),
    prisma.deliverable.findMany({
      where: dw({ status: 'PENDING_APPROVAL' }),
      orderBy: { submittedAt: 'desc' },
      take: 5,
      include: { campaign: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
    }),
    prisma.request.findMany({
      // clients see their most recent requests (any status); staff see what is still open
      where: ctx.user.role === 'CLIENT' ? rw() : rw({ status: { in: OPEN_REQUEST_STATUSES } }),
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { client: { select: { id: true, companyName: true } }, assignedTo: { select: { id: true, name: true } } },
    }),
    prisma.report.findMany({
      where: reportWhere(s),
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      include: { campaign: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
    }),
  ]);

  const base = {
    role: ctx.user.role,
    activeCampaigns,
    recentCampaigns,
    pendingApprovals: await attachPreviews(s, pendingApprovals),
    requests: openRequests,
    recentReports,
  };
  const totalSpend = spend._sum.spent ?? 0;

  if (ctx.user.role === 'CLIENT') {
    const client = s.clientId
      ? await prisma.client.findUnique({ where: { id: s.clientId }, select: { id: true, name: true, companyName: true, logo: true } })
      : null;
    return {
      ...base,
      client: client && { id: client.id, name: client.name, companyName: client.companyName, hasLogo: !!client.logo },
      kpis: { activeCampaigns: activeCampaignCount, pendingApprovals: pendingApprovalCount, openRequests: openRequestCount, totalSpend },
    };
  }

  if (ctx.user.role === 'ADMIN') {
    const [totalClients, activeClients] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { status: 'ACTIVE' } }),
    ]);
    return {
      ...base,
      kpis: { totalClients, activeClients, activeCampaigns: activeCampaignCount, pendingApprovals: pendingApprovalCount, openRequests: openRequestCount, totalSpend },
    };
  }

  // TEAM
  const [assignedClients, assignedCampaigns, pendingDeliverables, clientComments, changeRequests] = await Promise.all([
    prisma.client.count({ where: clientWhere(s) }),
    prisma.campaign.count({ where: cw() }),
    prisma.deliverable.count({ where: dw({ status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } }) }),
    prisma.comment.findMany({
      where: { authorType: 'CLIENT', deliverable: { is: deliverableWhere(s) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { id: true, name: true } }, deliverable: { select: { id: true, name: true } }, client: { select: { companyName: true } } },
    }),
    prisma.approval.findMany({
      where: { decision: 'CHANGES_REQUESTED', deliverable: { is: deliverableWhere(s) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { id: true, name: true } }, deliverable: { select: { id: true, name: true } }, client: { select: { companyName: true } } },
    }),
  ]);

  const recentFeedback = [
    ...clientComments.map((c) => ({
      id: `c-${c.id}`, kind: 'COMMENT' as const, text: c.comment, at: c.createdAt,
      user: c.user, deliverable: c.deliverable, company: c.client.companyName,
    })),
    ...changeRequests.map((a) => ({
      id: `a-${a.id}`, kind: 'CHANGES_REQUESTED' as const, text: a.comment ?? '', at: a.decidedAt ?? a.createdAt,
      user: a.user, deliverable: a.deliverable, company: a.client.companyName,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 6);

  return {
    ...base,
    kpis: {
      assignedClients,
      assignedCampaigns,
      pendingDeliverables,
      pendingApprovals: pendingApprovalCount,
      openRequests: openRequestCount,
    },
    recentFeedback,
  };
}


// ───────────────────────── phase 2 widgets ─────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Audit metadata keys that are safe to show in an activity feed (short scalars only; never ip / raw metadata). */
const SUMMARY_KEYS = [
  'name', 'title', 'companyName', 'status', 'from', 'to', 'version', 'decision', 'invoiceNumber', 'contractNumber', 'file', 'fileName', 'role',
] as const;

function summarize(raw: string | null): Record<string, string | number> | null {
  const m = parseJson(raw);
  if (!m) return null;
  const out: Record<string, string | number> = {};
  for (const k of SUMMARY_KEYS) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'string' && v.length > 0) out[k] = v.slice(0, 120);
  }
  return Object.keys(out).length ? out : null;
}

/** Last 10 activity rows the caller may see (activityWhere: staff = their clients, client = clientVisible rows of its own company). */
async function recentActivity(s: Scope) {
  const rows = await prisma.auditLog.findMany({
    where: activityWhere(s),
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, action: true, entity: true, entityId: true, metadata: true, clientId: true, projectId: true, createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    clientId: r.clientId,
    projectId: r.projectId,
    actorName: r.user?.name ?? null,
    createdAt: r.createdAt,
    summary: summarize(r.metadata),
  }));
}

/** Monday 00:00 UTC of the current week. */
function weekStartUtc(today: Date): Date {
  return addDaysUtc(today, -((today.getUTCDay() + 6) % 7));
}

async function buildStaffWidgets(ctx: Ctx) {
  const s = ctx.scope;
  const has = (p: Parameters<Scope['permissions']['has']>[0]) => s.permissions.has(p);
  const today = todayUtc();
  const tomorrow = addDaysUtc(today, 1);
  const in7 = addDaysUtc(today, 7);
  const in8 = addDaysUtc(today, 8);
  const in30 = addDaysUtc(today, 30);
  const weekStart = weekStartUtc(today);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const tw = (extra?: Prisma.TaskWhereInput) => and<Prisma.TaskWhereInput>(taskWhere(s), { status: { in: ACTIVE_TASK_STATUSES }, archivedAt: null }, extra);
  const pw = (extra?: Prisma.ProjectWhereInput) => and<Prisma.ProjectWhereInput>(projectWhere(s), extra);
  const cnw = (extra?: Prisma.ContentItemWhereInput) => and<Prisma.ContentItemWhereInput>(contentWhere(s), extra);
  const ctw = (extra?: Prisma.ContractWhereInput) => and<Prisma.ContractWhereInput>(contractWhere(s), extra);
  const iw = (extra?: Prisma.InvoiceWhereInput) => and<Prisma.InvoiceWhereInput>(invoiceWhere(s), extra);

  const out: Record<string, unknown> = {};
  const jobs: Array<Promise<void>> = [];
  const job = (fn: () => Promise<void>) => { jobs.push(fn()); };

  const deadlineParts: Array<{ kind: 'TASK' | 'PROJECT' | 'MILESTONE' | 'CONTENT'; id: string; title: string; date: Date; projectId?: string | null; clientName?: string | null }> = [];

  // ── tasks ──
  if (has('tasks.view')) {
    job(async () => {
      const mine = (extra?: Prisma.TaskWhereInput) => and<Prisma.TaskWhereInput>(tw(extra), assignedTo(s.userId));
      const [open, overdue, dueToday, dueSoon, completedThisWeek, next, overdueTotal, upcoming] = await Promise.all([
        prisma.task.count({ where: mine() }),
        prisma.task.count({ where: mine({ dueDate: { lt: today } }) }),
        prisma.task.count({ where: mine({ dueDate: { gte: today, lt: tomorrow } }) }),
        prisma.task.count({ where: mine({ dueDate: { gte: tomorrow, lt: in8 } }) }),
        prisma.task.count({ where: and<Prisma.TaskWhereInput>(taskWhere(s), assignedTo(s.userId), { status: 'DONE', completedAt: { gte: weekStart } }) }),
        prisma.task.findMany({
          where: mine({ dueDate: { not: null } }),
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 5,
          select: { id: true, title: true, dueDate: true, priority: true, status: true, project: { select: { id: true, name: true } }, client: { select: { id: true, companyName: true } } },
        }),
        prisma.task.count({ where: tw({ dueDate: { lt: today } }) }),
        prisma.task.findMany({
          where: tw({ dueDate: { gte: today, lt: in30 } }),
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: { id: true, title: true, dueDate: true, projectId: true, client: { select: { companyName: true } } },
        }),
      ]);
      out.myTasks = { open, overdue, dueToday, upcoming: dueSoon, completedThisWeek, next };
      out.overdueTasks = { total: overdueTotal };
      for (const t of upcoming) if (t.dueDate) deadlineParts.push({ kind: 'TASK', id: t.id, title: t.title, date: t.dueDate, projectId: t.projectId, clientName: t.client?.companyName ?? null });
    });
  }

  // ── projects / milestones ──
  if (has('projects.view')) {
    job(async () => {
      const activeWhere = pw({ status: { in: ACTIVE_PROJECT_STATUSES } });
      const riskWhere = pw({ status: { in: ACTIVE_PROJECT_STATUSES }, dueDate: { not: null, lt: in8 } });
      const [active, atRiskCount, atRisk, upcoming, milestones] = await Promise.all([
        prisma.project.count({ where: activeWhere }),
        prisma.project.count({ where: riskWhere }),
        prisma.project.findMany({
          where: riskWhere,
          orderBy: { dueDate: 'asc' },
          take: 5,
          select: { id: true, name: true, status: true, dueDate: true, client: { select: { id: true, companyName: true } } },
        }),
        prisma.project.findMany({
          where: pw({ status: { in: ACTIVE_PROJECT_STATUSES }, dueDate: { gte: today, lt: in30 } }),
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: { id: true, name: true, dueDate: true, client: { select: { companyName: true } } },
        }),
        prisma.milestone.findMany({
          where: { completedAt: null, dueDate: { gte: today, lt: in30 }, project: { is: pw({ status: { in: ACTIVE_PROJECT_STATUSES } }) } },
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: { id: true, title: true, dueDate: true, projectId: true, project: { select: { name: true } } },
        }),
      ]);
      out.projects = {
        active,
        atRisk: atRiskCount,
        atRiskItems: atRisk.map((p) => ({ id: p.id, name: p.name, status: p.status, dueDate: p.dueDate, client: p.client, overdue: !!p.dueDate && p.dueDate < today })),
      };
      for (const p of upcoming) if (p.dueDate) deadlineParts.push({ kind: 'PROJECT', id: p.id, title: p.name, date: p.dueDate, projectId: p.id, clientName: p.client.companyName });
      for (const m of milestones) if (m.dueDate) deadlineParts.push({ kind: 'MILESTONE', id: m.id, title: `${m.title} · ${m.project.name}`, date: m.dueDate, projectId: m.projectId });
    });
  }

  // ── content pipeline ──
  if (has('content.view')) {
    job(async () => {
      const [grouped, scheduled, upcoming] = await Promise.all([
        prisma.contentItem.groupBy({ by: ['status'], where: cnw(), _count: { _all: true } }),
        prisma.contentItem.findMany({ where: cnw({ publishDate: { gte: today, lt: in7 }, status: { not: 'REJECTED' } }), select: { publishDate: true }, take: 2000 }),
        prisma.contentItem.findMany({
          where: cnw({ publishDate: { gte: today, lt: in30 }, status: { notIn: ['REJECTED', 'PUBLISHED'] } }),
          orderBy: { publishDate: 'asc' },
          take: 10,
          select: { id: true, title: true, publishDate: true, client: { select: { companyName: true } } },
        }),
      ]);
      const byStatus = Object.fromEntries(CONTENT_STATUSES.map((st) => [st, 0])) as Record<ContentStatus, number>;
      for (const g of grouped) byStatus[g.status] = g._count._all;
      const days = Array.from({ length: 7 }, (_, i) => ({ date: addDaysUtc(today, i).toISOString().slice(0, 10), count: 0 }));
      for (const c of scheduled) {
        const k = c.publishDate?.toISOString().slice(0, 10);
        const d = days.find((x) => x.date === k);
        if (d) d.count += 1;
      }
      out.contentPipeline = { byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0), next7Days: days };
      for (const c of upcoming) if (c.publishDate) deadlineParts.push({ kind: 'CONTENT', id: c.id, title: c.title, date: c.publishDate, clientName: c.client.companyName });
    });
  }

  // ── deliverables waiting for the client (oldest first) ──
  job(async () => {
    const where = and<Prisma.DeliverableWhereInput>(deliverableWhere(s), { status: 'PENDING_APPROVAL' });
    const [count, oldest] = await Promise.all([
      prisma.deliverable.count({ where }),
      prisma.deliverable.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        take: 5,
        select: { id: true, name: true, type: true, submittedAt: true, client: { select: { id: true, companyName: true } } },
      }),
    ]);
    out.approvalsWaiting = { count, oldest };
  });

  // ── clients + onboarding ──
  if (has('clients.view')) {
    job(async () => {
      const onboardingWhere: Prisma.ClientWhereInput = and<Prisma.ClientWhereInput>(
        { onboardingStatus: 'IN_PROGRESS' },
        s.role === 'ADMIN' ? {} : { id: { in: s.fullClientIds } }, // onboarding checklists are limited to whole-client assignments
      );
      const [byStatus, inProgress] = await Promise.all([
        prisma.client.groupBy({ by: ['status'], where: clientWhere(s), _count: { _all: true } }),
        prisma.client.findMany({ where: onboardingWhere, select: { id: true, companyName: true }, take: 200 }),
      ]);
      const statusCounts = Object.fromEntries(CLIENT_STATUSES.map((st) => [st, 0])) as Record<ClientStatus, number>;
      for (const g of byStatus) statusCounts[g.status] = g._count._all;
      out.clientsByStatus = statusCounts;

      const ids = inProgress.map((c) => c.id);
      const items = ids.length
        ? await prisma.onboardingItem.groupBy({ by: ['clientId', 'done'], where: { clientId: { in: ids } }, _count: { _all: true } })
        : [];
      const tally = new Map<string, { done: number; total: number }>();
      for (const r of items) {
        const t = tally.get(r.clientId) ?? { done: 0, total: 0 };
        t.total += r._count._all;
        if (r.done) t.done += r._count._all;
        tally.set(r.clientId, t);
      }
      const rows = inProgress.map((c) => {
        const t = tally.get(c.id) ?? { done: 0, total: 0 };
        return { clientId: c.id, companyName: c.companyName, done: t.done, total: t.total, progress: t.total ? Math.round((t.done / t.total) * 100) : 0 };
      });
      rows.sort((a, b) => a.progress - b.progress || a.companyName.localeCompare(b.companyName));
      out.onboarding = { inProgress: rows.length, lowest: rows.slice(0, 4) };
    });
  }

  // ── money ──
  if (has('contracts.view')) {
    job(async () => {
      const where = ctw({ status: { in: ['ACTIVE', 'EXPIRING'] }, endDate: { gte: today, lt: addDaysUtc(today, 31) } });
      const [count, items] = await Promise.all([
        prisma.contract.count({ where }),
        prisma.contract.findMany({
          where,
          orderBy: { endDate: 'asc' },
          take: 5,
          select: { id: true, name: true, contractNumber: true, endDate: true, client: { select: { id: true, companyName: true } } },
        }),
      ]);
      out.contractsExpiring = { count, items };
    });
  }
  if (has('invoices.view')) {
    job(async () => {
      const outstanding = iw({ status: { in: OUTSTANDING_INVOICE_STATUSES } });
      const overdue = iw({ OR: [{ status: 'OVERDUE' }, { status: { in: ['SENT', 'PENDING'] }, dueDate: { lt: today } }] });
      const [o, od, paid] = await Promise.all([
        prisma.invoice.aggregate({ where: outstanding, _sum: { total: true }, _count: { _all: true } }),
        prisma.invoice.aggregate({ where: overdue, _sum: { total: true }, _count: { _all: true } }),
        prisma.invoice.aggregate({ where: iw({ status: 'PAID', paidAt: { gte: monthStart } }), _sum: { total: true }, _count: { _all: true } }),
      ]);
      out.invoices = {
        outstandingTotal: round2(o._sum.total ?? 0), outstandingCount: o._count._all,
        overdueTotal: round2(od._sum.total ?? 0), overdueCount: od._count._all,
        paidThisMonth: round2(paid._sum.total ?? 0), paidThisMonthCount: paid._count._all,
      };
    });
  }

  // ── hours (own; team total only with time.view_all) ──
  if (has('time.track')) {
    job(async () => {
      const [mine, running, team] = await Promise.all([
        prisma.timeEntry.aggregate({ where: { userId: s.userId, startedAt: { gte: weekStart }, endedAt: { not: null } }, _sum: { durationSec: true } }),
        prisma.timeEntry.findFirst({ where: { userId: s.userId, endedAt: null }, select: { startedAt: true } }),
        has('time.view_all')
          ? prisma.timeEntry.aggregate({ where: and<Prisma.TimeEntryWhereInput>(timeEntryWhere(s), { startedAt: { gte: weekStart }, endedAt: { not: null } }), _sum: { durationSec: true } })
          : Promise.resolve(null),
      ]);
      const runningSec = running ? Math.max(0, Math.round((Date.now() - running.startedAt.getTime()) / 1000)) : 0;
      out.hours = {
        weekStart: weekStart.toISOString().slice(0, 10),
        mineSec: (mine._sum.durationSec ?? 0) + runningSec,
        ...(team ? { teamSec: (team._sum.durationSec ?? 0) + runningSec } : {}),
      };
    });
  }

  // ── attendance (own day; the team's live board only with attendance.view_all) ──
  if (has('attendance.track') || has('attendance.view_all') || has('leave.approve')) {
    job(async () => {
      const book = await loadSchedules();
      const now = new Date();
      if (has('attendance.track')) {
        const me = await prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, name: true, avatar: true, jobTitle: true, role: true, workScheduleId: true, createdAt: true } });
        const schedule = book.byId.get(me?.workScheduleId ?? '') ?? book.def;
        const key = todayKeyFor(schedule, now);
        const [row] = me ? await dayBoardFor(key, book, now, me.id) : [];
        if (row) out.myAttendance = { date: row.date, status: row.status, presence: row.presence, checkInAt: row.checkInAt, checkOutAt: row.checkOutAt, workedMinutes: row.workedMinutes, lateMinutes: row.lateMinutes, onBreak: row.onBreak, schedule: row.schedule };
      }
      if (has('attendance.view_all')) {
        const key = todayKeyFor(book.def, now);
        const rows = await dayBoard(key, book, now);
        const presence: Record<string, number> = {};
        for (const r of rows) presence[r.presence] = (presence[r.presence] ?? 0) + 1;
        out.teamAttendance = {
          date: key,
          members: rows.length,
          presence,
          late: rows.filter((r) => r.lateMinutes > 0).slice(0, 6).map((r) => ({ userId: r.userId, name: r.user?.name ?? '', lateMinutes: r.lateMinutes, checkInAt: r.checkInAt })),
          working: rows.filter((r) => r.presence === 'WORKING' || r.presence === 'ON_BREAK').slice(0, 8).map((r) => ({ userId: r.userId, name: r.user?.name ?? '', presence: r.presence, checkInAt: r.checkInAt })),
        };
      }
      if (has('leave.approve')) out.pendingLeave = { count: await prisma.leaveRequest.count({ where: { status: 'PENDING' } }) };
    });
  }

  // ── team workload snapshot (overdue work per person, only work the caller may see) ──
  if (has('workload.view') && has('tasks.view')) {
    job(async () => {
      const overdueWhere = and<Prisma.TaskWhereInput>(tw({ dueDate: { lt: today } }));
      const grouped = await prisma.taskAssignee.groupBy({ by: ['userId'], where: { task: overdueWhere }, _count: { _all: true }, orderBy: { _count: { userId: 'desc' } }, take: 6 });
      const users = await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.userId) } }, select: { id: true, name: true } });
      const names = new Map(users.map((u) => [u.id, u.name]));
      out.teamWorkload = { overdueByPerson: grouped.map((g) => ({ userId: g.userId, name: names.get(g.userId) ?? '', overdue: g._count._all })) };
    });
  }

  job(async () => { out.recentActivity = await recentActivity(s); });

  await Promise.all(jobs);

  if (deadlineParts.length) {
    out.upcomingDeadlines = deadlineParts.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 10);
  } else if (has('tasks.view') || has('projects.view') || has('content.view')) {
    out.upcomingDeadlines = [];
  }
  return out;
}

/** The roster board narrowed to one person (their own day). */
const dayBoardFor = (key: string, book: Awaited<ReturnType<typeof loadSchedules>>, now: Date, userId: string) => dayBoard(key, book, now, userId, true);

async function buildClientWidgets(ctx: Ctx) {
  const s = ctx.scope;
  const today = todayUtc();
  const in14 = addDaysUtc(today, 14);
  const in30 = addDaysUtc(today, 31);
  const out: Record<string, unknown> = {};

  const [projects, content, invoiceCount, contractCount, reportRes, activity] = await Promise.all([
    prisma.project.findMany({
      where: and<Prisma.ProjectWhereInput>(projectWhere(s), { status: { notIn: ['CANCELLED'] } }),
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 6,
      select: { id: true, name: true, status: true, dueDate: true },
    }),
    prisma.contentItem.findMany({
      where: and<Prisma.ContentItemWhereInput>(contentWhere(s), { publishDate: { gte: today, lt: in14 }, status: { not: 'REJECTED' } }),
      orderBy: { publishDate: 'asc' },
      take: 8,
      select: { id: true, title: true, platform: true, contentType: true, publishDate: true },
    }),
    prisma.invoice.count({ where: invoiceWhere(s) }),
    prisma.contract.count({ where: contractWhere(s) }),
    // summary of the 30 days ending at the newest report (reports are entered by hand, so "last 30 days from today" could be empty)
    prisma.report.findFirst({ where: reportWhere(s), orderBy: { date: 'desc' }, select: { date: true } }).then((latest) =>
      latest
        ? prisma.report.aggregate({
            where: and<Prisma.ReportWhereInput>(reportWhere(s), { date: { gt: addDaysUtc(latest.date, -30), lte: latest.date } }),
            _sum: { spend: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
            _count: { _all: true },
          }).then((agg) => ({ agg, until: latest.date }))
        : null,
    ),
    recentActivity(s),
  ]);

  // tasks the agency explicitly shared with this client (never internal ones)
  const shared = clientTaskWhere(s);
  const [sharedOpen, sharedItems] = await Promise.all([
    prisma.task.count({ where: and<Prisma.TaskWhereInput>(shared, { status: { not: 'DONE' } }) }),
    prisma.task.findMany({
      where: and<Prisma.TaskWhereInput>(shared, { status: { not: 'DONE' } }),
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 5,
      select: { id: true, title: true, status: true, dueDate: true, project: { select: { id: true, name: true } } },
    }),
  ]);
  if (sharedOpen > 0) out.sharedTasks = { open: sharedOpen, items: sharedItems };

  const stats = await loadProjectStats(projects.map((p) => p.id), today);
  out.projects = projects.map((p) => {
    const st = stats.get(p.id)!;
    return { id: p.id, name: p.name, status: p.status, dueDate: p.dueDate, progress: progressOf(st, p.status), milestoneCounts: { total: st.milestonesTotal, done: st.milestonesDone } };
  });
  out.upcomingContent = content;
  out.recentActivity = activity;

  if (reportRes && reportRes.agg._count._all > 0) {
    const reportAgg = reportRes.agg;
    const spend = reportAgg._sum.spend ?? 0;
    const impressions = reportAgg._sum.impressions ?? 0;
    const clicks = reportAgg._sum.clicks ?? 0;
    out.reportSummary = {
      days: 30,
      until: reportRes.until,
      reports: reportAgg._count._all,
      spend: round2(spend),
      impressions,
      clicks,
      conversions: reportAgg._sum.conversions ?? 0,
      ctr: impressions > 0 ? round2((clicks / impressions) * 100) : null,
      roas: spend > 0 ? round2((reportAgg._sum.conversionValue ?? 0) / spend) : null,
    };
  }

  if (invoiceCount > 0) {
    const shared = (extra: Prisma.InvoiceWhereInput) => and<Prisma.InvoiceWhereInput>(invoiceWhere(s), extra);
    const [o, od] = await Promise.all([
      prisma.invoice.aggregate({ where: shared({ status: { in: OUTSTANDING_INVOICE_STATUSES } }), _sum: { total: true }, _count: { _all: true } }),
      prisma.invoice.aggregate({ where: shared({ OR: [{ status: 'OVERDUE' }, { status: { in: ['SENT', 'PENDING'] }, dueDate: { lt: today } }] }), _sum: { total: true }, _count: { _all: true } }),
    ]);
    out.invoices = { outstandingTotal: round2(o._sum.total ?? 0), outstandingCount: o._count._all, overdueTotal: round2(od._sum.total ?? 0), overdueCount: od._count._all };
  }
  if (contractCount > 0) {
    const where = and<Prisma.ContractWhereInput>(contractWhere(s), { status: { in: ['ACTIVE', 'EXPIRING'] }, endDate: { gte: today, lt: in30 } });
    const [count, items] = await Promise.all([
      prisma.contract.count({ where }),
      prisma.contract.findMany({ where, orderBy: { endDate: 'asc' }, take: 5, select: { id: true, name: true, endDate: true } }),
    ]);
    out.contractsExpiring = { count, items };
  }
  return out;
}
