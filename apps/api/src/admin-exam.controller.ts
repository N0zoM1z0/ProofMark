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
import { AdminAuthService } from './admin-auth.service.js';
import { AdminExamService } from './admin-exam.service.js';
import { MarkingService } from './marking.service.js';

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

type EnrollMarkerBody = {
  markerLabel?: string;
  markerRef?: string | null;
};

type GenerateAssignmentsBody = {
  dueAt?: string | null;
  seed?: string;
};

@Controller('api/admin/exams')
export class AdminExamController {
  constructor(
    @Inject(AdminAuthService)
    private readonly adminAuthService: AdminAuthService,
    @Inject(AdminExamService)
    private readonly adminExamService: AdminExamService,
    @Inject(MarkingService)
    private readonly markingService: MarkingService
  ) {}

  private authorizeAdmin(adminId: string | undefined, mfaCode: string | undefined) {
    return this.adminAuthService.authorize({
      adminId,
      mfaCode
    });
  }

  @Post()
  async createExam(
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: CreateExamBody
  ) {
    if (!body.title?.trim()) {
      throw new BadRequestException('title is required');
    }

    return this.adminExamService.createExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
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
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: UpdateExamBody
  ) {
    return this.adminExamService.updateExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
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
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: QuestionSetBody
  ) {
    if (body.questionSet === undefined) {
      throw new BadRequestException('questionSet is required');
    }

    return this.adminExamService.setQuestionSet({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId,
      questionSet: body.questionSet
    });
  }

  @Put(':examId/answer-key-commitment')
  async setAnswerKeyCommitment(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: AnswerKeyBody
  ) {
    if (body.answerKey === undefined || !body.salt) {
      throw new BadRequestException('answerKey and salt are required');
    }

    return this.adminExamService.setAnswerKeyCommitment({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      answerKey: body.answerKey,
      examId,
      salt: body.salt
    });
  }

  @Put(':examId/grading-policy')
  async setGradingPolicy(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: GradingPolicyBody
  ) {
    if (body.gradingPolicy === undefined) {
      throw new BadRequestException('gradingPolicy is required');
    }

    return this.adminExamService.setGradingPolicy({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId,
      gradingPolicy: body.gradingPolicy
    });
  }

  @Post(':examId/commit')
  async commitExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.commitExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/registration')
  async openRegistration(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.openRegistration({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/publish')
  async publishExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.publishExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/open')
  async openExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.openExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/close')
  async closeExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.closeExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/grading')
  async startGrading(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.startGrading({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/finalize')
  async finalizeExam(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.finalizeExam({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/claiming')
  async openClaiming(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined
  ) {
    return this.adminExamService.openClaiming({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId
    });
  }

  @Post(':examId/markers')
  async enrollMarker(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: EnrollMarkerBody
  ) {
    if (!body.markerLabel?.trim()) {
      throw new BadRequestException('markerLabel is required');
    }

    return this.markingService.enrollMarker({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      examId,
      markerLabel: body.markerLabel,
      markerRef: body.markerRef
    });
  }

  @Post(':examId/assignments')
  async generateAssignments(
    @Param('examId') examId: string,
    @Headers('x-admin-id') adminId: string | undefined,
    @Headers('x-admin-mfa-code') mfaCode: string | undefined,
    @Body() body: GenerateAssignmentsBody
  ) {
    if (!body.seed?.trim()) {
      throw new BadRequestException('seed is required');
    }

    return this.markingService.generateAssignments({
      adminId: this.authorizeAdmin(adminId, mfaCode),
      dueAt: body.dueAt,
      examId,
      seed: body.seed
    });
  }
}
