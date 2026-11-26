import { Module } from '@nestjs/common';
import { DownloadsController } from './downloads.controller.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageUsageController } from './storage-usage.controller.js';

@Module({
  controllers: [FilesController, StorageUsageController, DownloadsController],
  providers: [FilesService],
})
export class FilesModule {}
