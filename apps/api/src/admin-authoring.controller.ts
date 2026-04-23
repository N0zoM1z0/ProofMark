import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import type { ExamAuthoringImportFormat } from '@proofmark/shared';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminAuthoringService } from './admin-authoring.service.js';

type ImportPreviewBody = {
  content?: string;
  format?: ExamAuthoringImportFormat;
};

type CreateTemplateBody = {
  bundle?: unknown;
  description?: string | null;
  title?: string | null;
};

type CreateQuestionBankEntryBody = {
  entry?: unknown;
};

@Controller('api/admin')
export class AdminAuthoringController {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuthService: AdminAuthService,
    @Inject(AdminAuthoringService)
    private readonly adminAuthoringService: AdminAuthoringService
  ) {}

  private authorizeAdmin(
    adminId: string | undefined,
    mfaCode: string | undefined
  ) {
    return this.adminAuthService.authorize({
      adminId,
      mfaCode
    });
  }

  @Get('exams')
  async listExams(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.adminAuthoringService.listExams();
  }

  @Get('exams/:examId/export')
  async exportExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.adminAuthoringService.exportExamBundle(examId);
  }

  @Post('imports/preview')
  previewImport(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: ImportPreviewBody
  ) {
    this.authorizeAdmin(adminId, mfaCode);

    if (!body.format) {
      throw new BadRequestException('format is required');
    }

    if (typeof body.content !== 'string' || !body.content.trim()) {
      throw new BadRequestException('content is required');
    }

    return this.adminAuthoringService.previewImport({
      content: body.content,
      format: body.format
    });
  }

  @Get('templates')
  async listTemplates(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.adminAuthoringService.listTemplates();
  }

  @Get('templates/:templateId')
  async getTemplate(
    @Param('templateId') templateId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.adminAuthoringService.getTemplate(templateId);
  }

  @Post('templates')
  async createTemplate(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: CreateTemplateBody
  ) {
    if (body.bundle === undefined) {
      throw new BadRequestException('bundle is required');
    }

    return this.adminAuthoringService.createTemplate({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      bundle: body.bundle,
      description: body.description,
      title: body.title
    });
  }

  @Get('question-bank')
  async listQuestionBank(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    this.authorizeAdmin(adminId, mfaCode);
    return this.adminAuthoringService.listQuestionBank();
  }

  @Post('question-bank')
  async createQuestionBankEntry(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: CreateQuestionBankEntryBody
  ) {
    if (body.entry === undefined) {
      throw new BadRequestException('entry is required');
    }

    return this.adminAuthoringService.createQuestionBankEntry({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      entry: body.entry
    });
  }
}
