/**
 * Development seed:  npm run seed            (fresh database)
 *                    npm run seed -- --reset (wipe EVERYTHING, then reload the demo data)
 *
 * Everything created here is clearly fake: names carry "(DEMO)", e-mails end in @demo.local, and every
 * report row is labelled "DEMO DATA". Real advertising numbers must come from your real campaigns.
 */
import crypto from 'node:crypto';
import { config } from '../config';
import { hashPassword, passwordProblem } from '../auth/password';
import { prisma } from '../db';
import { storage } from '../storage';
import { makeDemoImage } from './png';

const DAY = 86_400_000;
const daysAgo = (n: number, hour = 10) => new Date(Date.now() - n * DAY + (hour - 12) * 3_600_000);
const dayOnly = (n: number) => {
  const d = new Date(Date.now() - n * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// deterministic pseudo-random numbers so the demo looks the same on every machine
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function wipe() {
  const files = await prisma.file.findMany({ select: { filePath: true } });
  await Promise.all(files.map((f) => storage.delete(f.filePath).catch(() => undefined)));
  // children first
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.auditLog.deleteMany(), prisma.comment.deleteMany(), prisma.file.deleteMany(),
    prisma.approval.deleteMany(), prisma.report.deleteMany(), prisma.request.deleteMany(), prisma.deliverable.deleteMany(),
    prisma.campaignAssignment.deleteMany(), prisma.clientAssignment.deleteMany(), prisma.session.deleteMany(),
    prisma.campaign.deleteMany(), prisma.user.deleteMany(), prisma.client.deleteMany(),
  ]);
}

