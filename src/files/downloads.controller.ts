import { Controller, Get, Req, Res } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import type { NodeRequest, NodeResponse } from '@nestjs/platform-node';
import { serveSignedUrl, StorageDisk } from '@nestjs/storage';
import { ApiSecurity } from '@nestjs/swagger';

/**
 * Serves the local disk's signed links. They carry their own permission, so the route is
 * public. With S3, the links point at the bucket, and this route answers 404.
 */
@Public()
@ApiSecurity({})
@Controller('downloads')
export class DownloadsController {
  constructor(private readonly disk: StorageDisk) {}

  @Get()
  download(@Req() req: NodeRequest, @Res({ passthrough: true }) res: NodeResponse) {
    return serveSignedUrl(this.disk, { req, res });
  }
}
