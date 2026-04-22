import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post
} from '@nestjs/common';
import { PublicExamService } from './public-exam.service.js';
import { SubmissionService, type SemaphoreProof } from './submission.service.js';
import { SubmissionUploadService } from './submission-upload.service.js';

type SubmissionBody = {
  answerCommitment?: string;
  encryptedBlobHash?: string;
  encryptedBlobUri?: string;
  examVersion?: number;
  groupRoot?: string;
  message?: string;
  nullifierHash?: string;
  proof?: SemaphoreProof;
  questionSetHash?: string;
  scope?: string;
};

type PresignUploadBody = {
  encryptedBlobHash?: string;
  examVersion?: number;
};

@Controller('api/public/exams')
export class PublicExamController {
  constructor(
    private readonly publicExamService: PublicExamService,
    private readonly submissionService: SubmissionService,
    private readonly submissionUploadService: SubmissionUploadService
  ) {}

  @Get(':examId')
  async getExam(@Param('examId') examId: string) {
    return this.publicExamService.getPublicExam(examId);
  }

  @Get(':examId/manifest')
  async getManifest(@Param('examId') examId: string) {
    return this.publicExamService.getPublicManifest(examId);
  }

  @Get(':examId/group')
  async getGroupSnapshot(@Param('examId') examId: string) {
    return this.publicExamService.getPublicGroupSnapshot(examId);
  }

  @Get(':examId/submissions/:submissionId/finalized-grade')
  async getFinalizedGrade(
    @Param('examId') examId: string,
    @Param('submissionId') submissionId: string
  ) {
    return this.publicExamService.getFinalizedGrade(examId, submissionId);
  }

  @Post(':examId/submissions/presign-upload')
  async createPresignedSubmissionUpload(
    @Param('examId') examId: string,
    @Body() body: PresignUploadBody
  ) {
    if (!body.encryptedBlobHash || body.examVersion === undefined) {
      throw new BadRequestException(
        'encryptedBlobHash and examVersion are required'
      );
    }

    return this.submissionUploadService.createUploadUrl({
      encryptedBlobHash: body.encryptedBlobHash,
      examId,
      examVersion: body.examVersion
    });
  }

  @Post(':examId/submissions')
  async submitAnonymousExam(
    @Param('examId') examId: string,
    @Body() body: SubmissionBody
  ) {
    if (
      !body.answerCommitment ||
      !body.encryptedBlobHash ||
      !body.encryptedBlobUri ||
      body.examVersion === undefined ||
      !body.groupRoot ||
      !body.message ||
      !body.nullifierHash ||
      !body.proof ||
      !body.questionSetHash ||
      !body.scope
    ) {
      throw new BadRequestException('Missing required submission fields');
    }

    return this.submissionService.createSubmission({
      answerCommitment: body.answerCommitment,
      encryptedBlobHash: body.encryptedBlobHash,
      encryptedBlobUri: body.encryptedBlobUri,
      examId,
      examVersion: body.examVersion,
      groupRoot: body.groupRoot,
      message: body.message,
      nullifierHash: body.nullifierHash,
      proof: body.proof,
      questionSetHash: body.questionSetHash,
      scope: body.scope
    });
  }
}
