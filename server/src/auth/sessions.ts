import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { clientIp } from '../lib/http';

/** The browser only ever holds a random token; the DB stores an HMAC of it. */
const hashToken = (token: string) => crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');

export async function createSession(req: Request, res: Response, userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: clientIp(req),
      userAgent: (req.get('user-agent') ?? '').slice(0, 255),
    },
  });
  res.cookie(config.cookieName, token, cookieOptions(expiresAt));
  // opportunistic cleanup of dead sessions
  void prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}

export function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

export const clearSessionCookie = (res: Response) => res.clearCookie(config.cookieName, cookieOptions());

export const findSessionByToken = (token: string) =>
  prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { client: { select: { status: true } } } } },
  });

export const deleteSessionByToken = (token: string) =>
  prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });

export const deleteUserSessions = (userId: string, exceptSessionId?: string) =>
  prisma.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
