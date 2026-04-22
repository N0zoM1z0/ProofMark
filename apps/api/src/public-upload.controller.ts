import { BadRequestException, Body, Controller, Param, Put } from '@nestjs/common';
import { SubmissionUploadService } from './submission-upload.service.js';

@Controller('api/public/uploads')
export class PublicUploadController {
  constructor(
    private readonly submissionUploadService: SubmissionUploadService
  ) {}

  @Put(':token')
  async uploadEncryptedSubmissionBlob(
    @Param('token') token: string,
    @Body() body: unknown
  ) {
    if (body === undefined || body === null) {
      throw new BadRequestException('Encrypted blob body is required');
    }

    return this.submissionUploadService.uploadEncryptedBlob({
      body,
      token
    });
  }
}
