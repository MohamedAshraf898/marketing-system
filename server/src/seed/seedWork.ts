import type { Priority, ProjectStatus, TaskStatus } from '@prisma/client';
import { prisma } from '../db';
import type { SeedCtx } from './ctx';

/**
 * Demo data for the "work" group: projects (with milestones, one internal-only per client), tasks (some overdue, some
 * due soon) with checklists and comments, plus the matching activity / notification rows.
 *
 * Access rules respected on purpose (the API would refuse the same assignments):
 *   sara -> Lumen only        omar -> Ufuq + campaign L3 of Lumen        admin -> everything
 * Positive day offsets are in the PAST, negative ones in the FUTURE (same as ctx.dayOnly / ctx.daysAgo).
 */
export async function seedWork(ctx: SeedCtx): Promise<void> {
  const { admin, sara, omar, lumen, ufuq, campaigns, daysAgo, dayOnly } = ctx;
  const { L1, L2, L3, U1, U2, U3 } = campaigns;

  // ───────────────────────── projects + milestones ─────────────────────────
  interface MsSeed { title: string; description?: string; due?: number; done?: number } // done = days ago it was completed
  async function project(o: {
    clientId: string; name: string; description: string; status: ProjectStatus; priority: Priority; start: number; due: number; manager: string; budget: number;
    visible?: boolean; createdAgo: number; completedAgo?: number; milestones: MsSeed[];
  }) {
    const p = await prisma.project.create({
      data: {
        clientId: o.clientId, name: o.name, description: o.description, status: o.status, priority: o.priority, startDate: dayOnly(o.start), dueDate: dayOnly(o.due),
        completedAt: o.completedAgo !== undefined ? daysAgo(o.completedAgo) : null, projectManagerId: o.manager, budget: o.budget, visibleToClient: o.visible ?? true,
        createdById: admin.id, createdAt: daysAgo(o.createdAgo),
      },
    });
    for (const [position, m] of o.milestones.entries()) {
      await prisma.milestone.create({
        data: {
          projectId: p.id, title: m.title, description: m.description ?? null, dueDate: m.due !== undefined ? dayOnly(m.due) : null, position,
          completedAt: m.done !== undefined ? daysAgo(m.done) : null, createdAt: daysAgo(o.createdAgo),
        },
      });
    }
    // activity feed: creation is internal, status and finished milestones are shared with the client (visible projects only)
    const at = (action: string, entityId: string, meta: object, ago: number, clientVisible: boolean, entity = 'project') =>
      prisma.auditLog.create({ data: { userId: o.manager, action, entity, entityId, metadata: JSON.stringify(meta), clientId: o.clientId, projectId: p.id, clientVisible: clientVisible && (o.visible ?? true), createdAt: daysAgo(ago) } });
    await at('PROJECT_CREATED', p.id, { name: p.name, status: 'PLANNING' }, o.createdAgo, false);
    if (o.status !== 'PLANNING') await at('PROJECT_STATUS_CHANGED', p.id, { name: p.name, from: 'PLANNING', to: o.status }, Math.max(1, o.createdAgo - 7), true);
    const stored = await prisma.milestone.findMany({ where: { projectId: p.id, completedAt: { not: null } } });
    for (const m of stored) await at('MILESTONE_UPDATED', m.id, { title: m.title, completed: true, project: p.name }, Math.max(0.5, (Date.now() - m.completedAt!.getTime()) / 86_400_000), true, 'milestone');
    return p;
  }

  // ── Lumen (English) ──
  const lp1 = await project({
    clientId: lumen.id, name: 'Brand Refresh 2026 (DEMO)', status: 'IN_PROGRESS', priority: 'HIGH', start: 40, due: -25, manager: sara.id, budget: 12000, createdAgo: 40,
    description: 'New visual identity, packaging and social templates for Lumen Coffee Roasters.',
    milestones: [
      { title: 'Discovery & brand audit', due: 25, done: 26 },
      { title: 'Concepts approved by the client', due: 10, done: 9 },
      { title: 'Packaging mockups signed off', due: -6 },
      { title: 'Launch of the refreshed brand', due: -25 },
    ],
  });
  const lp2 = await project({
    clientId: lumen.id, name: 'Website Relaunch (DEMO)', status: 'REVIEW', priority: 'NORMAL', start: 60, due: 3, manager: sara.id, budget: 9500, createdAgo: 60,
    description: 'Rebuild the online shop and wholesale pages. Currently in internal review before it goes to the client.',
    milestones: [
      { title: 'Wireframes signed off', due: 40, done: 41 },
      { title: 'Visual design complete', due: 12, done: 11 },
      { title: 'Content loaded & QA', due: 2 },
      { title: 'Go live', due: -10 },
    ],
  });
  const lp3 = await project({
    clientId: lumen.id, name: 'Q3 Wholesale Launch (DEMO)', status: 'COMPLETED', priority: 'NORMAL', start: 120, due: 50, manager: sara.id, budget: 6000, createdAgo: 120, completedAgo: 48,
    description: 'Landing page, email sequence and Google Ads for the wholesale programme. Delivered and reported.',
    milestones: [
      { title: 'Landing page live', due: 95, done: 96 },
      { title: 'Email sequence approved', due: 80, done: 81 },
      { title: 'Campaign report delivered', due: 50, done: 48 },
    ],
  });
  const lp4 = await project({
    clientId: lumen.id, name: 'Internal: Lumen profitability review (DEMO)', status: 'PLANNING', priority: 'LOW', start: 10, due: -20, manager: admin.id, budget: 1500, visible: false, createdAgo: 10,
    description: 'Agency-internal analysis of hours vs. retainer. Never shown to the client.',
    milestones: [{ title: 'Time and revenue data collected', due: -7 }, { title: 'Repricing proposal ready', due: -20 }],
  });

  // ── Ufuq (Arabic) ──
  const up1 = await project({
    clientId: ufuq.id, name: 'تجديد الهوية البصرية (DEMO)', status: 'IN_PROGRESS', priority: 'HIGH', start: 35, due: -20, manager: omar.id, budget: 15000, createdAgo: 35,
    description: 'تصميم هوية بصرية جديدة لشركة الأفق تشمل الشعار ودليل الاستخدام وقوالب السوشيال ميديا.',
    milestones: [
      { title: 'اعتماد الشعار الجديد', due: 12, done: 13 },
      { title: 'تسليم دليل الهوية', due: -2 },
      { title: 'إطلاق الهوية على القنوات', due: -20 },
    ],
  });
  const up2 = await project({
    clientId: ufuq.id, name: 'إطلاق المتجر الإلكتروني (DEMO)', status: 'PLANNING', priority: 'NORMAL', start: 8, due: -60, manager: omar.id, budget: 22000, createdAgo: 12,
    description: 'تخطيط وتنفيذ المتجر الإلكتروني للمنتجات الجديدة، من جمع المتطلبات حتى الإطلاق.',
    milestones: [{ title: 'جمع المتطلبات', due: -6 }, { title: 'نموذج أولي للتصميم', due: -25 }, { title: 'الإطلاق التجريبي', due: -60 }],
  });
  const up3 = await project({
    clientId: ufuq.id, name: 'مراجعة داخلية لأداء الحملات (DEMO)', status: 'ON_HOLD', priority: 'LOW', start: 20, due: -15, manager: admin.id, budget: 800, visible: false, createdAgo: 20,
    description: 'مراجعة داخلية للوكالة فقط، غير ظاهرة للعميل.',
    milestones: [{ title: 'تجميع بيانات الأداء', due: -3, done: 2 }, { title: 'عرض النتائج على الإدارة', due: -15 }],
  });

  // link the demo campaigns and the deliverables that hang off them to their project
  for (const [campaign, p] of [[L1, lp1], [L3, lp1], [L2, lp3], [U1, up1], [U2, up2], [U3, up1]] as const) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { projectId: p.id } });
    await prisma.deliverable.updateMany({ where: { campaignId: campaign.id, clientId: p.clientId }, data: { projectId: p.id } });
  }

  // ───────────────────────── tasks ─────────────────────────
  // days: positive = ago (overdue when open), negative = in the future, 0 = today
  interface TaskSeed {
    title: string; project?: string; client: string; campaign?: string; assignee: string | null; creator?: string; status: TaskStatus; priority?: Priority;
    due?: number; est?: number; actual?: number; done?: number; createdAgo: number; description?: string;
    checklist?: Array<[string, boolean]>; comments?: Array<[string, string, number]>; // [author id, text, days ago]
  }
  const ids: Record<string, string> = {};
  async function task(key: string, o: TaskSeed) {
    const t = await prisma.task.create({
      data: {
        title: `${o.title} (DEMO)`, description: o.description ?? null, projectId: o.project ?? null, clientId: o.client, campaignId: o.campaign ?? null,
        assignedToId: o.assignee, createdById: o.creator ?? o.assignee ?? admin.id, status: o.status, priority: o.priority ?? 'NORMAL',
        dueDate: o.due !== undefined ? dayOnly(o.due) : null, estimatedHours: o.est ?? null, actualHours: o.actual ?? 0,
        completedAt: o.status === 'DONE' ? daysAgo(o.done ?? 1) : null, createdAt: daysAgo(o.createdAgo),
      },
    });
    ids[key] = t.id;
    for (const [i, [text, done]] of (o.checklist ?? []).entries()) {
      await prisma.taskChecklistItem.create({ data: { taskId: t.id, text, done, position: i, completedAt: done ? daysAgo(Math.max(0.2, o.createdAgo - 2 - i)) : null, createdAt: daysAgo(o.createdAgo) } });
    }
    for (const [userId, comment, ago] of o.comments ?? []) {
      await prisma.taskComment.create({ data: { taskId: t.id, userId, comment, createdAt: daysAgo(ago) } });
    }
    const who = o.creator ?? o.assignee ?? admin.id;
    const meta = (extra: object = {}) => JSON.stringify({ title: t.title, status: o.status, ...extra });
    // task activity is internal: clientVisible stays false, but clientId / projectId let the staff timeline show it
    const log = (userId: string, action: string, ago: number, extra?: object) =>
      prisma.auditLog.create({ data: { userId, action, entity: 'task', entityId: t.id, metadata: meta(extra), clientId: o.client, projectId: o.project ?? null, clientVisible: false, createdAt: daysAgo(ago) } });
    await log(who, 'TASK_CREATED', o.createdAgo);
    if (o.assignee) await log(who, 'TASK_ASSIGNED', o.createdAgo, { assigneeId: o.assignee });
    if (o.status === 'DONE') await log(o.assignee ?? who, 'TASK_COMPLETED', o.done ?? 1);
    return t;
  }

  // Lumen - Brand Refresh
  await task('l1', { title: 'Finalize brand colour palette', project: lp1.id, client: lumen.id, assignee: sara.id, creator: admin.id, status: 'DONE', priority: 'NORMAL', due: 14, est: 4, actual: 4.5, done: 15, createdAgo: 38,
    checklist: [['Test contrast on packaging', true], ['Export swatches', true], ['Share with the client', true]] });
  await task('l2', { title: 'Design new packaging mockups', project: lp1.id, client: lumen.id, campaign: L1.id, assignee: sara.id, creator: admin.id, status: 'IN_PROGRESS', priority: 'HIGH', due: 2, est: 12, actual: 7, createdAgo: 25,
    description: 'Three bag sizes (250g, 500g, 1kg) plus the cold brew bottle label.',
    checklist: [['250g bag', true], ['500g bag', true], ['1kg bag', true], ['Cold brew label', false], ['Prepare print-ready PDFs', false]],
    comments: [[sara.id, 'First two sizes are done, moving on to the bottle label.', 3], [admin.id, 'Great - please keep the green from the palette.', 2.5]] });
  await task('l3', { title: 'Update logo usage guidelines', project: lp1.id, client: lumen.id, assignee: sara.id, creator: sara.id, status: 'TODO', priority: 'NORMAL', due: -2, est: 3, createdAgo: 6 });
  await task('l4', { title: 'Photograph the seasonal blends', project: lp1.id, client: lumen.id, campaign: L1.id, assignee: sara.id, creator: sara.id, status: 'BLOCKED', priority: 'URGENT', due: 1, est: 6, actual: 1.5, createdAgo: 14,
    comments: [[sara.id, 'Blocked: the studio is booked until Sunday, waiting for the props from the client.', 2], [admin.id, 'I will call Nadia about the props today.', 1.5]] });
  await task('l5', { title: 'Refresh Instagram highlight covers', project: lp1.id, client: lumen.id, assignee: sara.id, creator: sara.id, status: 'REVIEW', priority: 'LOW', due: -1, est: 2, actual: 2, createdAgo: 9 });
  await task('l6', { title: 'Prepare the brand presentation for Nadia', project: lp1.id, client: lumen.id, assignee: admin.id, creator: admin.id, status: 'TODO', priority: 'HIGH', due: -5, est: 3, createdAgo: 7 });
  await task('l7', { title: 'Approve the print budget with the supplier', project: lp1.id, client: lumen.id, assignee: admin.id, creator: sara.id, status: 'TODO', priority: 'URGENT', due: 4, est: 1, createdAgo: 8 });
  // Lumen - Website
  await task('l8', { title: 'Homepage wireframes', project: lp2.id, client: lumen.id, assignee: sara.id, creator: admin.id, status: 'DONE', priority: 'NORMAL', due: 42, est: 6, actual: 7, done: 43, createdAgo: 58 });
  await task('l9', { title: 'Write product page copy', project: lp2.id, client: lumen.id, assignee: sara.id, creator: sara.id, status: 'IN_PROGRESS', priority: 'NORMAL', due: -4, est: 8, actual: 3, createdAgo: 16,
    checklist: [['Whole beans', true], ['Ground coffee', true], ['Cold brew', false], ['Gift boxes', false]],
    comments: [[sara.id, 'Two of four categories are written. Sending the rest for review on Thursday.', 1]] });
  await task('l10', { title: 'SEO audit of the current site', project: lp2.id, client: lumen.id, assignee: sara.id, creator: sara.id, status: 'DONE', priority: 'LOW', due: 30, est: 4, actual: 3.5, done: 31, createdAgo: 45 });
  await task('l11', { title: 'QA the responsive layouts', project: lp2.id, client: lumen.id, assignee: sara.id, creator: admin.id, status: 'TODO', priority: 'HIGH', due: -3, est: 5, createdAgo: 10 });
  await task('l12', { title: 'Set up analytics events', project: lp2.id, client: lumen.id, assignee: admin.id, creator: sara.id, status: 'TODO', priority: 'LOW', due: -6, est: 2, createdAgo: 10 });
  // Lumen - Wholesale launch (finished)
  await task('l13', { title: 'Launch email sequence', project: lp3.id, client: lumen.id, campaign: L2.id, assignee: sara.id, creator: sara.id, status: 'DONE', priority: 'NORMAL', due: 84, est: 6, actual: 6, done: 85, createdAgo: 110 });
  await task('l14', { title: 'Wholesale landing page', project: lp3.id, client: lumen.id, assignee: sara.id, creator: admin.id, status: 'DONE', priority: 'HIGH', due: 97, est: 10, actual: 11, done: 98, createdAgo: 118 });
  await task('l15', { title: 'Post-launch report', project: lp3.id, client: lumen.id, assignee: admin.id, creator: admin.id, status: 'DONE', priority: 'NORMAL', due: 49, est: 2, actual: 2, done: 49, createdAgo: 60 });
  // Lumen - internal review
  await task('l16', { title: 'Pull 6 months of hours and revenue', project: lp4.id, client: lumen.id, assignee: admin.id, creator: admin.id, status: 'TODO', priority: 'NORMAL', due: -7, est: 5, createdAgo: 9 });
  await task('l17', { title: 'Draft the repricing proposal', project: lp4.id, client: lumen.id, assignee: admin.id, creator: admin.id, status: 'TODO', priority: 'LOW', est: 6, createdAgo: 9 });
  // Lumen - no project
  await task('l18', { title: 'Order a new tripod for shoots', client: lumen.id, assignee: sara.id, creator: sara.id, status: 'TODO', priority: 'LOW', due: -12, est: 1, createdAgo: 2 });
  // Omar helps on ONE Lumen campaign (L3) - the only Lumen task he may be given
  await task('l19', { title: 'TikTok trend research for the brand launch', project: lp1.id, client: lumen.id, campaign: L3.id, assignee: omar.id, creator: admin.id, status: 'IN_PROGRESS', priority: 'NORMAL', due: -2, est: 3, actual: 1, createdAgo: 5,
    comments: [[omar.id, 'Collected 12 reference videos, sharing the board tomorrow.', 1]] });

  // Ufuq (Arabic)
  await task('u1', { title: 'تصميم الشعار الجديد', project: up1.id, client: ufuq.id, assignee: omar.id, creator: admin.id, status: 'DONE', priority: 'HIGH', due: 14, est: 12, actual: 13, done: 13, createdAgo: 33 });
  await task('u2', { title: 'إعداد دليل الهوية البصرية', project: up1.id, client: ufuq.id, assignee: omar.id, creator: omar.id, status: 'IN_PROGRESS', priority: 'HIGH', due: 1, est: 10, actual: 6, createdAgo: 18,
    checklist: [['نظام الألوان', true], ['الخطوط', true], ['استخدامات الشعار', false], ['نماذج التطبيق', false]],
    comments: [[omar.id, 'أنجزت الألوان والخطوط، وأعمل الآن على استخدامات الشعار.', 2], [admin.id, 'ممتاز، أرجو إرساله للمراجعة قبل نهاية الأسبوع.', 1.5]] });
  await task('u3', { title: 'تجهيز قوالب السوشيال ميديا', project: up1.id, client: ufuq.id, assignee: omar.id, creator: omar.id, status: 'TODO', priority: 'NORMAL', due: 2, est: 8, createdAgo: 8 });
  await task('u4', { title: 'مراجعة الهوية مع العميل', project: up1.id, client: ufuq.id, assignee: omar.id, creator: admin.id, status: 'REVIEW', priority: 'HIGH', due: 0, est: 2, actual: 1, createdAgo: 4,
    comments: [[admin.id, 'الاجتماع مع منى اليوم الساعة ٣، جهّز العرض من فضلك.', 0.5]] });
  await task('u5', { title: 'مراجعة الميزانية الشهرية', project: up1.id, client: ufuq.id, assignee: admin.id, creator: admin.id, status: 'TODO', priority: 'NORMAL', due: -1, est: 1, createdAgo: 3 });
  await task('u6', { title: 'جمع متطلبات المتجر الإلكتروني', project: up2.id, client: ufuq.id, assignee: omar.id, creator: omar.id, status: 'IN_PROGRESS', priority: 'NORMAL', due: -6, est: 6, actual: 2.5, createdAgo: 11,
    checklist: [['قائمة المنتجات', true], ['طرق الدفع والشحن', false], ['متطلبات اللغة والعملات', false]] });
  await task('u7', { title: 'اختيار منصة التجارة الإلكترونية', project: up2.id, client: ufuq.id, assignee: admin.id, creator: omar.id, status: 'TODO', priority: 'LOW', due: -10, est: 4, createdAgo: 9 });
  await task('u8', { title: 'تحليل أداء الحملات السابقة', project: up3.id, client: ufuq.id, assignee: admin.id, creator: admin.id, status: 'BLOCKED', priority: 'NORMAL', due: 3, est: 5, actual: 1, createdAgo: 18,
    comments: [[admin.id, 'متوقف: بانتظار تصدير البيانات من حساب الإعلانات.', 2]] });
  await task('u9', { title: 'تحسين الكلمات المفتاحية لحملة البحث', client: ufuq.id, campaign: U2.id, assignee: omar.id, creator: omar.id, status: 'TODO', priority: 'HIGH', due: 0, est: 3, createdAgo: 3 });

  // ───────────────────────── notifications for the staff ─────────────────────────
  const n = (userId: string, type: string, taskKey: string, title: string, by: string, ago: number, read = false) =>
    prisma.notification.create({ data: { userId, type, entity: 'task', entityId: ids[taskKey], data: JSON.stringify({ title: `${title} (DEMO)`, by }), createdAt: daysAgo(ago), readAt: read ? daysAgo(ago - 0.1) : null } });
  await n(sara.id, 'TASK_ASSIGNED', 'l2', 'Design new packaging mockups', admin.name, 25, true);
  await n(sara.id, 'TASK_COMMENT', 'l4', 'Photograph the seasonal blends', admin.name, 1.5);
  await n(sara.id, 'TASK_ASSIGNED', 'l11', 'QA the responsive layouts', admin.name, 10);
  await n(omar.id, 'TASK_ASSIGNED', 'l19', 'TikTok trend research for the brand launch', admin.name, 5, true);
  await n(omar.id, 'TASK_ASSIGNED', 'u4', 'مراجعة الهوية مع العميل', admin.name, 4);
  await n(omar.id, 'TASK_COMMENT', 'u2', 'إعداد دليل الهوية البصرية', admin.name, 1.5);
  await n(admin.id, 'TASK_ASSIGNED', 'l7', 'Approve the print budget with the supplier', sara.name, 8);
  await n(admin.id, 'TASK_ASSIGNED', 'u7', 'اختيار منصة التجارة الإلكترونية', omar.name, 9, true);
}
