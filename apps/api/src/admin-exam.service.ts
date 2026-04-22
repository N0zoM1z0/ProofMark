import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ExamStatus } from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import {
  buildPublicExamManifest,
  commitAnswerKey,
  getManifestPublicKeyPem,
  hashGradingPolicy,
  hashQuestionSet,
  signManifestPayload
} from './manifest-utils.js';
import { canonicalJson, sha256Hex } from './submission-utils.js';

type ExamSummary = {
  id: string;
  title: string;
  courseId: string | null;
  status: ExamStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  questionSetHash: string | null;
  answerKeyCommitment: string | null;
  gradingPolicyHash: string | null;
  currentGroupRoot: string | null;
};

type AuditEventClient = {
  count(args: { where: { examId: string } }): Promise<number>;
  create(args: {
    data: {
      examId: string;
      seq: number;
      eventType: string;
      actorRole: string;
      actorPseudonym?: string | null;
      payloadHash: string;
      prevEventHash?: string | null;
      eventHash: string;
      createdAt: Date;
    };
  }): Promise<{ id: string; eventHash: string; createdAt: Date }>;
  findFirst(args: {
    where: { examId: string };
    orderBy: { seq: 'desc' };
  }): Promise<{ eventHash: string } | null>;
};

type TransactionClient = {
  auditEvent: AuditEventClient;
};

function normalizeOptionalDate(value: string | Date | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalizedValue = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(normalizedValue.getTime())) {
    throw new BadRequestException('Invalid ISO date');
  }

  return normalizedValue;
}

function validateExamWindow(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined
) {
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new BadRequestException('startsAt must be before endsAt');
  }
}

function validateDraftMutation(exam: ExamSummary, fieldName: string) {
  if (exam.status !== ExamStatus.DRAFT) {
    throw new ConflictException(`${fieldName} can only be changed while exam is DRAFT`);
  }
}

function assertTransition(exam: ExamSummary, nextStatus: ExamStatus) {
  if (nextStatus === ExamStatus.COMMITTED) {
    if (exam.status !== ExamStatus.DRAFT) {
      throw new ConflictException('Exam must be DRAFT before commit');
    }

    if (
      !exam.questionSetHash ||
      !exam.answerKeyCommitment ||
      !exam.gradingPolicyHash
    ) {
      throw new ConflictException(
        'COMMITTED requires question set, answer key commitment, and grading policy hashes'
      );
    }

    return;
  }

  if (nextStatus === ExamStatus.REGISTRATION) {
    if (exam.status !== ExamStatus.COMMITTED) {
      throw new ConflictException('Exam must be COMMITTED before registration opens');
    }

    return;
  }

  if (nextStatus === ExamStatus.PUBLISHED) {
    if (exam.status !== ExamStatus.REGISTRATION) {
      throw new ConflictException('Exam must be REGISTRATION before publish');
    }

    if (
      !exam.questionSetHash ||
      !exam.answerKeyCommitment ||
      !exam.gradingPolicyHash ||
      !exam.currentGroupRoot
    ) {
      throw new ConflictException(
        'PUBLISHED requires committed hashes and a current group root'
      );
    }

    return;
  }

  if (nextStatus === ExamStatus.OPEN) {
    if (exam.status !== ExamStatus.PUBLISHED) {
      throw new ConflictException('Exam must be PUBLISHED before open');
    }

    if (!exam.currentGroupRoot || !exam.startsAt || !exam.endsAt) {
      throw new ConflictException(
        'OPEN requires a published group root and configured exam window'
      );
    }

    validateExamWindow(exam.startsAt, exam.endsAt);
  }
}

function actorPseudonym(actorRef: string) {
  return sha256Hex(`admin:${actorRef}`).slice(0, 16);
}

async function appendAuditEvent(
  tx: TransactionClient,
  params: {
    examId: string;
    actorRef: string;
    actorRole: string;
    eventType: string;
    payload: Record<string, unknown>;
    createdAt?: Date;
  }
) {
  const createdAt = params.createdAt ?? new Date();
  const seq =
    (await tx.auditEvent.count({
      where: {
        examId: params.examId
      }
    })) + 1;
  const previousAuditEvent = await tx.auditEvent.findFirst({
    where: {
      examId: params.examId
    },
    orderBy: {
      seq: 'desc'
    }
  });
  const payloadHash = sha256Hex(canonicalJson(params.payload));
  const eventHash = sha256Hex(
    canonicalJson({
      actorPseudonym: actorPseudonym(params.actorRef),
      actorRole: params.actorRole,
      createdAt: createdAt.toISOString(),
      eventType: params.eventType,
      examId: params.examId,
      payloadHash,
      prevEventHash: previousAuditEvent?.eventHash ?? null,
      seq
    })
  );

  return tx.auditEvent.create({
    data: {
      actorPseudonym: actorPseudonym(params.actorRef),
      actorRole: params.actorRole,
      createdAt,
      eventHash,
      eventType: params.eventType,
      examId: params.examId,
      payloadHash,
      prevEventHash: previousAuditEvent?.eventHash ?? null,
      seq
    }
  });
}

