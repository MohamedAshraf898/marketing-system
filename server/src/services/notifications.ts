import { prisma } from '../db';
import { dispatchToChannels } from '../integrations/registry';

export interface NotificationInput {
  type: string; // NEW_REQUEST | DELIVERABLE_SUBMITTED | DELIVERABLE_APPROVED | CHANGES_REQUESTED | REQUEST_STATUS_CHANGED | REQUEST_ASSIGNED | NEW_COMMENT
  // phase 2: TASK_ASSIGNED | TASK_DUE_SOON | TASK_OVERDUE | CONTRACT_EXPIRING | INVOICE_OVERDUE | REPORT_AVAILABLE (each needs a 'notif.<TYPE>' text)
  entity: 'deliverable' | 'request' | 'campaign' | 'task' | 'project' | 'contract' | 'invoice' | 'report' | 'content' | 'client';
  entityId: string;
  data: Record<string, unknown>;
}

/** Active admins + team members assigned to the client (or the specific campaign). */
export async function staffRecipients(clientId: string, campaignId?: string | null): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { role: 'ADMIN' },
        { role: 'TEAM', clientAssignments: { some: { clientId } } },
        ...(campaignId ? [{ role: 'TEAM' as const, campaignAssignments: { some: { campaignId } } }] : []),
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function clientRecipients(clientId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { role: 'CLIENT', clientId, status: 'ACTIVE' }, select: { id: true } });
  return users.map((u) => u.id);
}

/** Stores an in-app notification for each recipient (never the actor) and hands it to future channels. */
export async function notify(recipientIds: string[], input: NotificationInput, actorId: string): Promise<void> {
  const ids = [...new Set(recipientIds)].filter((id) => id !== actorId);
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type: input.type,
        entity: input.entity,
        entityId: input.entityId,
        data: JSON.stringify(input.data),
      })),
    });
    // Future: Email / WhatsApp / Slack. No-op until a channel is registered.
    void (async () => {
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, locale: true } });
      await Promise.all(
        users.map((u) =>
          dispatchToChannels({ recipient: { id: u.id, name: u.name, email: u.email }, locale: u.locale, type: input.type, data: input.data }),
        ),
      );
    })().catch(() => undefined);
  } catch (err) {
    console.error('[notify] failed', err);
  }
}
