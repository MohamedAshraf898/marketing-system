import crypto from 'node:crypto';
import type { ContentStatus, ContentType, DeliverableType, SocialPlatform } from '../../../shared/src/enums';
import { prisma } from '../db';
import { storage } from '../storage';
import { makeDemoImage } from './png';
import type { SeedCtx } from './ctx';

type Step = { kind: 'submit' | 'changes' | 'approve'; daysAgo: number; comment?: string };

interface Item {
  title: string;
  client: 'lumen' | 'ufuq';
  campaign?: 'L1' | 'L2' | 'L3' | 'U1' | 'U2' | 'U3';
  platform: SocialPlatform;
  type: ContentType;
  status: ContentStatus;
  /** same convention as ctx.daysAgo: positive = days in the past, negative = days in the future */
  day?: number;
  hour?: number;
  caption?: string;
  notes?: string;
  /** when set, a linked deliverable with an append-only approval history is created */
  approval?: { steps: Step[]; deliverable: 'PENDING_APPROVAL' | 'APPROVED' | 'CHANGES_REQUESTED' };
}

const DELIVERABLE_TYPE: Record<ContentType, DeliverableType> = { POST: 'DESIGN', CAROUSEL: 'DESIGN', REEL: 'REEL', STORY: 'STORY', VIDEO: 'VIDEO', ARTICLE: 'COPY', AD: 'BANNER', OTHER: 'OTHER' };

