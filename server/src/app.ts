import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { originCheck } from './auth/middleware';
import { config } from './config';
import { ApiError, zodToFields } from './lib/errors';
import { api } from './routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use('/api', originCheck, api);

  // Production: serve the built web app from the same server (one process, one port).
  const dist = config.webDist;
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const send = (status: number, code: string, message: string, fields?: Record<string, string>) =>
    res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });

  if (err instanceof ApiError) return send(err.status, err.code, err.message, err.fields);
  if (err instanceof ZodError) return send(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', zodToFields(err));

  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', 'The request could not be read.');
  if (e?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(409, 'CONFLICT', 'This conflicts with existing data.');
    if (err.code === 'P2025') return send(404, 'NOT_FOUND', 'The requested item was not found.');
    console.error(`[db] ${req.method} ${req.originalUrl}`, err.code, err.message);
    return send(500, 'DATABASE_ERROR', 'A database error occurred. Please try again.');
  }

  // Never leak internals to the browser; details go to the server log only.
  console.error(`[error] ${req.method} ${req.originalUrl}`, config.isProd ? (err as Error)?.message : err);
  return send(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
};
