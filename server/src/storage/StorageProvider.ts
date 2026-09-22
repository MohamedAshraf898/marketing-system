import type { Readable } from 'node:stream';

/**
 * Storage abstraction. Business code only ever talks to this interface and only ever holds
 * opaque *keys* (never filesystem paths). To move to S3/R2/MinIO later, implement this
 * interface (see S3Storage.ts) and change one line in storage/index.ts.
 */
export interface StorageProvider {
  put(key: string, data: Buffer, opts: { contentType: string }): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size: number }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
