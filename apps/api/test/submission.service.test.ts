import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExamStatus, SubmissionStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionService, type SemaphoreProof } from '../src/submission.service.js';
import { computeSubmissionMessage, computeSubmitScope } from '../src/submission-utils.js';

vi.mock('@semaphore-protocol/proof', () => ({
  verifyProof: vi.fn(async () => true)
}));

type ExamRecord = {
  id: string;
  status: ExamStatus;
  currentGroupRoot: string;
  questionSetHash: string;
  versions: Array<{
    version: number;
  }>;
};

type SubmissionRecord = {
  id: string;
  examId: string;
  nullifierHash: string;
  messageHash: string;
  answerCommitment: string;
  encryptedBlobHash: string;
  encryptedBlobUri: string;
  groupRoot: string;
  submissionIndex: number;
  submittedAtBucket: string;
  status: SubmissionStatus;
  auditEventId?: string | null;
  receiptHash?: string | null;
};

type AuditEventRecord = {
  id: string;
  examId: string;
  seq: number;
  eventHash: string;
};

function createPrismaMock(exam: ExamRecord) {
  const submissions: SubmissionRecord[] = [];
  const auditEvents: AuditEventRecord[] = [];

  const tx = {
    auditEvent: {
      count: vi.fn(async ({ where }: { where: { examId: string } }) =>
        auditEvents.filter((item) => item.examId === where.examId).length
      ),
      create: vi.fn(async ({ data }: { data: Omit<AuditEventRecord, 'id'> }) => {
        const auditEvent = {
          id: `audit-${auditEvents.length + 1}`,
          ...data
        };
        auditEvents.push(auditEvent);
        return auditEvent;
      }),
      findFirst: vi.fn(async ({ where }: { where: { examId: string } }) =>
        auditEvents
          .filter((item) => item.examId === where.examId)
          .sort((left, right) => right.seq - left.seq)[0] ?? null
      ),
      findMany: vi.fn(async ({ where }: { where: { examId: string } }) =>
        auditEvents
          .filter((item) => item.examId === where.examId)
          .sort((left, right) => left.seq - right.seq)
      )
    },
    submission: {
      count: vi.fn(async ({ where }: { where: { examId: string } }) =>
        submissions.filter((item) => item.examId === where.examId).length
      ),
      create: vi.fn(async ({ data }: { data: Omit<SubmissionRecord, 'id'> }) => {
        const submission = {
          id: `submission-${submissions.length + 1}`,
          ...data
        };
        submissions.push(submission);
        return submission;
      }),
      findUnique: vi.fn(
        async ({
          where
        }: {
          where: { examId_nullifierHash: { examId: string; nullifierHash: string } };
        }) =>
          submissions.find(
            (item) =>
              item.examId === where.examId_nullifierHash.examId &&
              item.nullifierHash === where.examId_nullifierHash.nullifierHash
          ) ?? null
      ),
      update: vi.fn(
        async ({
          where,
          data
        }: {
          where: { id: string };
          data: Partial<SubmissionRecord>;
        }) => {
          const currentSubmission = submissions.find((item) => item.id === where.id)!;
          Object.assign(currentSubmission, data);
          return currentSubmission;
        }
      )
    }
  };

  return {
    auditEvents,
    prisma: {
      $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) =>
        callback(tx),
      exam: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === exam.id ? exam : null
        )
      }
    },
    submissions
  };
}

function createProof(params: {
  groupRoot: string;
  message: string;
  nullifierHash: string;
  scope: string;
}): SemaphoreProof {
  return {
    merkleTreeDepth: 2,
    merkleTreeRoot: params.groupRoot,
    message: params.message,
    nullifier: params.nullifierHash,
    points: ['1', '2', '3', '4', '5', '6', '7', '8'],
    scope: params.scope
  };
}