const ITEMS: Item[] = [
  // ── Lumen Coffee Roasters (English) ──
  { title: 'Cold Brew Teaser Reel (DEMO)', client: 'lumen', campaign: 'L1', platform: 'INSTAGRAM', type: 'REEL', status: 'CLIENT_APPROVAL', day: -3, hour: 12,
    caption: 'Pour. Chill. Repeat. Our new cold brew is landing this weekend. #LumenColdBrew', notes: 'Client wants the pour shot in the first 2 seconds.',
    approval: { deliverable: 'PENDING_APPROVAL', steps: [{ kind: 'submit', daysAgo: 1 }] } },
  { title: 'Spring Blend Carousel (DEMO)', client: 'lumen', campaign: 'L1', platform: 'INSTAGRAM', type: 'CAROUSEL', status: 'SCHEDULED', day: -6, hour: 9,
    caption: 'Meet the Spring Blend: floral, bright and ready for your morning. Swipe to see the tasting notes.', notes: 'Approved in round 2 (badge size). Scheduled in Meta Business Suite.',
    approval: { deliverable: 'APPROVED', steps: [{ kind: 'submit', daysAgo: 12 }, { kind: 'changes', daysAgo: 11, comment: 'Please use the brand green on slide 3.' }, { kind: 'submit', daysAgo: 9 }, { kind: 'approve', daysAgo: 8, comment: 'Looks great, approved.' }] } },
  { title: 'Barista Tips Story Series (DEMO)', client: 'lumen', campaign: 'L1', platform: 'INSTAGRAM', type: 'STORY', status: 'IN_REVIEW', day: -8, hour: 18, caption: 'Tip #1: water temperature matters. 92-96C is the sweet spot.', notes: 'Internal review with Sara on Tuesday.' },
  { title: 'Wholesale Beans Article (DEMO)', client: 'lumen', campaign: 'L2', platform: 'LINKEDIN', type: 'ARTICLE', status: 'DRAFT', day: -10, hour: 8, caption: 'Why cafes are switching to freshly roasted wholesale beans - and what to ask your roaster.', notes: 'Needs two customer quotes.' },
  { title: 'Roastery Behind the Scenes (DEMO)', client: 'lumen', campaign: 'L3', platform: 'TIKTOK', type: 'VIDEO', status: 'DRAFT', day: -13, hour: 17, caption: 'From green bean to your cup in 30 seconds.' },
  { title: 'Monday Motivation Post (DEMO)', client: 'lumen', platform: 'FACEBOOK', type: 'POST', status: 'IDEA', day: -5, hour: 8, caption: 'Coffee first, everything else second.', notes: 'Idea: repost a customer photo.' },
  { title: 'Customer Story: Cafe Noor (DEMO)', client: 'lumen', campaign: 'L2', platform: 'YOUTUBE', type: 'VIDEO', status: 'IDEA', day: -18, hour: 10, notes: 'Ask Cafe Noor for an interview slot.' },
  { title: 'Loyalty Card Announcement (DEMO)', client: 'lumen', platform: 'INSTAGRAM', type: 'POST', status: 'IDEA', day: -21, hour: 11 },
  { title: 'Summer Iced Menu Ad (DEMO)', client: 'lumen', campaign: 'L1', platform: 'FACEBOOK', type: 'AD', status: 'DRAFT', day: -24, hour: 9, caption: 'Iced lattes, cold brew and fresh lemonade. Order ahead and skip the line.' },
  { title: 'Coffee Origin Explainer (DEMO)', client: 'lumen', platform: 'YOUTUBE', type: 'VIDEO', status: 'IDEA', day: -30, hour: 15 },
  { title: 'Free Tasting Box Giveaway (DEMO)', client: 'lumen', campaign: 'L2', platform: 'INSTAGRAM', type: 'POST', status: 'IN_REVIEW', day: -14, hour: 12, caption: 'Win a free tasting box! Follow us, tag a friend and tell us your favourite brew method.' },
  { title: 'Weekend Offer Story (DEMO)', client: 'lumen', campaign: 'L1', platform: 'INSTAGRAM', type: 'STORY', status: 'PUBLISHED', day: 4, hour: 10, caption: 'Weekend offer: buy 2 bags, get the third half price.' },
  { title: 'Brand Launch Recap Post (DEMO)', client: 'lumen', campaign: 'L3', platform: 'LINKEDIN', type: 'POST', status: 'PUBLISHED', day: 12, hour: 9, caption: 'A big thank you to everyone who joined our launch week.' },

  // ── Al-Ufuq (Arabic) ──
  { title: 'منشور رمضان: عرض خاص (DEMO)', client: 'ufuq', campaign: 'U1', platform: 'INSTAGRAM', type: 'POST', status: 'DRAFT', day: -4, hour: 20,
    caption: 'رمضان كريم! استمتعوا بعرضنا الخاص طوال الشهر الفضيل.', notes: 'العميل طلب تقصير النص وإضافة رقم الهاتف.',
    approval: { deliverable: 'CHANGES_REQUESTED', steps: [{ kind: 'submit', daysAgo: 6 }, { kind: 'changes', daysAgo: 5, comment: 'يرجى تقصير النص وإضافة رقم التواصل.' }] } },
  { title: 'فيديو تعريفي بالخدمات (DEMO)', client: 'ufuq', campaign: 'U1', platform: 'YOUTUBE', type: 'VIDEO', status: 'APPROVED', day: -9, hour: 11,
    caption: 'تعرفوا على خدماتنا المتكاملة في دقيقة واحدة.', notes: 'جاهز للجدولة بعد تأكيد موعد النشر.',
    approval: { deliverable: 'APPROVED', steps: [{ kind: 'submit', daysAgo: 10 }, { kind: 'approve', daysAgo: 7, comment: 'ممتاز، تمت الموافقة.' }] } },
  { title: 'قصص سناب: أفكار للتسوق (DEMO)', client: 'ufuq', campaign: 'U2', platform: 'TIKTOK', type: 'STORY', status: 'IN_REVIEW', day: -7, hour: 19, caption: 'أفكار سريعة لتسوق ذكي هذا الأسبوع.' },
  { title: 'مقال: كيف تختار شريك التسويق (DEMO)', client: 'ufuq', campaign: 'U2', platform: 'LINKEDIN', type: 'ARTICLE', status: 'DRAFT', day: -11, hour: 9, caption: 'خمس نقاط أساسية قبل التعاقد مع وكالة تسويق.' },
  { title: 'ريلز: خلف الكواليس (DEMO)', client: 'ufuq', campaign: 'U1', platform: 'INSTAGRAM', type: 'REEL', status: 'IDEA', day: -15, hour: 18 },
  { title: 'تغريدة إطلاق المنتج (DEMO)', client: 'ufuq', campaign: 'U3', platform: 'X', type: 'POST', status: 'IDEA', day: -17, hour: 12, caption: 'إطلاق جديد قريباً. ترقبوا!' },
  { title: 'إعلان صفحة الهبوط الجديدة (DEMO)', client: 'ufuq', campaign: 'U2', platform: 'FACEBOOK', type: 'AD', status: 'DRAFT', day: -20, hour: 10, caption: 'صفحة جديدة، تجربة أسرع. زوروا موقعنا اليوم.' },
  { title: 'شهادات العملاء: كاروسيل (DEMO)', client: 'ufuq', platform: 'INSTAGRAM', type: 'CAROUSEL', status: 'IDEA', day: -27, hour: 13, notes: 'نحتاج موافقة العملاء على نشر أسمائهم.' },
  { title: 'منشور اليوم الوطني (DEMO)', client: 'ufuq', campaign: 'U3', platform: 'X', type: 'POST', status: 'PUBLISHED', day: 9, hour: 8, caption: 'كل عام وبلادنا بخير.' },
  { title: 'إعلان الشراكة الجديدة (DEMO)', client: 'ufuq', campaign: 'U3', platform: 'LINKEDIN', type: 'POST', status: 'PUBLISHED', day: 20, hour: 9, caption: 'يسعدنا الإعلان عن شراكتنا الاستراتيجية الجديدة.' },
];

