import type { ConfigService } from '@nestjs/config';
import { LocalDisk, S3Disk, type StorageModuleOptions } from '@nestjs/storage';
import type { Env } from '../config.js';

/** One private disk, `files`: a local folder in development, a bucket in production. */
export function createStorageOptions(config: ConfigService<Env, true>): StorageModuleOptions {
  if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
    return {
      disks: {
        // Credentials come from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
        files: new S3Disk({
          bucket: config.get('S3_BUCKET', { infer: true })!,
          region: config.get('S3_REGION', { infer: true }),
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
        }),
      },
    };
  }
  return {
    disks: {
      files: new LocalDisk({
        root: config.get('STORAGE_ROOT', { infer: true }),
        // A folder can't sign URLs the way S3 does: the app signs them, and serves them at /downloads.
        signedUrls: {
          baseUrl: `${config.get('APP_URL', { infer: true })}/downloads`,
          keys: [config.get('STORAGE_SIGNING_KEY', { infer: true })!],
        },
      }),
    },
  };
}
