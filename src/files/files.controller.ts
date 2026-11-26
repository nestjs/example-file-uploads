import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { FileInterceptor, type NodeRequest, type NodeResponse } from '@nestjs/platform-node';
import { uploadToDisk, type StoredUpload } from '@nestjs/storage';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { z } from 'zod';
import type { User } from '../users/user.js';
import { FILE_TYPES, MAX_FILE_SIZE } from './file-rules.js';
import { listFilesQuerySchema, type ListFilesQuery } from './files.schemas.js';
import { FilesService } from './files.service.js';

const fileId = { schema: z.uuid() };

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Streams the file onto the disk as it arrives, after checking its first bytes.
      storage: uploadToDisk({
        contentTypes: FILE_TYPES,
        // The authentication guard has run: the key starts with the owner's id.
        key: (file, req: { user: User }) => `${req.user.id}/${randomUUID()}${file.extension}`,
      }),
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
      // File names in UTF-8, as browsers send them, rather than multer's default latin1.
      defParamCharset: 'utf8',
    }),
  )
  upload(@CurrentUser('id') userId: string, @UploadedFile() file: StoredUpload | undefined) {
    if (!file) {
      throw new BadRequestException('Attach the file as the "file" field');
    }
    return this.filesService.create(userId, file);
  }

  @Get()
  findAll(@CurrentUser('id') userId: string, @Query({ schema: listFilesQuerySchema }) query: ListFilesQuery) {
    return this.filesService.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id', fileId) id: string) {
    return this.filesService.findOne(userId, id);
  }

  @Get(':id/content')
  content(
    @CurrentUser('id') userId: string,
    @Param('id', fileId) id: string,
    @Req() req: NodeRequest,
    @Res({ passthrough: true }) res: NodeResponse,
  ) {
    return this.filesService.content(userId, id, req, res);
  }

  @Get(':id/link')
  link(@CurrentUser('id') userId: string, @Param('id', fileId) id: string) {
    return this.filesService.link(userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser('id') userId: string, @Param('id', fileId) id: string) {
    return this.filesService.remove(userId, id);
  }
}
