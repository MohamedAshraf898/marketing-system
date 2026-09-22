import { prisma } from '../db';
import type { Ctx } from '../lib/context';

/**
 * Append-only audit trail. Never throws: a logging failure must not break the user's action.
 * Action codes are stable strings (translated in the admin UI).
 */
export async function audit(
  ctx: Pick<Ctx, 'ip'> & { user: { id: string } | null },
  action: string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.user?.id ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        ip: ctx.ip,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log', err);
  }
}
