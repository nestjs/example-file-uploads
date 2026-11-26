import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.url(),
    // Signs the access tokens: at least 32 bytes.
    JWT_SECRET: z.string().min(32),
    // The browser origins allowed to call the API, comma-separated. None by default.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
      .pipe(z.array(z.url())),
    // Where clients reach the API: local download links point here.
    APP_URL: z.url().default('http://localhost:3000'),
    // 'local' in development, 's3' in production (AWS S3, Cloudflare R2, MinIO...).
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_ROOT: z.string().default('storage'),
    // Signs the local disk's download links: at least 32 characters.
    STORAGE_SIGNING_KEY: z.string().min(32).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    // For S3-compatible stores only; AWS S3 needs none.
    S3_ENDPOINT: z.url().optional(),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  })
  .refine((env) => env.STORAGE_DRIVER !== 'local' || env.STORAGE_SIGNING_KEY, {
    path: ['STORAGE_SIGNING_KEY'],
    message: 'Required when STORAGE_DRIVER is local',
  })
  .refine((env) => env.STORAGE_DRIVER !== 's3' || env.S3_BUCKET, {
    path: ['S3_BUCKET'],
    message: 'Required when STORAGE_DRIVER is s3',
  });

export type Env = z.infer<typeof envSchema>;
