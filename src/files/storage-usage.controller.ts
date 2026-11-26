import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { FilesService } from './files.service.js';

@Controller('me/storage')
export class StorageUsageController {
  constructor(private readonly filesService: FilesService) {}

  // Bytes used and allowed, so a client can warn before an upload is refused.
  @Get()
  usage(@CurrentUser('id') userId: string) {
    return this.filesService.usage(userId);
  }
}
