# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only. A CommonJS project loads them through `require(esm)`, which needs Node.js 20.19+ or 22.12+, and doesn't have to convert (https://docs.nestjs.com/migration-guide.md).

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). `ObserveModule` is registered first in `src/app.module.ts`, and `src/main.ts` passes `instrument: ObserveInstrument`, but nothing is sent until the app has a key pair: `npx @nestjs/observe link` writes it (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env` (https://observe.nestjs.com/documentation/sdk#quick-start).

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## This project

A file upload service: users upload images and PDF documents, download them through the API or through signed links that expire after five minutes, and delete them, each within a storage quota of their own. It is the finished app of https://docs.nestjs.com/tutorials/file-uploads, which explains each part, and builds on https://docs.nestjs.com/tutorials/rest-api-jwt-authentication (sign-in, `src/auth/`, `src/users/`, `src/health/`).

- Layout: one folder per feature under `src/` (module, controllers, service, Zod schemas). The Drizzle schema is `src/database/schema.ts`; after changing it, run `npm run db:generate -- --name=<change>` and commit the migration in `drizzle/` (`npm run db:migrate` applies it).
- Configuration: `src/config.ts` is a Zod schema that `ConfigModule` checks at startup; add every new variable there and to `.env.example`. Read it with `ConfigService<Env, true>` and `{ infer: true }`.
- Validation: Zod schemas passed to `@Body()`, `@Query()` and `@Param()` with the `schema` option, through the global `StandardSchemaValidationPipe`. Optional fields are not nullable. Don't derive an update schema with `.partial()` from a schema that has `.default()`.
- Auth is deny by default: every route requires a bearer token unless it is marked `@Public()`. Mark public routes `@ApiSecurity({})` too, so the OpenAPI document (which requires the token document-wide, in `main.ts`) shows them as open. Get the user with `@CurrentUser('id')`.
- Storage: one disk, `files`, built in `src/storage/storage.config.ts` (a `LocalDisk` under `STORAGE_ROOT`, or an `S3Disk` with `STORAGE_DRIVER=s3`). Inject it as `StorageDisk`. Code must work on both: never touch `storage/` with `node:fs`.
- Uploads: `FileInterceptor` from `@nestjs/platform-node` with `storage: uploadToDisk(...)`, which detects the type from the bytes (`FILE_TYPES`, 415) and stops at `MAX_FILE_SIZE` (413), both in `src/files/file-rules.ts`. Don't add `ParseFilePipe` or `FileTypeValidator`: they run after the file is stored. Store `upload.contentType` (detected), never `upload.mimetype` (the client's claim). Keys are `<ownerId>/<uuid><ext>`, chosen by the server; the client's file name is only stored as `name` and sent back in `Content-Disposition`.
- Ownership: every query on `files` filters by id and owner (`FilesService.owned()`), so someone else's file is a 404, never a 403.
- The quota is taken only in `FilesService.create()`, by one conditional `UPDATE users ... WHERE storage_used + size <= storage_quota` in the same transaction as the insert, and a refused upload's bytes are deleted in the `catch`. Keep it a single conditional statement: "never lets concurrent uploads exceed the quota" in `test/files.e2e-spec.ts` fails a read-then-write version.
- Deletes remove the row and give back the quota in one transaction, then delete the bytes; a failed byte delete leaves an orphan and is only logged. Never delete the bytes first. "deletes the row, then the bytes, once even when asked twice at once" protects this.
- Downloads: `serveFile()` (attachment, `nosniff`, `Range`) and `disk.signedUrl(key, { expiresIn: '5m' })`. `/downloads` serves the local disk's signed links and is public on purpose; keep downloads `attachment` unless the type can't run script.
- NestJS Observe is registered in `src/app.module.ts` (`ObserveModule.forRoot()` first in `imports`, `serviceId: 'files-api'`) and passed as `instrument: ObserveInstrument` in `src/main.ts`. It sends nothing until `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set.
- Tests: `npm run test:e2e` with `TEST_DATABASE_URL` pointing at a PostgreSQL database the tests may truncate (`files_test` from `docker compose`). The files go to an `InMemoryDisk` (overriding `STORAGE_MODULE_OPTIONS`); multipart bodies are built with `FormData` through a `Request`, since `app.inject()` has no multipart helper. The test files share one database, hence `--no-file-parallelism`.

This project is ESM: relative imports end in `.js`, and `__dirname` doesn't exist (use `import.meta.dirname`).
