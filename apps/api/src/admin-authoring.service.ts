import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuestionBankEntryType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { ExamAuthoringImportFormat } from '@proofmark/shared';
import { PrismaService } from './prisma.service.js';
import {
  normalizeExamAuthoringBundle,
  normalizeQuestionBankEntry,
  parseImportBundle,
  serializeBundleAsJson
} from './authoring-utils.js';
import {
  commitAnswerKey,
  hashGradingPolicy,
  hashQuestionSet
} from './manifest-utils.js';

function asJsonValue(value: unknown) {
  return value as never;
}

function normalizeJsonArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

@Injectable()
export class AdminAuthoringService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listExams() {
    return this.prisma.exam.findMany({
      orderBy: [{ createdAt: 'desc' }],
      select: {
        courseId: true,
        createdAt: true,
        currentGroupRoot: true,
        endsAt: true,
        id: true,
        questionSetHash: true,
        startsAt: true,
        status: true,
        title: true,
        updatedAt: true
      }
    });
  }

  async exportExamBundle(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        answerKeyData: true,
        courseId: true,
        endsAt: true,
        gradingPolicyData: true,
        id: true,
        questionSetData: true,
        startsAt: true,
        title: true
      }
    });

    if (
      !exam ||
      !exam.questionSetData ||
      !exam.answerKeyData ||
      !exam.gradingPolicyData
    ) {
      throw new NotFoundException('Exam authoring bundle not found');
    }

    const bundle = normalizeExamAuthoringBundle({
      answerKey: exam.answerKeyData,
      exam: {
        courseId: exam.courseId,
        endsAt: exam.endsAt?.toISOString() ?? null,
        startsAt: exam.startsAt?.toISOString() ?? null,
        title: exam.title
      },
      gradingPolicy: exam.gradingPolicyData,
      questionSet: exam.questionSetData
    });

    return {
      bundle,
      downloadFileName: `proofmark-exam-${exam.id}.json`,
      json: serializeBundleAsJson(bundle)
    };
  }

  previewImport(params: {
    content: string;
    format: ExamAuthoringImportFormat;
  }) {
    const bundle = parseImportBundle(params);
    const answerKeySalt = randomBytes(16).toString('hex');

    return {
      answerKeyCommitment: commitAnswerKey({
        answerKey: bundle.answerKey,
        salt: answerKeySalt
      }),
      answerKeySalt,
      bundle,
      questionCounts: {
        mcq: bundle.questionSet.questions.length,
        subjective: bundle.questionSet.subjectiveQuestions?.length ?? 0
      },
      gradingPolicyHash: hashGradingPolicy(bundle.gradingPolicy),
      questionSetHash: hashQuestionSet(bundle.questionSet)
    };
  }

  async listTemplates() {
    return this.prisma.examTemplate.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        courseId: true,
        createdAt: true,
        description: true,
        gradingPolicyHash: true,
        id: true,
        questionSetHash: true,
        title: true,
        updatedAt: true
      }
    });
  }

  async getTemplate(templateId: string) {
    const template = await this.prisma.examTemplate.findUnique({
      where: {
        id: templateId
      }
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return {
      bundle: normalizeExamAuthoringBundle({
        answerKey: template.answerKeyData,
        exam: {
          courseId: template.courseId,
          title: template.title
        },
        gradingPolicy: template.gradingPolicyData,
        questionSet: template.questionSetData
      }),
      description: template.description,
      id: template.id,
      title: template.title
    };
  }

  async createTemplate(params: {
    adminId: string;
    bundle: unknown;
    description?: string | null;
    title?: string | null;
  }) {
    const bundle = normalizeExamAuthoringBundle(params.bundle);
    const title = params.title?.trim() || bundle.exam.title;
    const template = await this.prisma.examTemplate.create({
      data: {
        answerKeyData: asJsonValue(bundle.answerKey),
        courseId: bundle.exam.courseId,
        createdByRef: params.adminId,
        description: params.description?.trim() || null,
        gradingPolicyData: asJsonValue(bundle.gradingPolicy),
        gradingPolicyHash: hashGradingPolicy(bundle.gradingPolicy),
        questionSetData: asJsonValue(bundle.questionSet),
        questionSetHash: hashQuestionSet(bundle.questionSet),
        title
      }
    });

    return {
      id: template.id,
      title: template.title
    };
  }

  async listQuestionBank() {
    const entries = await this.prisma.questionBankEntry.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        answerData: true,
        createdAt: true,
        id: true,
        questionData: true,
        questionHash: true,
        questionType: true,
        tags: true,
        title: true,
        updatedAt: true
      }
    });

    return entries.map((entry) => ({
      createdAt: entry.createdAt,
      id: entry.id,
      questionHash: entry.questionHash,
      tags: normalizeJsonArray(entry.tags),
      title: entry.title,
      type:
        entry.questionType === QuestionBankEntryType.MCQ ? 'mcq' : 'subjective',
      updatedAt: entry.updatedAt,
      value:
        entry.questionType === QuestionBankEntryType.MCQ
          ? {
              ...(entry.questionData as Record<string, unknown>),
              correctChoiceId:
                (entry.answerData as Record<string, unknown> | null)
                  ?.correctChoiceId ?? '',
              type: 'mcq'
            }
          : {
              ...(entry.questionData as Record<string, unknown>),
              type: 'subjective'
            }
    }));
  }

  async createQuestionBankEntry(params: { adminId: string; entry: unknown }) {
    const normalizedEntry = normalizeQuestionBankEntry(params.entry);
    const questionHash = hashQuestionSet({
      value: normalizedEntry.value
    });
    const created = await this.prisma.questionBankEntry.create({
      data: {
        answerData:
          normalizedEntry.value.type === 'mcq'
            ? asJsonValue({
                correctChoiceId: normalizedEntry.value.correctChoiceId
              })
            : Prisma.DbNull,
        createdByRef: params.adminId,
        questionData:
          normalizedEntry.value.type === 'mcq'
            ? asJsonValue({
                choices: normalizedEntry.value.choices,
                id: normalizedEntry.value.id,
                prompt: normalizedEntry.value.prompt
              })
            : asJsonValue({
                id: normalizedEntry.value.id,
                maxScore: normalizedEntry.value.maxScore,
                prompt: normalizedEntry.value.prompt,
                rubricHash: normalizedEntry.value.rubricHash
              }),
        questionHash,
        questionType:
          normalizedEntry.value.type === 'mcq'
            ? QuestionBankEntryType.MCQ
            : QuestionBankEntryType.SUBJECTIVE,
        tags: asJsonValue(normalizedEntry.tags),
        title: normalizedEntry.title
      }
    });

    return {
      id: created.id,
      questionHash,
      title: created.title
    };
  }
}
