import { config } from '../config';
import { LocalStorage } from './LocalStorage';
import { S3Storage } from './S3Storage';
import type { StorageProvider } from './StorageProvider';

// STORAGE_DRIVER=s3 (with S3_* variables set) switches to S3-compatible object storage
// (Cloudflare R2, AWS S3, MinIO, ...) so uploaded files survive a host with an ephemeral
// filesystem. Default is local disk under uploadDir, unchanged from before.
function create(): StorageProvider {
  if (config.storageDriver === 's3') {
    return new S3Storage({
      bucket: config.s3.bucket,
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      forcePathStyle: config.s3.forcePathStyle,
    });
  }
  return new LocalStorage(config.uploadDir);
}

export const storage: StorageProvider = create();
export type { StorageProvider };
