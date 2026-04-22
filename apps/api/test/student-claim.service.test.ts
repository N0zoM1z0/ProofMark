import { BadRequestException, ConflictException } from '@nestjs/common';
import { ClaimStatus, ExamStatus, GradeStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentClaimService } from '../src/student-claim.service.js';
import type { SemaphoreProof } from '../src/submission.service.js';
import { computeSubmitScope, sha256Hex } from '../src/submission-utils.js';

vi.mock('@semaphore-protocol/proof', () => ({
  verifyProof: vi.fn(async () => true)
}));

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

function createPrismaMock() {
  const exam = {
    grades: [
      {
        finalScore: 10,
        gradeCommitment: 'sha256:grade',
        id: 'grade-1',
        maxScore: 10,
        submissionId: 'submission-1',
        status: GradeStatus.FINALIZED
      }
    ],
    id: 'exam-1',
    status: ExamStatus.CLAIMING,
    versions: [{ version: 1 }]
  };
  const submission = {
    exam,
    examId: 'exam-1',
    groupRoot: 'group-root',
    id: 'submission-1',
    nullifierHash: 'nullifier-1'
  };
  const registrarLink = {
    examId: 'exam-1',
    identityCommitment: 'commitment-1',
    realUserRefCiphertext: sha256Hex('student-phase7')
  };
  const claims: Array<{ id: string }> = [];

  return {
    prisma: {
      $transaction: async <T>(callback: (client: any) => Promise<T>) =>
        callback({
          auditEvent: {
            count: async () => 0,
            create: async () => ({ id: 'audit-1' }),
            findFirst: async () => null
          },
          gradeClaim: {
            create: async () => {
              claims.push({ id: 'claim-1' });
              return { id: 'claim-1' };
            }
          }
        }),
      auditEvent: {
        count: async () => 0,
        create: async () => ({ id: 'audit-1' }),
        findFirst: async () => null
      },
      gradeClaim: {
        findUnique: async () => (claims[0] ? { id: claims[0].id } : null)
      },
      gradeClaimData: claims,
      registrarIdentityLink: {
        findUnique: async ({
          where
        }: {
          where: { examId_identityCommitment: { examId: string; identityCommitment: string } };
        }) =>
          where.examId_identityCommitment.examId === registrarLink.examId &&
          where.examId_identityCommitment.identityCommitment === registrarLink.identityCommitment
            ? registrarLink
            : null
      },
      submission: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === submission.id ? submission : null
      }
    }
  };
}

describe('StudentClaimService', () => {
  let service: StudentClaimService;
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let scope: string;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    service = new StudentClaimService(prismaMock.prisma as never);
    scope = computeSubmitScope('exam-1', 1);
  });

  it('claims a finalized grade only when the nullifier matches the original submission', async () => {
    const result = await service.claimGrade({
      examId: 'exam-1',
      identityCommitment: 'commitment-1',
      message: 'claim-message',
      proof: createProof({
        groupRoot: 'group-root',
        message: 'claim-message',
        nullifierHash: 'nullifier-1',
        scope
      }),
      scope,
      studentId: 'student-phase7',
      submissionId: 'submission-1'
    });

    expect(result.claimId).toBe('claim-1');
    expect(result.grade.gradeId).toBe('grade-1');
  });

  it('rejects claims outside CLAIMING or with the wrong nullifier', async () => {
    (prismaMock.prisma.submission.findUnique as any) = async () => ({
      exam: {
        grades: [],
        id: 'exam-1',
        status: ExamStatus.FINALIZED,
        versions: [{ version: 1 }]
      },
      examId: 'exam-1',
      groupRoot: 'group-root',
      id: 'submission-1',
      nullifierHash: 'nullifier-1'
    });

    await expect(
      service.claimGrade({
        examId: 'exam-1',
        identityCommitment: 'commitment-1',
        message: 'claim-message',
        proof: createProof({
          groupRoot: 'group-root',
          message: 'claim-message',
          nullifierHash: 'wrong-nullifier',
          scope
        }),
        scope,
        studentId: 'student-phase7',
        submissionId: 'submission-1'
      })
    ).rejects.toBeInstanceOf(ConflictException);

    (prismaMock.prisma.submission.findUnique as any) = async () => ({
      exam: {
        grades: [],
        id: 'exam-1',
        status: ExamStatus.CLAIMING,
        versions: [{ version: 1 }]
      },
      examId: 'exam-1',
      groupRoot: 'group-root',
      id: 'submission-1',
      nullifierHash: 'nullifier-1'
    });

    await expect(
      service.claimGrade({
        examId: 'exam-1',
        identityCommitment: 'commitment-1',
        message: 'claim-message',
        proof: createProof({
          groupRoot: 'group-root',
          message: 'claim-message',
          nullifierHash: 'wrong-nullifier',
          scope
        }),
        scope,
        studentId: 'student-phase7',
        submissionId: 'submission-1'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
