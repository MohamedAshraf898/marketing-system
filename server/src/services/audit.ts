import { prisma } from '../db';
import type { Ctx } from '../lib/context';

/** Extra context that turns an audit row into an entry of a client's / project's activity feed. */
export interface AuditOpts {
  /** The client the action belongs to. Rows with a clientId appear in that client's Activity timeline (staff). */
  clientId?: string | null;
  projectId?: string | null;
  /**
   * true  -> the row may also be shown to that client's own portal users (their Activity timeline).
   * false -> internal only (the default). NEVER mark internal work (tasks, internal notes, invoices ...) as visible.
   */
  clientVisible?: boolean;
}

/**
 * Append-only audit trail. Never throws: a logging failure must not break the user's action.
 * Action codes are stable strings (translated in the admin UI).
 *
 * The same rows feed the activity timeline: pass `opts.clientId` (and `opts.clientVisible` for events a client may see).
 */
export async function audit(
  ctx: Pick<Ctx, 'ip'> & { user: { id: string } | null },
  action: string,
  entity: string,
  entityId?: string | null,
  metadata?: Record<string, unknown>,
  opts?: AuditOpts,
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
        clientId: opts?.clientId ?? null,
        projectId: opts?.projectId ?? null,
        clientVisible: opts?.clientVisible === true && !!opts.clientId,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log', err);
  }
}