@Injectable()
export class AdminExamService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async getExamOrThrow(examId: string): Promise<ExamSummary> {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        answerKeyCommitment: true,
        courseId: true,
        currentGroupRoot: true,
        endsAt: true,
        gradingPolicyHash: true,
        id: true,
        questionSetHash: true,
        startsAt: true,
        status: true,
        title: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    return exam;
  }

  async createExam(params: {
    title: string;
    courseId?: string | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    adminId: string;
  }) {
    const startsAt = normalizeOptionalDate(params.startsAt);
    const endsAt = normalizeOptionalDate(params.endsAt);

    validateExamWindow(startsAt ?? null, endsAt ?? null);

    return this.prisma.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          courseId: params.courseId ?? null,
          createdByRef: params.adminId,
          endsAt: endsAt ?? null,
          startsAt: startsAt ?? null,
          title: params.title.trim()
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamCreated',
        examId: exam.id,
        payload: {
          courseId: exam.courseId,
          endsAt: exam.endsAt?.toISOString() ?? null,
          startsAt: exam.startsAt?.toISOString() ?? null,
          title: exam.title
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam
      };
    });
  }

  async updateExam(params: {
    examId: string;
    title?: string;
    courseId?: string | null;
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
    adminId: string;
  }) {
    const exam = await this.getExamOrThrow(params.examId);

    if (exam.status === ExamStatus.PUBLISHED || exam.status === ExamStatus.OPEN) {
      throw new ConflictException('Published exams cannot change manifest metadata');
    }

    const startsAt =
      params.startsAt === undefined
        ? exam.startsAt
        : normalizeOptionalDate(params.startsAt) ?? null;
    const endsAt =
      params.endsAt === undefined ? exam.endsAt : normalizeOptionalDate(params.endsAt) ?? null;

    validateExamWindow(startsAt, endsAt);

    return this.prisma.$transaction(async (tx) => {
      const updatedExam = await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          courseId: params.courseId === undefined ? exam.courseId : params.courseId,
          endsAt,
          startsAt,
          title: params.title === undefined ? exam.title : params.title.trim()
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamMetadataUpdated',
        examId: params.examId,
        payload: {
          courseId: updatedExam.courseId,
          endsAt: updatedExam.endsAt?.toISOString() ?? null,
          startsAt: updatedExam.startsAt?.toISOString() ?? null,
          title: updatedExam.title
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam: updatedExam
      };
    });
  }

  async setQuestionSet(params: {
    examId: string;
    questionSet: unknown;
    adminId: string;
  }) {
    const exam = await this.getExamOrThrow(params.examId);

    validateDraftMutation(exam, 'questionSet');

    const questionSetHash = hashQuestionSet(params.questionSet);

    return this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          questionSetHash
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'QuestionSetHashed',
        examId: params.examId,
        payload: {
          questionSetHash
        }
      });

      return {
        auditEventId: auditEvent.id,
        examId: params.examId,
        questionSetHash
      };
    });
  }

  async setAnswerKeyCommitment(params: {
    examId: string;
    answerKey: unknown;
    salt: string;
    adminId: string;
  }) {
    const exam = await this.getExamOrThrow(params.examId);

    validateDraftMutation(exam, 'answerKeyCommitment');

    if (!params.salt.trim()) {
      throw new BadRequestException('salt is required');
    }

    const answerKeyCommitment = commitAnswerKey({
      answerKey: params.answerKey,
      salt: params.salt
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          answerKeyCommitment
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'AnswerKeyCommitted',
        examId: params.examId,
        payload: {
          answerKeyCommitment
        }
      });

      return {
        answerKeyCommitment,
        auditEventId: auditEvent.id,
        examId: params.examId
      };
    });
  }

  async setGradingPolicy(params: {
    examId: string;
    gradingPolicy: unknown;
    adminId: string;
  }) {
    const exam = await this.getExamOrThrow(params.examId);

    validateDraftMutation(exam, 'gradingPolicy');

    const gradingPolicyHash = hashGradingPolicy(params.gradingPolicy);

    return this.prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          gradingPolicyHash
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'GradingPolicyHashed',
        examId: params.examId,
        payload: {
          gradingPolicyHash
        }
      });

      return {
        auditEventId: auditEvent.id,
        examId: params.examId,
        gradingPolicyHash
      };
    });
  }

  async commitExam(params: { examId: string; adminId: string }) {
    const exam = await this.getExamOrThrow(params.examId);

    assertTransition(exam, ExamStatus.COMMITTED);

    return this.prisma.$transaction(async (tx) => {
      const latestVersion = await tx.examVersion.findFirst({
        where: {
          examId: params.examId
        },
        orderBy: {
          version: 'desc'
        }
      });
      const nextVersion = (latestVersion?.version ?? 0) + 1;
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamCommitted',
        examId: params.examId,
        payload: {
          answerKeyCommitment: exam.answerKeyCommitment,
          examVersion: nextVersion,
          gradingPolicyHash: exam.gradingPolicyHash,
          questionSetHash: exam.questionSetHash
        }
      });
      const version = await tx.examVersion.create({
        data: {
          auditEventId: auditEvent.id,
          examId: params.examId,
          policyHash: exam.gradingPolicyHash!,
          questionSetHash: exam.questionSetHash!,
          version: nextVersion
        }
      });
      const updatedExam = await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.COMMITTED
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam: updatedExam,
        examVersion: version.version
      };
    });
  }

  async openRegistration(params: { examId: string; adminId: string }) {
    const exam = await this.getExamOrThrow(params.examId);

    assertTransition(exam, ExamStatus.REGISTRATION);

    return this.prisma.$transaction(async (tx) => {
      const updatedExam = await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.REGISTRATION
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamRegistrationOpened',
        examId: params.examId,
        payload: {
          status: updatedExam.status
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam: updatedExam
      };
    });
  }

  async publishExam(params: { examId: string; adminId: string }) {
    const exam = await this.getExamOrThrow(params.examId);

    assertTransition(exam, ExamStatus.PUBLISHED);

    return this.prisma.$transaction(async (tx) => {
      const latestVersion = await tx.examVersion.findFirst({
        where: {
          examId: params.examId
        },
        orderBy: {
          version: 'desc'
        }
      });

      if (!latestVersion) {
        throw new ConflictException('Exam must be committed before publish');
      }

      const { manifest, manifestHash } = buildPublicExamManifest({
        answerKeyCommitment: exam.answerKeyCommitment!,
        courseId: exam.courseId,
        currentGroupRoot: exam.currentGroupRoot!,
        endsAt: exam.endsAt,
        examId: exam.id,
        examVersion: latestVersion.version,
        gradingPolicyHash: exam.gradingPolicyHash!,
        questionSetHash: exam.questionSetHash!,
        startsAt: exam.startsAt,
        title: exam.title
      });
      const serverSignature = signManifestPayload(manifest);
      const updatedExam = await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.PUBLISHED
        }
      });
      await tx.examVersion.update({
        where: {
          id: latestVersion.id
        },
        data: {
          manifestHash
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamPublished',
        examId: params.examId,
        payload: {
          currentGroupRoot: exam.currentGroupRoot,
          examVersion: latestVersion.version,
          manifestHash,
          status: updatedExam.status
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam: updatedExam,
        manifest,
        manifestHash,
        serverPublicKey: getManifestPublicKeyPem(),
        serverSignature
      };
    });
  }

  async openExam(params: { examId: string; adminId: string }) {
    const exam = await this.getExamOrThrow(params.examId);

    assertTransition(exam, ExamStatus.OPEN);

    return this.prisma.$transaction(async (tx) => {
      const updatedExam = await tx.exam.update({
        where: {
          id: params.examId
        },
        data: {
          status: ExamStatus.OPEN
        }
      });
      const auditEvent = await appendAuditEvent(tx, {
        actorRef: params.adminId,
        actorRole: 'ADMIN',
        eventType: 'ExamOpened',
        examId: params.examId,
        payload: {
          endsAt: updatedExam.endsAt?.toISOString() ?? null,
          startsAt: updatedExam.startsAt?.toISOString() ?? null,
          status: updatedExam.status
        }
      });

      return {
        auditEventId: auditEvent.id,
        exam: updatedExam
      };
    });
  }
}
