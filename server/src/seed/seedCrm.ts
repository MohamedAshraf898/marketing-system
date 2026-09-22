import { prisma } from '../db';
import { DEFAULT_ONBOARDING_TITLES, statusFromCounts } from '../services/onboarding';
import type { SeedCtx } from './ctx';

/** Demo data for the "crm" group. Called from seed.ts; must tolerate rows of other groups missing (query, don't assume). */
export async function seedCrm(ctx: SeedCtx): Promise<void> {
  const { admin, sara, omar, lumen, ufuq, daysAgo, dayOnly } = ctx;

  // ── CRM profile of the two demo clients ──
  await prisma.client.update({
    where: { id: lumen.id },
    data: {
      industry: 'Food & Beverage', website: 'https://lumen-demo.example', address: '12 Roastery Lane', city: 'Cairo', country: 'Egypt',
      leadSource: 'Referral (DEMO)', accountManagerId: sara.id, clientType: 'BUSINESS', tags: JSON.stringify(['coffee', 'e-commerce', 'retainer']),
      notes: 'Welcome! Your account manager is Sara. Send new product photos through the Files tab. (DEMO)',
      clientSince: dayOnly(210), contractStart: dayOnly(120), contractEnd: dayOnly(-245), monthlyRetainer: 2500,
      internalNotes: 'DEMO: Nadia decides fast but changes copy late. Always send drafts with two options. Pays on the 5th.',
    },
  });
  await prisma.client.update({
    where: { id: ufuq.id },
    data: {
      industry: 'Real Estate', website: 'https://ufuq-demo.example', address: 'شارع التحرير، الدقي', city: 'الجيزة', country: 'مصر',
      leadSource: 'Instagram (DEMO)', accountManagerId: omar.id, clientType: 'ENTERPRISE', tags: JSON.stringify(['عقارات', 'رمضان', 'VIP']),
      notes: 'أهلاً بكم! سنرسل لكم المواد للمراجعة عبر تبويب المخرجات. (DEMO)',
      clientSince: dayOnly(420), contractStart: dayOnly(60), contractEnd: dayOnly(-20), monthlyRetainer: 4800,
      internalNotes: 'DEMO: العقد ينتهي قريباً - تذكير بالتجديد. الاعتماد يمر عبر منى ثم الإدارة.',
    },
  });

  // ── contacts (2-3 each: one primary, one hidden from the client) ──
  await prisma.clientContact.createMany({
    data: [
      { clientId: lumen.id, name: 'Nadia Farouk (DEMO)', jobTitle: 'Owner', email: 'nadia@lumen-demo.local', phone: '+20 100 000 0001', whatsapp: '+20 100 000 0001', isPrimary: true, visibleToClient: true, notes: 'Prefers WhatsApp voice notes in the morning.' },
      { clientId: lumen.id, name: 'Karim Adel (DEMO)', jobTitle: 'Marketing Manager', email: 'karim@lumen-demo.local', phone: '+20 100 000 0011', isPrimary: false, visibleToClient: true },
      { clientId: lumen.id, name: 'Layla Samir (DEMO)', jobTitle: 'Accountant', email: 'accounts@lumen-demo.local', isPrimary: false, visibleToClient: false, notes: 'Internal: handles invoices only. Do not include in creative threads.' },
      { clientId: ufuq.id, name: 'منى السيد (DEMO)', jobTitle: 'مدير التسويق', email: 'mona@ufuq-demo.local', phone: '+20 100 000 0002', whatsapp: '+20 100 000 0002', isPrimary: true, visibleToClient: true, notes: 'تفضل الاتصال بعد الساعة الثانية ظهراً.' },
      { clientId: ufuq.id, name: 'خالد رشدي (DEMO)', jobTitle: 'المدير التنفيذي', email: 'khaled@ufuq-demo.local', phone: '+20 100 000 0022', isPrimary: false, visibleToClient: true },
      { clientId: ufuq.id, name: 'هالة نبيل (DEMO)', jobTitle: 'المحاسبة', email: 'finance@ufuq-demo.local', isPrimary: false, visibleToClient: false, notes: 'داخلي: للفواتير والمدفوعات فقط.' },
    ],
  });

  // ── onboarding: Lumen partially done, Al-Ufuq completed ──
  const titles = [...DEFAULT_ONBOARDING_TITLES];
  const lumenDone = 5;
  const lumenItems = titles.map((title, position) => ({
    clientId: lumen.id, title, position,
    done: position < lumenDone,
    completedAt: position < lumenDone ? daysAgo(30 - position * 4) : null,
    completedById: position < lumenDone ? (position % 2 === 0 ? sara.id : admin.id) : null,
    assignedToId: position === 5 || position === 6 ? sara.id : position === 7 ? admin.id : null,
    dueDate: position === 5 ? dayOnly(-3) : position === 6 ? dayOnly(-10) : position === 7 ? dayOnly(2) : null,
    notes: position === 4 ? 'DEMO: waiting for the Instagram business login.' : null,
  }));
  await prisma.onboardingItem.createMany({ data: lumenItems });
  await prisma.onboardingItem.createMany({
    data: titles.map((title, position) => ({
      clientId: ufuq.id, title, position, done: true, completedAt: daysAgo(400 - position * 6), completedById: position % 2 === 0 ? omar.id : admin.id, assignedToId: omar.id,
    })),
  });
  await prisma.client.update({ where: { id: lumen.id }, data: { onboardingStatus: statusFromCounts(titles.length, lumenDone) } });
  await prisma.client.update({ where: { id: ufuq.id }, data: { onboardingStatus: statusFromCounts(titles.length, titles.length) } });

  // ── internal notes (one pinned per client) ──
  await prisma.internalNote.createMany({
    data: [
      { clientId: lumen.id, authorId: admin.id, pinned: true, body: 'DEMO - Renewal in ~8 months. Aim to upsell a TikTok package once the Meta campaign proves ROAS above 3x.', createdAt: daysAgo(14), updatedAt: daysAgo(14) },
      { clientId: lumen.id, authorId: sara.id, pinned: false, body: 'DEMO - Nadia approved the new logo lockup verbally on the call. Get it in writing before the next print run.', createdAt: daysAgo(6), updatedAt: daysAgo(6) },
      { clientId: lumen.id, authorId: sara.id, pinned: false, body: 'DEMO - Budget conversation: they can stretch to +15% during the summer season only.', createdAt: daysAgo(2), updatedAt: daysAgo(2) },
      { clientId: ufuq.id, authorId: admin.id, pinned: true, body: 'DEMO - العقد ينتهي خلال أسابيع. الاجتماع القادم لمناقشة التجديد مع الأستاذ خالد.', createdAt: daysAgo(10), updatedAt: daysAgo(10) },
      { clientId: ufuq.id, authorId: omar.id, pinned: false, body: 'DEMO - الحملة الرمضانية: العميل يفضل الألوان الدافئة والخط العربي الكلاسيكي.', createdAt: daysAgo(4), updatedAt: daysAgo(4) },
    ],
  });

  // ── activity timeline: attach the phase-1 demo audit rows to their clients so the Activity tab is not empty ──
  const visible = ['DELIVERABLE_SUBMITTED', 'DELIVERABLE_APPROVED', 'CHANGES_REQUESTED', 'REQUEST_CREATED', 'REQUEST_STATUS_CHANGED', 'CAMPAIGN_CREATED', 'COMMENT_CREATED'];
  for (const [entity, rows] of [
    ['deliverable', await prisma.deliverable.findMany({ select: { id: true, clientId: true } })],
    ['request', await prisma.request.findMany({ select: { id: true, clientId: true } })],
    ['campaign', await prisma.campaign.findMany({ select: { id: true, clientId: true } })],
  ] as const) {
    for (const clientId of new Set(rows.map((r) => r.clientId))) {
      const entityIds = rows.filter((r) => r.clientId === clientId).map((r) => r.id);
      await prisma.auditLog.updateMany({ where: { entity, entityId: { in: entityIds }, clientId: null }, data: { clientId } });
      await prisma.auditLog.updateMany({ where: { entity, entityId: { in: entityIds }, clientId, action: { in: visible } }, data: { clientVisible: true } });
    }
  }
  // the CRM's own history (internal: not client visible)
  await prisma.auditLog.createMany({
    data: [
      { userId: admin.id, action: 'CLIENT_CREATED', entity: 'client', entityId: lumen.id, metadata: JSON.stringify({ companyName: lumen.companyName }), clientId: lumen.id, createdAt: daysAgo(210) },
      { userId: admin.id, action: 'CLIENT_CREATED', entity: 'client', entityId: ufuq.id, metadata: JSON.stringify({ companyName: ufuq.companyName }), clientId: ufuq.id, createdAt: daysAgo(420) },
      { userId: sara.id, action: 'ONBOARDING_STARTED', entity: 'onboarding_item', metadata: JSON.stringify({ items: titles.length }), clientId: lumen.id, createdAt: daysAgo(34) },
      { userId: omar.id, action: 'CONTACT_CREATED', entity: 'contact', metadata: JSON.stringify({ name: 'خالد رشدي (DEMO)' }), clientId: ufuq.id, createdAt: daysAgo(90) },
    ],
  });
}
