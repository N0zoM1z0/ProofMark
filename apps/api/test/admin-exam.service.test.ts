import { ConflictException } from '@nestjs/common';
import { ExamStatus, SubmissionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminExamService } from '../src/admin-exam.service.js';
import { verifyManifestSignature } from '../src/manifest-utils.js';

type ExamRecord = {
  id: string;
  title: string;
  courseId: string | null;
  status: ExamStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  questionSetData: unknown | null;
  questionSetHash: string | null;
  answerKeyData: unknown | null;
  answerKeySalt: string | null;
  answerKeyCommitment: string | null;
  gradingPolicyData: unknown | null;
  gradingPolicyHash: string | null;
  currentGroupRoot: string | null;
  createdByRef: string;
};

type ExamVersionRecord = {
  id: string;
  examId: string;
  version: number;
  questionSetData: unknown | null;
  questionSetHash: string;
  answerKeyData: unknown | null;
  answerKeySalt: string | null;
  gradingPolicyData: unknown | null;
  policyHash: string;
  manifestHash: string | null;
  auditEventId: string | null;
  createdAt: Date;
};

type AuditEventRecord = {
  id: string;
  examId: string;
  seq: number;
  eventHash: string;
  createdAt: Date;
};

type SubmissionRecord = {
  id: string;
  examId: string;
  status: SubmissionStatus;
};

function createPrismaMock() {
  const exams: ExamRecord[] = [];
  const versions: ExamVersionRecord[] = [];
  const auditEvents: AuditEventRecord[] = [];
  const submissions: SubmissionRecord[] = [];

  const tx = {
    auditEvent: {
      count: async ({ where }: { where: { examId: string } }) =>
        auditEvents.filter((item) => item.examId === where.examId).length,
      create: async ({ data }: { data: Omit<AuditEventRecord, 'id'> }) => {
        const event = {
          id: `audit-${auditEvents.length + 1}`,
          ...data
        };
        auditEvents.push(event);
        return event;
      },
      findFirst: async ({ where }: { where: { examId: string } }) =>
        auditEvents
          .filter((item) => item.examId === where.examId)
          .sort((left, right) => right.seq - left.seq)[0] ?? null
    },
    exam: {
      create: async ({ data }: { data: Partial<ExamRecord> }) => {
        const exam: ExamRecord = {
          answerKeyData: null,
          answerKeySalt: null,
          answerKeyCommitment: null,
          courseId: null,
          createdByRef: data.createdByRef!,
          currentGroupRoot: null,
          endsAt: data.endsAt ?? null,
          gradingPolicyData: null,
          gradingPolicyHash: null,
          id: `exam-${exams.length + 1}`,
          questionSetData: null,
          questionSetHash: null,
          startsAt: data.startsAt ?? null,
          status: ExamStatus.DRAFT,
          title: data.title!,
          ...data
        };
        exams.push(exam);
        return exam;
      },
      findUnique: async ({
        where,
        select
      }: {
        where: { id: string };
        select?: Record<string, boolean>;
      }) => {
        const exam = exams.find((item) => item.id === where.id) ?? null;

        if (!exam || !select) {
          return exam;
        }

        return Object.fromEntries(
          Object.keys(select).map((key) => [key, exam[key as keyof ExamRecord]])
        );
      },
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<ExamRecord>;
      }) => {
        const exam = exams.find((item) => item.id === where.id)!;
        Object.assign(exam, data);
        return exam;
      }
    },
    examVersion: {
      create: async ({ data }: { data: Omit<ExamVersionRecord, 'id' | 'createdAt'> }) => {
        const version: ExamVersionRecord = {
          answerKeyData: null,
          answerKeySalt: null,
          createdAt: new Date(),
          gradingPolicyData: null,
          id: `version-${versions.length + 1}`,
          manifestHash: null,
          questionSetData: null,
          ...data
        };
        versions.push(version);
        return version;
      },
      findFirst: async ({ where }: { where: { examId: string } }) =>
        versions
          .filter((item) => item.examId === where.examId)
          .sort((left, right) => right.version - left.version)[0] ?? null,
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<ExamVersionRecord>;
      }) => {
        const version = versions.find((item) => item.id === where.id)!;
        Object.assign(version, data);
        return version;
      }
    },
    submission: {
      count: async ({
        where
      }: {
        where: { examId: string; status?: SubmissionStatus };
      }) =>
        submissions.filter(
          (item) =>
            item.examId === where.examId &&
            (where.status === undefined || item.status === where.status)
        ).length
    }
  };

  return {
    auditEvents,
    prisma: {
      $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) =>
        callback(tx),
      exam: tx.exam,
      submission: tx.submission
    },
    submissions,
    versions
  };
}

