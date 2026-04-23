import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post
} from '@nestjs/common';
import type { SemaphoreProof } from './submission.service.js';
import { StudentClaimService } from './student-claim.service.js';

type ClaimBody = {
  identityCommitment?: string;
  message?: string;
  proof?: SemaphoreProof;
  scope?: string;
  submissionId?: string;
};

function requireStudentId(studentId: string | undefined) {
  if (!studentId?.trim()) {
    throw new BadRequestException('Missing x-student-id header');
  }

  return studentId;
}

@Controller('api/student/exams')
export class StudentClaimController {
  constructor(
    @Inject(StudentClaimService)
    private readonly studentClaimService: StudentClaimService
  ) {}

  @Post(':examId/claims')
  async claimGrade(
    @Param('examId') examId: string,
    @Headers('x-student-id') studentId: string | undefined,
    @Body() body: ClaimBody
  ) {
    if (
      !body.identityCommitment ||
      !body.message ||
      !body.proof ||
      !body.scope ||
      !body.submissionId
    ) {
      throw new BadRequestException('Missing claim fields');
    }

    return this.studentClaimService.claimGrade({
      examId,
      identityCommitment: body.identityCommitment,
      message: body.message,
      proof: body.proof,
      scope: body.scope,
      studentId: requireStudentId(studentId),
      submissionId: body.submissionId
    });
  }
}