describe('SubmissionService', () => {
  let exam: ExamRecord;

  beforeEach(() => {
    exam = {
      currentGroupRoot: '999',
      id: 'exam-1',
      questionSetHash: 'sha256:questions',
      status: ExamStatus.OPEN,
      versions: [{ version: 1 }]
    };
  });

  it('accepts a valid anonymous submission and returns a signed receipt', async () => {
    const { prisma, submissions } = createPrismaMock(exam);
    const service = new SubmissionService(prisma as never);
    const message = computeSubmissionMessage({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      examId: exam.id,
      examVersion: 1,
      questionSetHash: exam.questionSetHash
    });
    const scope = computeSubmitScope(exam.id, 1);
    const result = await service.createSubmission({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      encryptedBlobUri: 's3://proofmark/submission-1',
      examId: exam.id,
      examVersion: 1,
      groupRoot: exam.currentGroupRoot,
      message,
      nullifierHash: 'nullifier-1',
      proof: createProof({
        groupRoot: exam.currentGroupRoot,
        message,
        nullifierHash: 'nullifier-1',
        scope
      }),
      questionSetHash: exam.questionSetHash,
      scope
    });

    expect(result.submissionId).toBe('submission-1');
    expect(result.receipt.serverSignature).toBeTruthy();
    expect(result.receipt.serverPublicKey).toContain('BEGIN PUBLIC KEY');
    expect(submissions).toHaveLength(1);
  });

  it('rejects an invalid message binding', async () => {
    const { prisma } = createPrismaMock(exam);
    const service = new SubmissionService(prisma as never);
    const scope = computeSubmitScope(exam.id, 1);

    await expect(
      service.createSubmission({
        answerCommitment: '0xaaa',
        encryptedBlobHash: 'sha256:blob',
        encryptedBlobUri: 's3://proofmark/submission-1',
        examId: exam.id,
        examVersion: 1,
        groupRoot: exam.currentGroupRoot,
        message: 'bad-message',
        nullifierHash: 'nullifier-1',
        proof: createProof({
          groupRoot: exam.currentGroupRoot,
          message: 'bad-message',
          nullifierHash: 'nullifier-1',
          scope
        }),
        questionSetHash: exam.questionSetHash,
        scope
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown group root and duplicate nullifier reuse', async () => {
    const { prisma } = createPrismaMock(exam);
    const service = new SubmissionService(prisma as never);
    const message = computeSubmissionMessage({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      examId: exam.id,
      examVersion: 1,
      questionSetHash: exam.questionSetHash
    });
    const scope = computeSubmitScope(exam.id, 1);

    await expect(
      service.createSubmission({
        answerCommitment: '0xaaa',
        encryptedBlobHash: 'sha256:blob',
        encryptedBlobUri: 's3://proofmark/submission-1',
        examId: exam.id,
        examVersion: 1,
        groupRoot: 'different-root',
        message,
        nullifierHash: 'nullifier-1',
        proof: createProof({
          groupRoot: 'different-root',
          message,
          nullifierHash: 'nullifier-1',
          scope
        }),
        questionSetHash: exam.questionSetHash,
        scope
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.createSubmission({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      encryptedBlobUri: 's3://proofmark/submission-1',
      examId: exam.id,
      examVersion: 1,
      groupRoot: exam.currentGroupRoot,
      message,
      nullifierHash: 'nullifier-1',
      proof: createProof({
        groupRoot: exam.currentGroupRoot,
        message,
        nullifierHash: 'nullifier-1',
        scope
      }),
      questionSetHash: exam.questionSetHash,
      scope
    });

    await expect(
      service.createSubmission({
        answerCommitment: '0xbbb',
        encryptedBlobHash: 'sha256:blob-2',
        encryptedBlobUri: 's3://proofmark/submission-2',
        examId: exam.id,
        examVersion: 1,
        groupRoot: exam.currentGroupRoot,
        message: computeSubmissionMessage({
          answerCommitment: '0xbbb',
          encryptedBlobHash: 'sha256:blob-2',
          examId: exam.id,
          examVersion: 1,
          questionSetHash: exam.questionSetHash
        }),
        nullifierHash: 'nullifier-1',
        proof: createProof({
          groupRoot: exam.currentGroupRoot,
          message: computeSubmissionMessage({
            answerCommitment: '0xbbb',
            encryptedBlobHash: 'sha256:blob-2',
            examId: exam.id,
            examVersion: 1,
            questionSetHash: exam.questionSetHash
          }),
          nullifierHash: 'nullifier-1',
          scope
        }),
        questionSetHash: exam.questionSetHash,
        scope
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
