import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { NodeRequest, NodeResponse } from '@nestjs/platform-node';
import { serveFile, StorageDisk, type StoredUpload } from '@nestjs/storage';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { files, users } from '../database/schema.js';
import type { ListFilesQuery } from './files.schemas.js';

// What the API returns: everything but the storage key.
const columns = {
  id: files.id,
  name: files.name,
  contentType: files.contentType,
  size: files.size,
  createdAt: files.createdAt,
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    // The default disk: the only one, `files`.
    private readonly disk: StorageDisk,
  ) {}

  /** Records an upload that `uploadToDisk()` has already stored, if it fits in the owner's quota. */
  async create(ownerId: string, upload: StoredUpload) {
    try {
      return await this.db.transaction(async (tx) => {
        // Checks and takes the quota in one statement: two uploads can't both fit in the last free bytes.
        const [owner] = await tx
          .update(users)
          .set({ storageUsed: sql`${users.storageUsed} + ${upload.size}` })
          .where(and(eq(users.id, ownerId), sql`${users.storageUsed} + ${upload.size} <= ${users.storageQuota}`))
          .returning({ id: users.id });
        if (!owner) {
          throw new ConflictException('Storage quota exceeded');
        }
        const [file] = await tx
          .insert(files)
          .values({
            ownerId,
            key: upload.key,
            name: displayName(upload.originalname),
            // Detected from the bytes: `upload.mimetype` is only what the client claimed.
            contentType: upload.contentType,
            size: upload.size,
          })
          .returning(columns);
        return file;
      });
    } catch (error) {
      // The bytes are stored already: don't leave them behind for a file that doesn't exist.
      await this.disk.delete(upload.key);
      throw error;
    }
  }

  findAll(ownerId: string, { limit, offset }: ListFilesQuery) {
    return this.db
      .select(columns)
      .from(files)
      .where(eq(files.ownerId, ownerId))
      .orderBy(desc(files.createdAt), desc(files.id))
      .limit(limit)
      .offset(offset);
  }

  async findOne(ownerId: string, id: string) {
    const [file] = await this.db.select(columns).from(files).where(this.owned(ownerId, id));
    return file ?? notFound();
  }

  async usage(ownerId: string) {
    const [usage] = await this.db
      .select({ used: users.storageUsed, quota: users.storageQuota })
      .from(users)
      .where(eq(users.id, ownerId));
    return usage;
  }

  /** Streams the file as the response, with its type, length and name. */
  async content(ownerId: string, id: string, req: NodeRequest, res: NodeResponse) {
    const { key, name } = await this.stored(ownerId, id);
    return serveFile(this.disk, key, { req, res, filename: name });
  }

  /** A link that downloads the file without a token, for the next five minutes. */
  async link(ownerId: string, id: string) {
    const { key, name } = await this.stored(ownerId, id);
    const url = await this.disk.signedUrl(key, { expiresIn: '5m', filename: name });
    return { url, expiresIn: 300 };
  }

  async remove(ownerId: string, id: string): Promise<void> {
    // The row first, and the quota with it, in one transaction.
    const { key } = await this.db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(files)
        .where(this.owned(ownerId, id))
        .returning({ key: files.key, size: files.size });
      if (!deleted) {
        notFound();
      }
      await tx
        .update(users)
        .set({ storageUsed: sql`${users.storageUsed} - ${deleted.size}` })
        .where(eq(users.id, ownerId));
      return deleted;
    });
    // Then the bytes. If this fails, they're an orphan, which the cleanup job removes;
    // the file is gone for the user either way.
    try {
      await this.disk.delete(key);
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${String(error)}`);
    }
  }

  private async stored(ownerId: string, id: string) {
    const [file] = await this.db
      .select({ key: files.key, name: files.name })
      .from(files)
      .where(this.owned(ownerId, id));
    return file ?? notFound();
  }

  private owned(ownerId: string, id: string) {
    return and(eq(files.id, id), eq(files.ownerId, ownerId));
  }
}

function notFound(): never {
  throw new NotFoundException('File not found');
}

/** The client's file name, without control characters, at most 255 characters. */
function displayName(originalname: string): string {
  const name = originalname.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return name.slice(0, 255) || 'file';
}
