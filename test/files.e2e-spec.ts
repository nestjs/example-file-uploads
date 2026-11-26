import { fileURLToPath } from 'node:url';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { InMemoryDisk, STORAGE_MODULE_OPTIONS } from '@nestjs/storage';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { files, users } from '../src/database/schema.js';

// A real PostgreSQL with a pool, so concurrent uploads really race.
const url = process.env.TEST_DATABASE_URL;

/** A file that starts like a PNG, padded to `size` bytes. */
const png = (size: number) =>
  Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(size - 16)]);

/** A multipart/form-data body, built by the platform's FormData. */
async function form(content: Buffer, filename: string, type = 'application/octet-stream') {
  const body = new FormData();
  body.append('file', new Blob([content], { type }), filename);
  const req = new Request('http://localhost/', { method: 'POST', body });
  return {
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { 'content-type': req.headers.get('content-type')! },
  };
}

describe.skipIf(!url)('Files API (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  const disk = new InMemoryDisk({
    signedUrls: { baseUrl: 'http://localhost:3000/downloads', keys: ['test-only-signing-key-0123456789abcdef'] },
  });
  let app: NestNodeApplication;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, refresh_tokens CASCADE`);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      // scrypt at the default cost takes 128 MiB and a few hundred ms per hash.
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      // The files go to memory: the test checks what the disk holds with keys().
      .overrideProvider(STORAGE_MODULE_OPTIONS)
      .useValue({ disks: { files: disk } })
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
  });

  afterAll(() => app.close()); // closes the pool too
  beforeEach(() => disk.clear());

  let clients = 0;

  /** Signs a user up, and returns the headers that authenticate as them. */
  async function signUp(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email, password: 'correct horse battery' },
      // Sign-up is rate-limited per IP address: each user gets an address of their own.
      remoteAddress: `10.0.0.${++clients}`,
    });
    return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
  }

  async function upload(headers: Record<string, string>, content: Buffer, filename: string, type?: string) {
    const body = await form(content, filename, type);
    return app.inject({ method: 'POST', url: '/files', headers: { ...headers, ...body.headers }, payload: body.payload });
  }

  it('uploads a file and streams it back with its type and name', async () => {
    const ada = await signUp('ada@example.com');
    const content = png(2048);

    const created = await upload(ada, content, 'avatar.png', 'image/png');
    expect(created.statusCode).toBe(201);
    const file = created.json<{ id: string }>();
    expect(file).toMatchObject({ name: 'avatar.png', contentType: 'image/png', size: 2048 });

    const download = await app.inject({ method: 'GET', url: `/files/${file.id}/content`, headers: ada });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-disposition']).toBe('attachment; filename="avatar.png"');
    expect(download.rawPayload).toEqual(content);
  });

  it('refuses a file of the wrong type, or too large, and stores nothing', async () => {
    const ada = await signUp('ada-refused@example.com');

    // A text file that claims to be an image: the bytes decide.
    const text = await upload(ada, Buffer.from('<script>alert(1)</script>'), 'cat.png', 'image/png');
    expect(text.statusCode).toBe(415);
    const big = await upload(ada, png(10 * 1024 * 1024 + 1), 'big.png', 'image/png');
    expect(big.statusCode).toBe(413);

    expect(disk.keys()).toEqual([]);
    const usage = await app.inject({ method: 'GET', url: '/me/storage', headers: ada });
    expect(usage.json()).toMatchObject({ used: 0 });
  });

  it('never lets concurrent uploads exceed the quota', async () => {
    const ada = await signUp('ada-quota@example.com');
    await db.update(users).set({ storageQuota: 10_000 }).where(eq(users.email, 'ada-quota@example.com'));

    // Five uploads of 3,000 bytes at once, against 10,000 bytes of quota: three fit.
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => upload(ada, png(3_000), `${i}.png`)));

    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 201, 201, 409, 409]);
    const usage = await app.inject({ method: 'GET', url: '/me/storage', headers: ada });
    expect(usage.json()).toEqual({ used: 9_000, quota: 10_000 });
    // The refused uploads' bytes were deleted again.
    expect(disk.keys()).toHaveLength(3);
  });

  it("answers 404 for someone else's file", async () => {
    const ada = await signUp('ada-owner@example.com');
    const bob = await signUp('bob@example.com');
    const { id } = (await upload(ada, png(100), 'avatar.png')).json<{ id: string }>();

    for (const path of [`/files/${id}`, `/files/${id}/content`, `/files/${id}/link`]) {
      expect((await app.inject({ method: 'GET', url: path, headers: bob })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'DELETE', url: `/files/${id}`, headers: bob })).statusCode).toBe(404);
    expect(disk.keys()).toHaveLength(1);
  });

  it('downloads through a signed link, which works without a token', async () => {
    const ada = await signUp('ada-link@example.com');
    const { id } = (await upload(ada, png(100), 'avatar.png')).json<{ id: string }>();

    const { url: link } = (await app.inject({ method: 'GET', url: `/files/${id}/link`, headers: ada })).json<{ url: string }>();
    const { pathname, search } = new URL(link);
    const download = await app.inject({ method: 'GET', url: pathname + search });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(png(100));

    const tampered = await app.inject({ method: 'GET', url: pathname + search.replace('avatar', 'secret') });
    expect(tampered.statusCode).toBe(403);
  });

  it('deletes the row, then the bytes, once even when asked twice at once', async () => {
    const ada = await signUp('ada-delete@example.com');
    const { id } = (await upload(ada, png(500), 'avatar.png')).json<{ id: string }>();

    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'DELETE', url: `/files/${id}`, headers: ada })));

    expect(results.map((res) => res.statusCode).sort()).toEqual([204, 404]);
    const usage = await app.inject({ method: 'GET', url: '/me/storage', headers: ada });
    expect(usage.json()).toMatchObject({ used: 0 });
    expect(disk.keys()).toEqual([]);
    expect(await db.select().from(files).where(eq(files.id, id))).toEqual([]);
  });
});