describe('AdminExamService', () => {
  let service: AdminExamService;
  let prismaMock: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    service = new AdminExamService(prismaMock.prisma as never);
  });

  it('blocks commit before required commitments exist', async () => {
    const created = await service.createExam({
      adminId: 'admin-1',
      title: 'Phase 5 Exam'
    });

    await expect(
      service.commitExam({
        adminId: 'admin-1',
        examId: created.exam.id
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates, commits, publishes, and opens an exam with a verifiable manifest', async () => {
    const created = await service.createExam({
      adminId: 'admin-1',
      courseId: 'cs101',
      endsAt: '2026-04-22T11:00:00.000Z',
      startsAt: '2026-04-22T10:00:00.000Z',
      title: 'ProofMark Midterm'
    });
    const examId = created.exam.id;

    const questionSet = await service.setQuestionSet({
      adminId: 'admin-1',
      examId,
      questionSet: {
        questions: [
          {
            choices: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
              { id: 'c', label: 'C' }
            ],
            id: 'q1',
            prompt: 'Pick A'
          }
        ],
        title: 'ProofMark Midterm'
      }
    });
    const answerKey = await service.setAnswerKeyCommitment({
      adminId: 'admin-1',
      answerKey: {
        q1: 'a'
      },
      examId,
      salt: 'phase-5'
    });
    const gradingPolicy = await service.setGradingPolicy({
      adminId: 'admin-1',
      examId,
      gradingPolicy: {
        pointsPerQuestion: 2
      }
    });

    expect(questionSet.questionSetHash).toMatch(/^sha256:/);
    expect(answerKey.answerKeyCommitment).toMatch(/^sha256:/);
    expect(gradingPolicy.gradingPolicyHash).toMatch(/^sha256:/);

    const committed = await service.commitExam({
      adminId: 'admin-1',
      examId
    });
    expect(committed.exam.status).toBe(ExamStatus.COMMITTED);
    expect(committed.examVersion).toBe(1);

    const registration = await service.openRegistration({
      adminId: 'admin-1',
      examId
    });
    expect(registration.exam.status).toBe(ExamStatus.REGISTRATION);

    await prismaMock.prisma.exam.update({
      where: {
        id: examId
      },
      data: {
        currentGroupRoot: '987654321'
      }
    });

    const published = await service.publishExam({
      adminId: 'admin-1',
      examId
    });
    expect(published.exam.status).toBe(ExamStatus.PUBLISHED);
    expect(published.manifestHash).toMatch(/^sha256:/);
    expect(
      verifyManifestSignature({
        manifest: published.manifest,
        serverPublicKey: published.serverPublicKey,
        serverSignature: published.serverSignature
      })
    ).toBe(true);
    expect(JSON.stringify(published.manifest)).not.toContain('"q1":"A"');

    const opened = await service.openExam({
      adminId: 'admin-1',
      examId
    });
    expect(opened.exam.status).toBe(ExamStatus.OPEN);
    expect(prismaMock.versions[0]?.manifestHash).toBe(published.manifestHash);
    expect(prismaMock.auditEvents).toHaveLength(8);
  });

  it('closes an open exam and starts grading once submissions exist', async () => {
    const created = await service.createExam({
      adminId: 'admin-1',
      endsAt: '2026-04-22T11:00:00.000Z',
      startsAt: '2026-04-22T10:00:00.000Z',
      title: 'ProofMark Phase 7'
    });
    const examId = created.exam.id;

    await prismaMock.prisma.exam.update({
      where: {
        id: examId
      },
      data: {
        status: ExamStatus.OPEN
      }
    });

    const closed = await service.closeExam({
      adminId: 'admin-1',
      examId
    });
    expect(closed.exam.status).toBe(ExamStatus.CLOSED);

    prismaMock.submissions.push({
      examId,
      id: 'submission-1',
      status: SubmissionStatus.ACCEPTED
    });

    const grading = await service.startGrading({
      adminId: 'admin-1',
      examId
    });
    expect(grading.exam.status).toBe(ExamStatus.GRADING);
  });
});
