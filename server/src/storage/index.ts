import { config } from '../config';
import { LocalStorage } from './LocalStorage';
import type { StorageProvider } from './StorageProvider';

// Swap this line for S3Storage when you move to object storage.
export const storage: StorageProvider = new LocalStorage(config.uploadDir);
export type { StorageProvider };
