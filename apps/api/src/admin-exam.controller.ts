import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Put
} from '@nestjs/common';
import { AdminExamService } from './admin-exam.service.js';

type CreateExamBody = {
  title?: string;
  courseId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

type UpdateExamBody = {
  title?: string;
  courseId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

type QuestionSetBody = {
  questionSet?: unknown;
};

type AnswerKeyBody = {
  answerKey?: unknown;
  salt?: string;
};

type GradingPolicyBody = {
  gradingPolicy?: unknown;
};

function requireAdminId(adminId: string | undefined) {
  if (!adminId?.trim()) {
    throw new BadRequestException('Missing x-admin-id header');
  }

  return adminId;
}

@Controller('api/admin/exams')
export class AdminExamController {
  constructor(
    @Inject(AdminExamService)
    private readonly adminExamService: AdminExamService
  ) {}

  @Post()
  async createExam(
    @Headers('x-admin-id') adminId: string | undefined,
    @Body() body: CreateExamBody
  ) {
    if (!body.title?.trim()) {
      throw new BadRequestException('title is required');
    }

    return this.adminExamService.createExam({
      adminId: requireAdminId(adminId),
      courseId: body.courseId,
      endsAt: body.endsAt,
      startsAt: body.startsAt,
      title: body.title
    });
  }

  @Patch(':examId')
  async updateExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Body() body: UpdateExamBody
  ) {
    return this.adminExamService.updateExam({
      adminId: requireAdminId(adminId),
      courseId: body.courseId,
      endsAt: body.endsAt,
      examId,
      startsAt: body.startsAt,
      title: body.title
    });
  }

  @Put(':examId/question-set')
  async setQuestionSet(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Body() body: QuestionSetBody
  ) {
    if (body.questionSet === undefined) {
      throw new BadRequestException('questionSet is required');
    }

    return this.adminExamService.setQuestionSet({
      adminId: requireAdminId(adminId),
      examId,
      questionSet: body.questionSet
    });
  }

  @Put(':examId/answer-key-commitment')
  async setAnswerKeyCommitment(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Body() body: AnswerKeyBody
  ) {
    if (body.answerKey === undefined || !body.salt) {
      throw new BadRequestException('answerKey and salt are required');
    }

    return this.adminExamService.setAnswerKeyCommitment({
      adminId: requireAdminId(adminId),
      answerKey: body.answerKey,
      examId,
      salt: body.salt
    });
  }

  @Put(':examId/grading-policy')
  async setGradingPolicy(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Body() body: GradingPolicyBody
  ) {
    if (body.gradingPolicy === undefined) {
      throw new BadRequestException('gradingPolicy is required');
    }

    return this.adminExamService.setGradingPolicy({
      adminId: requireAdminId(adminId),
      examId,
      gradingPolicy: body.gradingPolicy
    });
  }

  @Post(':examId/commit')
  async commitExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.commitExam({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/registration')
  async openRegistration(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.openRegistration({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/publish')
  async publishExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.publishExam({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/open')
  async openExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.openExam({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/close')
  async closeExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.closeExam({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/grading')
  async startGrading(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.startGrading({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/finalize')
  async finalizeExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.finalizeExam({
      adminId: requireAdminId(adminId),
      examId
    });
  }

  @Post(':examId/claiming')
  async openClaiming(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined
  ) {
    return this.adminExamService.openClaiming({
      adminId: requireAdminId(adminId),
      examId
    });
  }
}