/** Demo data for the "content" group: a content calendar around today, four items with real (append-only) approval history, and proofing pins. */
export async function seedContent(ctx: SeedCtx): Promise<void> {
  const { sara, omar, lumen, ufuq, lumenUser, ufuqUser, campaigns, daysAgo } = ctx;
  const palette: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
    [[244, 114, 82], [255, 214, 153], [90, 40, 30]], [[36, 110, 96], [150, 214, 190], [250, 250, 240]],
    [[64, 60, 140], [180, 170, 240], [255, 220, 120]], [[120, 40, 90], [240, 150, 190], [255, 240, 200]],
  ];
  let ix = 0;
  const addImage = async (o: { name: string; clientId: string; uploader: string; campaignId?: string; deliverableId: string; contentItemId: string; version: number; at: Date }) => {
    const [a, b, c] = palette[ix++ % palette.length];
    const data = makeDemoImage(960, 600, a, b, c);
    const key = `${crypto.randomUUID()}.png`;
    await storage.put(key, data, { contentType: 'image/png' });
    return prisma.file.create({
      data: {
        fileName: o.name, filePath: key, fileType: 'image/png', size: data.length, clientId: o.clientId, uploadedById: o.uploader, campaignId: o.campaignId ?? null,
        deliverableId: o.deliverableId, contentItemId: o.contentItemId, version: o.version, visibleToClient: true, createdAt: o.at,
      },
    });
  };

  const team = { lumen: sara, ufuq: omar };
  const clientUser = { lumen: lumenUser, ufuq: ufuqUser };
  const clients = { lumen, ufuq };
  const projects = {
    lumen: await prisma.project.findFirst({ where: { clientId: lumen.id }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
    ufuq: await prisma.project.findFirst({ where: { clientId: ufuq.id }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
  };

  for (const it of ITEMS) {
    const client = clients[it.client];
    const staff = team[it.client];
    const campaign = it.campaign ? campaigns[it.campaign] : null;
    const item = await prisma.contentItem.create({
      data: {
        clientId: client.id,
        campaignId: campaign?.id ?? null,
        projectId: it.approval ? projects[it.client]?.id ?? null : null,
        title: it.title,
        platform: it.platform,
        contentType: it.type,
        caption: it.caption ?? null,
        status: it.status,
        publishDate: it.day === undefined ? null : daysAgo(it.day, it.hour ?? 10),
        assignedToId: staff.id,
        notes: it.notes ?? null,
        createdById: staff.id,
        createdAt: daysAgo(20),
      },
    });
    await prisma.auditLog.create({ data: { userId: staff.id, action: 'CONTENT_CREATED', entity: 'content', entityId: item.id, metadata: JSON.stringify({ title: item.title }), clientId: client.id, clientVisible: false, createdAt: item.createdAt } });
    if (!it.approval) continue;

    // ── linked deliverable + append-only approval history (same shape the phase-1 seed uses) ──
    let version = 1;
    let submittedAt: Date | null = null;
    let approvedAt: Date | null = null;
    let clientComment: string | null = null;
    const firstSubmit = it.approval.steps.find((s) => s.kind === 'submit')!;
    const d = await prisma.deliverable.create({
      data: {
        name: it.title, type: DELIVERABLE_TYPE[it.type], clientId: client.id, campaignId: campaign?.id ?? null, projectId: item.projectId,
        description: it.caption ?? null, status: 'DRAFT', createdById: staff.id, createdAt: daysAgo(firstSubmit.daysAgo + 2),
      },
    });
    const submits = it.approval.steps.filter((s) => s.kind === 'submit');
    for (let v = 1; v <= submits.length; v++) {
      await addImage({ name: `${it.title.replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 40).trim()} v${v}.png`, clientId: client.id, uploader: staff.id, campaignId: campaign?.id, deliverableId: d.id, contentItemId: item.id, version: v, at: daysAgo(submits[v - 1].daysAgo + 0.3) });
    }
    for (const s of it.approval.steps) {
      if (s.kind === 'submit') {
        submittedAt = daysAgo(s.daysAgo);
        await prisma.approval.create({ data: { deliverableId: d.id, clientId: client.id, userId: staff.id, decision: 'PENDING', version, submittedAt, createdAt: submittedAt } });
        await prisma.auditLog.create({ data: { userId: staff.id, action: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: d.id, metadata: JSON.stringify({ version, name: it.title }), clientId: client.id, clientVisible: true, createdAt: submittedAt } });
        await prisma.auditLog.create({ data: { userId: staff.id, action: 'CONTENT_SENT_FOR_APPROVAL', entity: 'content', entityId: item.id, metadata: JSON.stringify({ title: it.title, deliverableId: d.id, version }), clientId: client.id, clientVisible: true, createdAt: submittedAt } });
      } else {
        const decidedAt = daysAgo(s.daysAgo);
        const decision = s.kind === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED';
        await prisma.approval.create({ data: { deliverableId: d.id, clientId: client.id, userId: clientUser[it.client].id, decision, comment: s.comment ?? null, version, submittedAt, decidedAt, createdAt: decidedAt } });
        await prisma.auditLog.create({ data: { userId: clientUser[it.client].id, action: s.kind === 'approve' ? 'DELIVERABLE_APPROVED' : 'CHANGES_REQUESTED', entity: 'deliverable', entityId: d.id, metadata: JSON.stringify({ version, name: it.title }), clientId: client.id, clientVisible: true, createdAt: decidedAt } });
        clientComment = s.comment ?? null;
        if (s.kind === 'approve') approvedAt = decidedAt;
        else version += 1;
      }
    }
    // after "changes requested" the deliverable stays on that version (the team has not started the next one yet)
    const last = it.approval.steps[it.approval.steps.length - 1];
    const finalVersion = last.kind === 'changes' ? version - 1 : version;
    await prisma.deliverable.update({
      where: { id: d.id },
      data: { status: it.approval.deliverable, version: finalVersion, submittedAt, approvedAt, clientComment: it.approval.deliverable === 'PENDING_APPROVAL' ? null : clientComment },
    });
    await prisma.contentItem.update({ where: { id: item.id }, data: { deliverableId: d.id } });

    if (it.approval.deliverable === 'PENDING_APPROVAL') {
      await prisma.notification.create({
        data: { userId: clientUser[it.client].id, type: 'DELIVERABLE_SUBMITTED', entity: 'deliverable', entityId: d.id, data: JSON.stringify({ name: it.title, version: finalVersion }), createdAt: submittedAt ?? new Date() },
      });
    } else {
      await prisma.notification.create({
        data: {
          userId: staff.id, type: it.approval.deliverable === 'APPROVED' ? 'DELIVERABLE_APPROVED' : 'CHANGES_REQUESTED', entity: 'deliverable', entityId: d.id,
          data: JSON.stringify({ name: it.title, version: finalVersion, client: client.companyName }), readAt: daysAgo(2), createdAt: daysAgo(last.daysAgo),
        },
      });
    }
  }

  // ── proofing pins on existing image deliverables of the demo (skipped quietly when they do not exist) ──
  const pinTarget = async (clientId: string, status: 'PENDING_APPROVAL' | 'CHANGES_REQUESTED' | 'APPROVED') =>
    prisma.file.findFirst({
      where: { clientId, fileType: { startsWith: 'image/' }, contentItemId: null, deliverable: { is: { status, submittedAt: { not: null } } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, version: true, deliverableId: true },
    });
  const pins: Array<{ file: Awaited<ReturnType<typeof pinTarget>>; rows: Array<{ x: number; y: number; by: 'client' | 'team'; text: string; ago: number; resolved?: boolean }>; who: { client: string; team: string } }> = [
    {
      file: await pinTarget(lumen.id, 'PENDING_APPROVAL'),
      who: { client: lumenUser.id, team: sara.id },
      rows: [
        { x: 0.22, y: 0.31, by: 'client', text: 'Can the logo be a little larger here?', ago: 0.6 },
        { x: 0.71, y: 0.58, by: 'team', text: 'Sure, we will bump it up by 15% in the next round.', ago: 0.4 },
        { x: 0.5, y: 0.82, by: 'client', text: 'Typo in the tagline (should be "roasted").', ago: 0.5, resolved: true },
      ],
    },
    {
      file: await pinTarget(ufuq.id, 'PENDING_APPROVAL'),
      who: { client: ufuqUser.id, team: omar.id },
      rows: [
        { x: 0.66, y: 0.24, by: 'client', text: 'من فضلكم تغيير لون هذا العنوان إلى الأزرق.', ago: 0.7 },
        { x: 0.3, y: 0.7, by: 'team', text: 'تم، سنرسل النسخة المعدلة قريباً.', ago: 0.3 },
      ],
    },
  ];
  for (const p of pins) {
    if (!p.file?.deliverableId) continue;
    const dl = await prisma.deliverable.findUnique({ where: { id: p.file.deliverableId }, select: { id: true, name: true, clientId: true } });
    if (!dl) continue;
    for (const r of p.rows) {
      const userId = r.by === 'client' ? p.who.client : p.who.team;
      const created = await prisma.proofingComment.create({
        data: {
          deliverableId: dl.id, fileId: p.file.id, version: p.file.version, x: r.x, y: r.y, comment: r.text, userId, authorType: r.by === 'client' ? 'CLIENT' : 'TEAM',
          resolved: !!r.resolved, resolvedAt: r.resolved ? daysAgo(r.ago - 0.1) : null, resolvedById: r.resolved ? p.who.team : null, createdAt: daysAgo(r.ago),
        },
      });
      await prisma.auditLog.create({ data: { userId, action: 'PROOFING_COMMENT_CREATED', entity: 'proofing', entityId: created.id, metadata: JSON.stringify({ deliverableId: dl.id, name: dl.name, version: p.file.version, pin: true }), clientId: dl.clientId, clientVisible: true, createdAt: daysAgo(r.ago) } });
    }
  }
}
