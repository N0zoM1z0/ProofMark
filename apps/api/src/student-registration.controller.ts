import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post
} from '@nestjs/common';
import { StudentRegistrationService } from './student-registration.service.js';

type RegisterCommitmentBody = {
  identityCommitment?: string;
};

@Controller('api/student/exams')
export class StudentRegistrationController {
  constructor(
    private readonly studentRegistrationService: StudentRegistrationService
  ) {}

  @Post(':examId/register-commitment')
  async registerCommitment(
    @Param('examId') examId: string,
    @Body() body: RegisterCommitmentBody,
    @Headers('x-student-id') studentId?: string
  ) {
    if (!studentId) {
      throw new BadRequestException('x-student-id header is required for mock auth');
    }

    if (!body.identityCommitment) {
      throw new BadRequestException('identityCommitment is required');
    }

    return this.studentRegistrationService.registerCommitment({
      examId,
      identityCommitment: body.identityCommitment,
      studentId
    });
  }
}
