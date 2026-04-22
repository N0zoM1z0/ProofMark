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

type SubmissionBody = {
  answerCommitment?: string;
  encryptedBlobHash?: string;
  encryptedBlobUri?: string;
  groupRoot?: string;
  message?: string;
  nullifierHash?: string;
  proof?: SemaphoreProof;
  questionSetHash?: string;
  scope?: string;
};

@Controller('api/public/exams')
export class PublicExamController {
  constructor(
    private readonly publicExamService: PublicExamService,
    private readonly submissionService: SubmissionService
  ) {}

  @Get(':examId')
  async getExam(@Param('examId') examId: string) {
    return this.publicExamService.getPublicExam(examId);
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
      groupRoot: body.groupRoot,
      message: body.message,
      nullifierHash: body.nullifierHash,
      proof: body.proof,
      questionSetHash: body.questionSetHash,
      scope: body.scope
    });
  }
}
