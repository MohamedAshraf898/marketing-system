// Upload rules shared by the API (enforcement) and the web app (early feedback).
// The API is the only place these are *enforced*.

export const ALLOWED_UPLOADS: Record<string, string[]> = {
  // extension -> allowed MIME types
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.mp4': ['video/mp4'],
  '.mov': ['video/quicktime'],
  '.webm': ['video/webm'],
  '.mp3': ['audio/mpeg'],
  '.txt': ['text/plain'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.zip': ['application/zip', 'application/x-zip-compressed'],
};

/** Types the browser may render inline (previews). Everything else is forced to download. */
export const INLINE_SAFE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm'];

export const ACCEPT_ATTR = Object.keys(ALLOWED_UPLOADS).join(',');