async function main() {
  if (config.isProd) throw new Error('Refusing to load demo data in production. Use "npm run seed:admin" to create the first admin.');

  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? '';
  if (!adminEmail || !adminPassword || !demoPassword) {
    throw new Error('Missing SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD. Copy .env.example to .env (or run "npm run setup").');
  }
  for (const [label, pw] of [['SEED_ADMIN_PASSWORD', adminPassword], ['SEED_DEMO_PASSWORD', demoPassword]] as const) {
    const p = passwordProblem(pw);
    if (p) throw new Error(`${label} is not strong enough (${p}). Use 8+ characters with letters and numbers.`);
  }

  if ((await prisma.user.count()) > 0) {
    if (!process.argv.includes('--reset')) {
      throw new Error('The database already contains data. Run "npm run seed -- --reset" to WIPE it and reload the demo data.');
    }
    console.log('Resetting database...');
    await wipe();
  }

  const [adminHash, demoHash] = await Promise.all([hashPassword(adminPassword), hashPassword(demoPassword)]);

  // ── people ──
  const admin = await prisma.user.create({ data: { name: process.env.SEED_ADMIN_NAME?.trim() || 'OG Admin', email: adminEmail, role: 'ADMIN', passwordHash: adminHash } });
  const sara = await prisma.user.create({ data: { name: 'Sara Hassan (DEMO)', email: 'sara@demo.local', role: 'TEAM', passwordHash: demoHash } });
  const omar = await prisma.user.create({ data: { name: 'عمر خالد (DEMO)', email: 'omar@demo.local', role: 'TEAM', passwordHash: demoHash, locale: 'ar' } });

  const lumen = await prisma.client.create({ data: { name: 'Nadia Farouk', companyName: 'Lumen Coffee Roasters (DEMO)', email: 'hello@lumen-demo.local', phone: '+20 100 000 0001' } });
  const ufuq = await prisma.client.create({ data: { name: 'منى السيد', companyName: 'شركة الأفق التجريبية (DEMO)', email: 'info@ufuq-demo.local', phone: '+20 100 000 0002' } });
  const lumenUser = await prisma.user.create({ data: { name: 'Nadia Farouk (DEMO)', email: 'lumen@demo.local', role: 'CLIENT', clientId: lumen.id, passwordHash: demoHash } });
  const ufuqUser = await prisma.user.create({ data: { name: 'منى السيد (DEMO)', email: 'ufuq@demo.local', role: 'CLIENT', clientId: ufuq.id, passwordHash: demoHash, locale: 'ar' } });

  // ── campaigns ──
  const mk = (data: Parameters<typeof prisma.campaign.create>[0]['data']) => prisma.campaign.create({ data });
  const L1 = await mk({ name: 'Spring Sale — Meta Ads', clientId: lumen.id, platform: 'META', objective: 'SALES', status: 'RUNNING', startDate: dayOnly(40), endDate: dayOnly(-20), budget: 6000, description: 'Seasonal promotion for whole-bean subscriptions.', campaignExternalId: 'demo-meta-0001' });
  const L2 = await mk({ name: 'Google Search — Wholesale Leads', clientId: lumen.id, platform: 'GOOGLE', objective: 'LEADS', status: 'RUNNING', startDate: dayOnly(35), endDate: dayOnly(-30), budget: 5000, description: 'Capture café owners looking for a wholesale roaster.' });
  const L3 = await mk({ name: 'TikTok Brand Awareness', clientId: lumen.id, platform: 'TIKTOK', objective: 'AWARENESS', status: 'PLANNING', startDate: dayOnly(-10), endDate: dayOnly(-60), budget: 3000, description: 'Short-form video launch. Waiting for creative approval.' });
  const U1 = await mk({ name: 'حملة رمضان — سناب شات', clientId: ufuq.id, platform: 'SNAPCHAT', objective: 'ENGAGEMENT', status: 'RUNNING', startDate: dayOnly(30), endDate: dayOnly(-15), budget: 5000, description: 'حملة موسمية لزيادة التفاعل خلال شهر رمضان.' });
  const U2 = await mk({ name: 'بحث جوجل — عملاء محتملون', clientId: ufuq.id, platform: 'GOOGLE', objective: 'LEADS', status: 'PAUSED', startDate: dayOnly(45), endDate: dayOnly(-5), budget: 3500, description: 'متوقفة مؤقتاً لحين مراجعة الكلمات المفتاحية.' });
  const U3 = await mk({ name: 'Product Launch — Meta', clientId: ufuq.id, platform: 'META', objective: 'SALES', status: 'COMPLETED', startDate: dayOnly(95), endDate: dayOnly(60), budget: 7000, description: 'Completed launch campaign for the new product line.' });

  await prisma.clientAssignment.createMany({ data: [{ userId: sara.id, clientId: lumen.id }, { userId: omar.id, clientId: ufuq.id }] });
  // Omar also helps on ONE Lumen campaign, without seeing the rest of Lumen's work
  await prisma.campaignAssignment.create({ data: { userId: omar.id, campaignId: L3.id } });

  // ── daily reports (labelled DEMO DATA) ──
  async function reports(campaignId: string, clientId: string, from: number, days: number, o: { imp: number; ctr: number; cpc: number; cvr: number; aov: number; seed: number }) {
    const rnd = prng(o.seed);
    const rows = [];
    let total = 0;
    for (let i = 0; i < days; i++) {
      const wave = 0.85 + 0.3 * Math.sin(i / 4) * 0.5 + rnd() * 0.3;
      const impressions = Math.round(o.imp * wave);
      const clicks = Math.max(1, Math.round(impressions * o.ctr * (0.85 + rnd() * 0.3)));
      const spend = Math.round(clicks * o.cpc * (0.9 + rnd() * 0.2) * 100) / 100;
      const conversions = Math.round(clicks * o.cvr * (0.8 + rnd() * 0.4));
      const conversionValue = Math.round(conversions * o.aov * (0.9 + rnd() * 0.2) * 100) / 100;
      const reach = Math.round(impressions * (0.62 + rnd() * 0.12));
      total += spend;
      rows.push({
        clientId, campaignId, date: dayOnly(from + i), spend, reach, impressions, clicks, conversions, conversionValue,
        ctr: Math.round((clicks / impressions) * 1e6) / 1e4,
        cpc: Math.round((spend / clicks) * 1e4) / 1e4,
        cpm: Math.round((spend / impressions) * 1e7) / 1e4,
        roas: spend > 0 ? Math.round((conversionValue / spend) * 1e4) / 1e4 : 0,
        notes: 'DEMO DATA',
      });
    }
    await prisma.report.createMany({ data: rows });
    await prisma.campaign.update({ where: { id: campaignId }, data: { spent: Math.round(total * 100) / 100 } });
  }
  await reports(L1.id, lumen.id, 1, 30, { imp: 16000, ctr: 0.021, cpc: 0.48, cvr: 0.045, aov: 38, seed: 11 });
  await reports(L2.id, lumen.id, 1, 26, { imp: 2500, ctr: 0.043, cpc: 1.35, cvr: 0.08, aov: 120, seed: 22 });
  await reports(U1.id, ufuq.id, 1, 24, { imp: 68000, ctr: 0.013, cpc: 0.19, cvr: 0.02, aov: 26, seed: 33 });
  await reports(U2.id, ufuq.id, 28, 14, { imp: 3000, ctr: 0.05, cpc: 1.1, cvr: 0.07, aov: 90, seed: 44 });
  await reports(U3.id, ufuq.id, 60, 30, { imp: 15000, ctr: 0.024, cpc: 0.55, cvr: 0.05, aov: 44, seed: 55 });

  // ── files (real files written to the upload folder) ──
  type Img = [number, number, number];
  const palette: Array<[Img, Img, Img]> = [
    [[22, 78, 60], [52, 168, 110], [255, 214, 102]],
    [[40, 32, 96], [122, 92, 224], [255, 143, 112]],
    [[120, 40, 30], [236, 132, 72], [255, 236, 179]],
    [[16, 60, 96], [64, 156, 214], [255, 255, 255]],
    [[70, 24, 88], [196, 84, 160], [255, 220, 120]],
    [[30, 30, 34], [96, 104, 120], [120, 220, 190]],
  ];
  let paletteIx = 0;
  async function addFile(o: { name: string; type: string; ext: string; data: Buffer; clientId: string; uploader: string; campaignId?: string; deliverableId?: string; requestId?: string; version?: number; visibleToClient?: boolean; at?: Date }) {
    const key = `${crypto.randomUUID()}${o.ext}`;
    await storage.put(key, o.data, { contentType: o.type });
    return prisma.file.create({
      data: {
        fileName: o.name, filePath: key, fileType: o.type, size: o.data.length, clientId: o.clientId, uploadedById: o.uploader,
        campaignId: o.campaignId ?? null, deliverableId: o.deliverableId ?? null, requestId: o.requestId ?? null,
        version: o.version ?? 1, visibleToClient: o.visibleToClient ?? true, createdAt: o.at ?? new Date(),
      },
    });
  }
  const image = (w = 960, h = 600) => {
    const [a, b, c] = palette[paletteIx++ % palette.length];
    return makeDemoImage(w, h, a, b, c);
  };

  // ── deliverables + append-only approval history ──
  type Step = { kind: 'submit' | 'changes' | 'approve'; daysAgo: number; comment?: string };
  async function deliverable(o: {
    name: string; type: 'DESIGN' | 'VIDEO' | 'REEL' | 'STORY' | 'COPY' | 'BANNER' | 'OTHER'; clientId: string; campaignId: string; team: string; clientUser?: string;
    description: string; status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'CHANGES_REQUESTED' | 'PUBLISHED'; steps: Step[]; images?: number; due?: number; createdAgo: number;
  }) {
    let version = 1;
    let submittedAt: Date | null = null;
    let approvedAt: Date | null = null;
    let clientComment: string | null = null;
    const d = await prisma.deliverable.create({
      data: { name: o.name, type: o.type, clientId: o.clientId, campaignId: o.campaignId, description: o.description, status: 'DRAFT', createdById: o.team, dueDate: o.due !== undefined ? dayOnly(o.due) : null, createdAt: daysAgo(o.createdAgo) },
    });
    // files: one image per version, uploaded before that version was submitted
    const versions = o.steps.filter((s) => s.kind === 'submit').length || 1;
    if (o.images !== 0) {
      for (let v = 1; v <= versions; v++) {
        const submitStep = o.steps.filter((s) => s.kind === 'submit')[v - 1];
        await addFile({ name: `${o.name.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 40).trim()} v${v}.png`, type: 'image/png', ext: '.png', data: image(), clientId: o.clientId, campaignId: o.campaignId, deliverableId: d.id, version: v, uploader: o.team, visibleToClient: !!submitStep, at: daysAgo((submitStep?.daysAgo ?? 0) + 0.3) });
      }
    }
    for (const s of o.steps) {
      if (s.kind === 'submit') {
        submittedAt = daysAgo(s.daysAgo);
        await prisma.approval.create({ data: { deliverableId: d.id, clientId: o.clientId, userId: o.team, decision: 'PENDING', version, submittedAt, createdAt: submittedAt } });
        await prisma.auditLog.create({ data: { userId: o.team, action: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: d.id, metadata: JSON.stringify({ version, name: o.name }), createdAt: submittedAt } });
      } else {
        const decidedAt = daysAgo(s.daysAgo);
        const decision = s.kind === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED';
        await prisma.approval.create({ data: { deliverableId: d.id, clientId: o.clientId, userId: o.clientUser!, decision, comment: s.comment ?? null, version, submittedAt, decidedAt, createdAt: decidedAt } });
        await prisma.auditLog.create({ data: { userId: o.clientUser!, action: s.kind === 'approve' ? 'DELIVERABLE_APPROVED' : 'CHANGES_REQUESTED', entity: 'deliverable', entityId: d.id, metadata: JSON.stringify({ version, name: o.name }), createdAt: decidedAt } });
        if (s.kind === 'approve') { approvedAt = decidedAt; clientComment = s.comment ?? null; }
        else { clientComment = s.comment ?? null; version += 1; }
      }
    }
    // after "changes requested" the team starts the next version only if the steps continue; otherwise it stays CHANGES_REQUESTED
    const last = o.steps[o.steps.length - 1];
    const finalVersion = last?.kind === 'changes' ? version - 1 : version;
    await prisma.deliverable.update({
      where: { id: d.id },
      data: { status: o.status, version: finalVersion, submittedAt, approvedAt, clientComment: o.status === 'PENDING_APPROVAL' ? null : clientComment },
    });
    return d;
  }

  const d1 = await deliverable({ name: 'Spring Sale — Hero Banner', type: 'BANNER', clientId: lumen.id, campaignId: L1.id, team: sara.id, clientUser: lumenUser.id, status: 'APPROVED', createdAgo: 16, due: 9,
    description: 'Main 1080×1080 banner for the Spring Sale, featuring the new seasonal blend.',
    steps: [{ kind: 'submit', daysAgo: 14 }, { kind: 'changes', daysAgo: 13, comment: 'Please make the discount badge larger and use our brand green.' }, { kind: 'submit', daysAgo: 11 }, { kind: 'approve', daysAgo: 10, comment: 'Love it — approved!' }] });
  const d2 = await deliverable({ name: 'Cold Brew — Product Reel', type: 'REEL', clientId: lumen.id, campaignId: L1.id, team: sara.id, clientUser: lumenUser.id, status: 'PENDING_APPROVAL', createdAgo: 4, due: -2,
    description: '15-second vertical reel showing the cold brew pour. Music: royalty-free track (licence attached).', steps: [{ kind: 'submit', daysAgo: 1 }] });
  const d3 = await deliverable({ name: 'Weekend Offer — Story Set', type: 'STORY', clientId: lumen.id, campaignId: L1.id, team: sara.id, clientUser: lumenUser.id, status: 'CHANGES_REQUESTED', createdAgo: 7,
    description: 'Three-frame Instagram story set for the weekend offer.',
    steps: [{ kind: 'submit', daysAgo: 4 }, { kind: 'changes', daysAgo: 3, comment: 'Swap the second frame photo — the text is hard to read on mobile.' }] });
  const d4 = await deliverable({ name: 'Google Ads — Headline & Description Copy', type: 'COPY', clientId: lumen.id, campaignId: L2.id, team: sara.id, clientUser: lumenUser.id, status: 'DRAFT', createdAgo: 2, images: 0,
    description: 'Headline 1: Freshly Roasted for Your Café\nHeadline 2: Wholesale Beans, Delivered Weekly\nDescription: Request a free tasting box and see the difference.', steps: [] });
  const d5 = await deliverable({ name: 'Brand Launch Video', type: 'VIDEO', clientId: lumen.id, campaignId: L3.id, team: sara.id, clientUser: lumenUser.id, status: 'PUBLISHED', createdAgo: 33,
    description: '30-second brand film. Final export is approved and live.', steps: [{ kind: 'submit', daysAgo: 30 }, { kind: 'approve', daysAgo: 28, comment: 'Great work team.' }] });

  const d6 = await deliverable({ name: 'قصص رمضان — Ramadan Story Pack', type: 'STORY', clientId: ufuq.id, campaignId: U1.id, team: omar.id, clientUser: ufuqUser.id, status: 'PENDING_APPROVAL', createdAgo: 3, due: -3,
    description: 'حزمة من ٥ قصص سناب شات لحملة رمضان.', steps: [{ kind: 'submit', daysAgo: 1 }] });
  const d7 = await deliverable({ name: 'فيديو العرض الترويجي', type: 'VIDEO', clientId: ufuq.id, campaignId: U1.id, team: omar.id, clientUser: ufuqUser.id, status: 'APPROVED', createdAgo: 22, due: 5,
    description: 'فيديو ترويجي مدته ٢٠ ثانية للعرض الرئيسي.',
    steps: [
      { kind: 'submit', daysAgo: 20 }, { kind: 'changes', daysAgo: 19, comment: 'المطلوب تقصير المقدمة وإضافة الشعار في النهاية.' },
      { kind: 'submit', daysAgo: 15 }, { kind: 'changes', daysAgo: 14, comment: 'الألوان داكنة قليلاً، من فضلكم تفتيحها.' },
      { kind: 'submit', daysAgo: 9 }, { kind: 'approve', daysAgo: 8, comment: 'ممتاز، تمت الموافقة.' },
    ] });
  const d8 = await deliverable({ name: 'نصوص إعلانية — بحث جوجل', type: 'COPY', clientId: ufuq.id, campaignId: U2.id, team: omar.id, clientUser: ufuqUser.id, status: 'CHANGES_REQUESTED', createdAgo: 10, images: 0,
    description: 'العنوان ١: حلول متكاملة لعملك\nالوصف: تواصل معنا اليوم للحصول على استشارة مجانية.',
    steps: [{ kind: 'submit', daysAgo: 6 }, { kind: 'changes', daysAgo: 5, comment: 'يرجى إضافة رقم الهاتف في الوصف.' }] });
  const d9 = await deliverable({ name: 'Product Launch — Main Banner', type: 'BANNER', clientId: ufuq.id, campaignId: U3.id, team: omar.id, clientUser: ufuqUser.id, status: 'PUBLISHED', createdAgo: 100,
    description: 'Launch banner used across Meta placements.', steps: [{ kind: 'submit', daysAgo: 96 }, { kind: 'approve', daysAgo: 95 }] });

  // ── comments ──
  const comment = (deliverableId: string, clientId: string, userId: string, authorType: 'CLIENT' | 'TEAM', text: string, ago: number) =>
    prisma.comment.create({ data: { deliverableId, clientId, userId, authorType, comment: text, createdAt: daysAgo(ago) } });
  await comment(d1.id, lumen.id, sara.id, 'TEAM', 'Here is the first round. The green matches the brand book (#2E7D5B).', 14);
  await comment(d1.id, lumen.id, lumenUser.id, 'CLIENT', 'Thanks Sara — see my requested changes.', 13);
  await comment(d1.id, lumen.id, sara.id, 'TEAM', 'Updated: bigger badge + brand green. Please have another look.', 11);
  await comment(d2.id, lumen.id, sara.id, 'TEAM', 'Sound design is included. Let me know if you would like a slower pour.', 1);
  await comment(d2.id, lumen.id, lumenUser.id, 'CLIENT', 'Looks promising! Reviewing with the team this afternoon.', 0.5);
  await comment(d3.id, lumen.id, lumenUser.id, 'CLIENT', 'Frame 2 is the one I am worried about.', 3);
  await comment(d3.id, lumen.id, sara.id, 'TEAM', 'Understood — I will start version 2 tomorrow.', 2.5);
  await comment(d6.id, ufuq.id, omar.id, 'TEAM', 'تم رفع الحزمة كاملة، بانتظار ملاحظاتكم.', 1);
  await comment(d7.id, ufuq.id, ufuqUser.id, 'CLIENT', 'شكراً على السرعة في التعديلات.', 8);
  await comment(d8.id, ufuq.id, ufuqUser.id, 'CLIENT', 'أضيفوا أيضاً كلمة "مجاناً" في العنوان.', 5);

  // ── requests ──
  const mkReq = (data: Parameters<typeof prisma.request.create>[0]['data']) => prisma.request.create({ data });
  const r1 = await mkReq({ title: 'Add an Arabic version of the hero banner', clientId: lumen.id, userId: lumenUser.id, campaignId: L1.id, type: 'DESIGN', description: 'We are opening a Cairo branch and would like an Arabic (RTL) variant of the Spring Sale hero banner.', priority: 'HIGH', status: 'IN_PROGRESS', assignedToId: sara.id, dueDate: dayOnly(-5), createdAt: daysAgo(6) });
  const r2 = await mkReq({ title: 'Monthly report walkthrough call', clientId: lumen.id, userId: lumenUser.id, type: 'OTHER', description: 'Could we schedule a 30-minute call to go through last month results?', priority: 'NORMAL', status: 'NEW', createdAt: daysAgo(1) });
  const r3 = await mkReq({ title: 'New TikTok video idea', clientId: lumen.id, userId: lumenUser.id, campaignId: L3.id, type: 'VIDEO', description: 'Idea: a behind-the-scenes roasting video. Do you need anything from us?', priority: 'LOW', status: 'WAITING_CLIENT', assignedToId: omar.id, createdAt: daysAgo(9) });
  const r4 = await mkReq({ title: 'Update landing page copy', clientId: lumen.id, userId: lumenUser.id, type: 'COPY', description: 'Please refresh the wholesale landing page headline.', priority: 'NORMAL', status: 'COMPLETED', assignedToId: sara.id, completedAt: daysAgo(12), createdAt: daysAgo(20) });
  const r5 = await mkReq({ title: 'تعديل نص إعلان رمضان', clientId: ufuq.id, userId: ufuqUser.id, campaignId: U1.id, type: 'COPY', description: 'نرجو تعديل النص ليشمل العرض الجديد قبل نهاية الأسبوع.', priority: 'URGENT', status: 'NEW', createdAt: daysAgo(0.5) });
  const r6 = await mkReq({ title: 'طلب تقرير أسبوعي', clientId: ufuq.id, userId: ufuqUser.id, type: 'OTHER', description: 'نود الحصول على تقرير أداء أسبوعي مختصر.', priority: 'NORMAL', status: 'IN_PROGRESS', assignedToId: omar.id, dueDate: dayOnly(-3), createdAt: daysAgo(4) });
  await mkReq({ title: 'New banner size for website', clientId: ufuq.id, userId: ufuqUser.id, campaignId: U3.id, type: 'DESIGN', description: 'Need the launch banner in 728×90.', priority: 'NORMAL', status: 'COMPLETED', assignedToId: omar.id, completedAt: daysAgo(40), createdAt: daysAgo(46) });
  for (const r of [r1, r2, r3, r4, r5, r6]) {
    await prisma.auditLog.create({ data: { userId: r.userId, action: 'REQUEST_CREATED', entity: 'request', entityId: r.id, metadata: JSON.stringify({ title: r.title }), createdAt: r.createdAt } });
  }
  await prisma.comment.create({ data: { requestId: r1.id, clientId: lumen.id, userId: sara.id, authorType: 'TEAM', comment: 'Started on it — expect a first draft by Thursday.', createdAt: daysAgo(5) } });
  await prisma.comment.create({ data: { requestId: r1.id, clientId: lumen.id, userId: lumenUser.id, authorType: 'CLIENT', comment: 'Perfect, thank you!', createdAt: daysAgo(4.5) } });
  await prisma.comment.create({ data: { requestId: r3.id, clientId: lumen.id, userId: omar.id, authorType: 'TEAM', comment: 'Could you share the roasting schedule so we can plan the shoot?', createdAt: daysAgo(8) } });
  await prisma.comment.create({ data: { requestId: r6.id, clientId: ufuq.id, userId: omar.id, authorType: 'TEAM', comment: 'سنرسل أول تقرير يوم الأحد.', createdAt: daysAgo(3) } });

  // ── campaign-level & request files ──
  const text = (s: string) => Buffer.from(s, 'utf8');
  await addFile({ name: 'Brand Guidelines (DEMO).txt', type: 'text/plain', ext: '.txt', data: text('DEMO FILE\nBrand colours: green #2E7D5B, cream #F6F1E7.\nTone of voice: warm, confident, concise.\n'), clientId: lumen.id, uploader: admin.id, at: daysAgo(30) });
  await addFile({ name: 'Media Plan (DEMO).csv', type: 'text/csv', ext: '.csv', data: text('channel,week,budget\nMeta,1,1500\nMeta,2,1500\nGoogle,1,1000\n'), clientId: lumen.id, campaignId: L1.id, uploader: sara.id, at: daysAgo(35) });
  await addFile({ name: 'Internal notes (team only).txt', type: 'text/plain', ext: '.txt', data: text('DEMO FILE\nInternal: client prefers Tuesday launches.\n'), clientId: lumen.id, campaignId: L1.id, uploader: sara.id, visibleToClient: false, at: daysAgo(20) });
  await addFile({ name: 'Reference photo.png', type: 'image/png', ext: '.png', data: image(800, 500), clientId: lumen.id, requestId: r1.id, uploader: lumenUser.id, at: daysAgo(6) });
  await addFile({ name: 'خطة الحملة (DEMO).txt', type: 'text/plain', ext: '.txt', data: text('ملف تجريبي\nخطة الحملة الإعلانية لشهر رمضان.\n'), clientId: ufuq.id, campaignId: U1.id, uploader: omar.id, at: daysAgo(28) });
  await addFile({ name: 'Weekly report template (DEMO).csv', type: 'text/csv', ext: '.csv', data: text('date,spend,clicks,conversions\n'), clientId: ufuq.id, requestId: r6.id, uploader: omar.id, at: daysAgo(3) });

  // ── notifications ──
  const n = (userId: string, type: string, entity: string, entityId: string, data: object, ago: number, read = false) =>
    prisma.notification.create({ data: { userId, type, entity, entityId, data: JSON.stringify(data), createdAt: daysAgo(ago), readAt: read ? daysAgo(ago - 0.1) : null } });
  await n(lumenUser.id, 'DELIVERABLE_SUBMITTED', 'deliverable', d2.id, { name: d2.name, version: 1 }, 1);
  await n(lumenUser.id, 'REQUEST_STATUS_CHANGED', 'request', r1.id, { title: r1.title, status: 'IN_PROGRESS' }, 5, true);
  await n(lumenUser.id, 'NEW_COMMENT', 'deliverable', d2.id, { name: d2.name, by: sara.name }, 1);
  await n(ufuqUser.id, 'DELIVERABLE_SUBMITTED', 'deliverable', d6.id, { name: d6.name, version: 1 }, 1);
  await n(ufuqUser.id, 'REQUEST_STATUS_CHANGED', 'request', r6.id, { title: r6.title, status: 'IN_PROGRESS' }, 3, true);
  await n(sara.id, 'CHANGES_REQUESTED', 'deliverable', d3.id, { name: d3.name, version: 1, client: lumen.companyName }, 3);
  await n(sara.id, 'NEW_REQUEST', 'request', r2.id, { title: r2.title, by: lumenUser.name }, 1);
  await n(omar.id, 'NEW_REQUEST', 'request', r5.id, { title: r5.title, by: ufuqUser.name }, 0.5);
  await n(omar.id, 'CHANGES_REQUESTED', 'deliverable', d8.id, { name: d8.name, version: 1, client: ufuq.companyName }, 5, true);
  await n(admin.id, 'NEW_REQUEST', 'request', r5.id, { title: r5.title, by: ufuqUser.name }, 0.5);
  await n(admin.id, 'DELIVERABLE_APPROVED', 'deliverable', d7.id, { name: d7.name, version: 3, client: ufuq.companyName }, 8, true);

  // ── a few more audit entries so the log has history ──
  const a = (userId: string, action: string, entity: string, entityId: string, metadata: object, ago: number) =>
    prisma.auditLog.create({ data: { userId, action, entity, entityId, metadata: JSON.stringify(metadata), createdAt: daysAgo(ago) } });
  for (const c of [L1, L2, L3, U1, U2, U3]) await a(admin.id, 'CAMPAIGN_CREATED', 'campaign', c.id, { name: c.name }, 60);
  for (const u of [admin, sara, omar, lumenUser, ufuqUser]) await a(u.id, 'USER_LOGIN', 'user', u.id, { role: u.role }, 0.2);
  for (const d of [d1, d3, d5, d7, d8]) await a(d.createdById ?? sara.id, 'DELIVERABLE_CREATED', 'deliverable', d.id, { name: d.name }, 20);
  await a(sara.id, 'CAMPAIGN_UPDATED', 'campaign', L1.id, { fields: ['status'], status: { from: 'PLANNING', to: 'RUNNING' } }, 39);
  await a(lumenUser.id, 'COMMENT_CREATED', 'deliverable', d2.id, {}, 0.5);
  await a(sara.id, 'REQUEST_STATUS_CHANGED', 'request', r1.id, { from: 'NEW', to: 'IN_PROGRESS' }, 5);

  console.log('\nDemo data loaded.\n');
  console.log('  ROLE     EMAIL                      PASSWORD');
  console.log(`  ADMIN    ${adminEmail.padEnd(26)} (SEED_ADMIN_PASSWORD from .env)`);
  console.log('  TEAM     sara@demo.local            (SEED_DEMO_PASSWORD)  - assigned to Lumen Coffee');
  console.log('  TEAM     omar@demo.local            (SEED_DEMO_PASSWORD)  - assigned to Al-Ufuq + one Lumen campaign');
  console.log('  CLIENT   lumen@demo.local           (SEED_DEMO_PASSWORD)  - Lumen Coffee Roasters');
  console.log('  CLIENT   ufuq@demo.local            (SEED_DEMO_PASSWORD)  - Al-Ufuq (Arabic demo)\n');
}

main()
  .catch((e) => {
    console.error('\nSeed failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
