import type { Readable } from 'node:stream';
import type { StorageProvider } from './StorageProvider';

/**
 * PLACEHOLDER for S3-compatible storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2, ...).
 *
 * To enable it later:
 *   1. npm install @aws-sdk/client-s3 -w server
 *   2. implement the four methods below with PutObjectCommand / GetObjectCommand /
 *      DeleteObjectCommand / HeadObjectCommand (bucket + endpoint from env vars)
 *   3. in storage/index.ts return `new S3Storage(...)` when STORAGE_DRIVER=s3
 *
 * Nothing else in the app needs to change: routes only use opaque keys, never paths.
 */
export class S3Storage implements StorageProvider {
  put(_key: string, _data: Buffer, _opts: { contentType: string }): Promise<void> {
    throw new Error('S3Storage is not implemented yet');
  }
  get(_key: string): Promise<{ stream: Readable; size: number }> {
    throw new Error('S3Storage is not implemented yet');
  }
  delete(_key: string): Promise<void> {
    throw new Error('S3Storage is not implemented yet');
  }
  exists(_key: string): Promise<boolean> {
    throw new Error('S3Storage is not implemented yet');
  }
}
