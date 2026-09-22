import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { config } from '../config';
import { ApiError, Errors } from '../lib/errors';

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 20, fieldSize: 10_000 },
});

/** Accepts a single multipart field called "file" and maps multer errors to friendly API errors. */
export function singleFile(field = 'file') {
  const handler = uploader.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(413, 'FILE_TOO_LARGE', 'The file is too large.'));
        return next(Errors.badRequest('UPLOAD_FAILED', 'The upload could not be processed.'));
      }
      next(err);
    });
  };
}
