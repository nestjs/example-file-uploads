# File upload service with NestJS

This is the finished application of the tutorial [Build a file upload service in Node.js](https://docs.nestjs.com/tutorials/file-uploads) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

## What it does

Users sign up, then upload JPEG, PNG, WebP and GIF images and PDF documents of up to 10 MiB each, list them, download them, and delete them, each user within a storage quota of their own (100 MiB by default).

- Each upload streams straight onto storage with [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage): nothing is buffered in memory or written to a temporary file. Its type is detected from its first bytes (anything else is a 415) and its size is counted as it streams (over 10 MiB is a 413).
- Files go to a local folder (`storage/`) in development, and to AWS S3, Cloudflare R2 or MinIO with `STORAGE_DRIVER=s3`.
- Each file is a row in PostgreSQL, owned by one user: anyone else gets a 404.
- The quota is taken by one conditional `UPDATE` in the same transaction as the insert, so concurrent uploads can't exceed it (409 when a file doesn't fit).
- Downloads stream through the API with `Content-Type`, `Content-Disposition: attachment`, `nosniff` and `Range` support, or through a signed link that works without a token for five minutes.
- A delete removes the row and gives the quota back first, then deletes the bytes.

Sign-in is the JWT tutorial's: access tokens and rotating refresh tokens with `@nestjs/authentication`, rate-limited, with Zod validation, OpenAPI and health checks.

## Run it

You need Node.js 22 or later, and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-file-uploads.git
cd example-file-uploads
npm install
cp .env.example .env    # then set JWT_SECRET (openssl rand -base64 32) and STORAGE_SIGNING_KEY (openssl rand -hex 32)
docker compose up -d
npm run db:migrate
npm run start:dev
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs. Uploaded files are kept under `storage/`. The tutorial's [Try it](https://docs.nestjs.com/tutorials/file-uploads#try-it) section walks through every endpoint with curl, for example:

```bash
curl localhost:3000/auth/sign-up --json '{"email":"ada@example.com","password":"correct horse battery"}'
curl localhost:3000/files -H "Authorization: Bearer <accessToken>" -F file=@avatar.png
```

To keep the files in a bucket instead, set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (and `S3_ENDPOINT` with `S3_FORCE_PATH_STYLE=true` for MinIO): see [Use S3 in production](https://docs.nestjs.com/tutorials/file-uploads#use-s3-in-production).

## Endpoints

| Endpoint | Section |
| --- | --- |
| `POST /auth/sign-up`, `POST /auth/token`, `POST /auth/token/refresh`, `POST /auth/token/revoke`, `GET /me`, `GET /health/live`, `GET /health/ready` | [Start from the JWT API](https://docs.nestjs.com/tutorials/file-uploads#start-from-the-jwt-api) |
| `POST /files` (multipart, field `file`), `GET /files`, `GET /files/:id` | [Accept uploads](https://docs.nestjs.com/tutorials/file-uploads#accept-uploads) |
| `GET /me/storage` | [Stay within the quota](https://docs.nestjs.com/tutorials/file-uploads#stay-within-the-quota) |
| `GET /files/:id/content`, `GET /files/:id/link`, `GET /downloads` (signed links, no token) | [Download files](https://docs.nestjs.com/tutorials/file-uploads#download-files) |
| `DELETE /files/:id` | [Delete files](https://docs.nestjs.com/tutorials/file-uploads#delete-files) |

Every route except sign-up, the token endpoints, the health checks and `/downloads` needs an `Authorization: Bearer <accessToken>` header.

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | bootstrap on the Node adapter, JSON logs in production, security headers, CORS, Swagger UI |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, storage, throttler, validation pipe |
| `src/config.ts` | the environment, as a Zod schema checked at startup |
| `src/database/schema.ts` | Drizzle tables: users (with storage used and quota), files, refresh_tokens |
| `src/storage/storage.config.ts` | the `files` disk: a local folder, or S3 with `STORAGE_DRIVER=s3` |
| `src/files/` | uploads, listing, downloads, signed links, delete, the quota |
| `src/auth/`, `src/users/`, `src/health/` | sign-in, `GET /me` and health checks, from the JWT tutorial |
| `test/` | e2e tests on PostgreSQL: uploads, refused files, concurrent uploads against the quota, ownership, signed links, concurrent deletes; and the refresh-token store contract |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:files@localhost:5432/files_test npm run test:e2e
```

`docker compose` creates the `files_test` database. The tests truncate its tables, so never point them at your development database. They run against a real PostgreSQL server, so that concurrent uploads really race, and keep the files in memory. Without `TEST_DATABASE_URL`, they are skipped.

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage), [Zod](https://zod.dev) validation, [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's [production checklist](https://docs.nestjs.com/tutorials/file-uploads#production-checklist) first: S3 instead of the local folder, a private bucket, short-lived links, and the rest.

The app is wired for [NestJS Observe](https://docs.nestjs.com/observability/overview), which shows requests, errors, slow queries and calls to S3 per route. It sends nothing until it has a key pair: `npx @nestjs/observe link` writes `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` into `.env`. In production, set them in the platform's environment, since `start:prod` doesn't load `.env`.

## License

MIT
