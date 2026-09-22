import crypto from 'node:crypto';
import path from 'node:path';
import { ALLOWED_UPLOADS } from '../../../shared/src/uploads';
import { ApiError, Errors } from '../lib/errors';

/** Any of these appearing anywhere in a file name (e.g. "invoice.php.png") is rejected outright. */
const DANGEROUS_PARTS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'scr', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'cjs',
  'jse', 'wsf', 'php', 'phtml', 'php3', 'php4', 'php5', 'phar', 'py', 'pl', 'rb', 'jar', 'apk', 'app', 'deb', 'rpm',
  'html', 'htm', 'xhtml', 'svg', 'swf', 'hta', 'lnk', 'reg', 'cgi', 'asp', 'aspx', 'jsp',
]);

export interface ValidatedUpload {
  storageKey: string;
  displayName: string;
  mime: string;
  ext: string;
}

/**
 * multer decodes the multipart filename as latin1, which mangles Arabic names.
 * Re-decode as UTF-8, strip any path parts and control characters, and cap the length.
 */
export function sanitizeFileName(original: string): string {
  let name = original;
  try {
    name = Buffer.from(original, 'latin1').toString('utf8');
    if (name.includes('�')) name = original;
  } catch {
    name = original;
  }
  name = name.replace(/[\\/]+/g, '/').split('/').pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim();
  if (name.length > 120) {
    const ext = path.extname(name).slice(0, 10);
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name || 'file';
}

const startsWith = (buf: Buffer, sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);

/** Cheap content sniffing so a renamed executable/HTML file cannot masquerade as an image or PDF. */
function magicMatches(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case '.png': return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case '.jpg':
    case '.jpeg': return startsWith(buf, [0xff, 0xd8, 0xff]);
    case '.gif': return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case '.webp': return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case '.pdf': return buf.subarray(0, 1024).includes('%PDF-');
    case '.mp4':
    case '.mov': return buf.subarray(4, 12).includes('ftyp');
    case '.webm': return startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case '.mp3': return startsWith(buf, [0x49, 0x44, 0x33]) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    case '.docx':
    case '.xlsx':
    case '.pptx':
    case '.zip': return startsWith(buf, [0x50, 0x4b]);
    case '.doc':
    case '.xls':
    case '.ppt': return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
    case '.txt':
    case '.csv': return !buf.subarray(0, 8192).includes(0); // no NUL bytes = text
    default: return false;
  }
}

/** Validates extension, MIME type, size and content; returns a safe unique storage key. */
export function validateUpload(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, maxBytes: number): ValidatedUpload {
  const displayName = sanitizeFileName(file.originalname);
  if (file.size === 0) throw Errors.badRequest('FILE_EMPTY', 'The file is empty.');
  if (file.size > maxBytes) throw new ApiError(413, 'FILE_TOO_LARGE', 'The file is too large.');

  const lowerParts = displayName.toLowerCase().split('.').slice(1);
  if (lowerParts.some((p) => DANGEROUS_PARTS.has(p))) throw Errors.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed.');

  const ext = path.extname(displayName).toLowerCase();
  const allowedMimes = ALLOWED_UPLOADS[ext];
  if (!allowedMimes) throw Errors.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed.');

  const mime = (file.mimetype || '').toLowerCase().split(';')[0].trim();
  const mimeOk = allowedMimes.includes(mime) || mime === 'application/octet-stream';
  if (!mimeOk) throw Errors.badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed.');

  if (!magicMatches(ext, file.buffer)) throw Errors.badRequest('FILE_CONTENT_MISMATCH', 'The file content does not match its type.');

  return { storageKey: `${crypto.randomUUID()}${ext}`, displayName, mime: allowedMimes[0], ext };
}
