import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ExamStatus,
  WalletRecoveryPackageStatus,
  WalletRecoveryRequestStatus
} from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalStudentHash } from '../src/student-identity-utils.js';
import { WalletRecoveryService } from '../src/wallet-recovery.service.js';

type ExamRecord = {
  id: string;
  status: ExamStatus;
};

type RegistrarLinkRecord = {
  exam: ExamRecord;
  examId: string;
  identityCommitment: string;
  realUserRefCiphertext: string;
};

type PackageRecord = {
  auditEventId: string | null;
  encryptedIdentityCiphertext: string;
  encryptedIdentityIv: string;
  encryptedIdentitySalt: string;
  examId: string;
  expiresAt: Date | null;
  id: string;
  identityCommitment: string;
  operatorWrapCiphertext: string | null;
  packageHash: string;
  restoredAt: Date | null;
  revokedAt: Date | null;
  status: WalletRecoveryPackageStatus;
  updatedAt: Date;
  userReferenceCiphertext: string;
};

type RequestRecord = {
  auditEventId: string | null;
  completedAt: Date | null;
  exam: ExamRecord;
  examId: string;
  id: string;
  operatorReferenceCiphertext: string | null;
  reason: string | null;
  requestedAt: Date;
  requestedByCiphertext: string;
  reviewedAt: Date | null;
  status: WalletRecoveryRequestStatus;
  walletRecoveryPackageId: string;
};

function createPrismaMock() {
  const exam: ExamRecord = {
    id: 'exam-1',
    status: ExamStatus.CLAIMING
  };
  const registrarLinks: RegistrarLinkRecord[] = [
    {
      exam,
      examId: exam.id,
      identityCommitment: 'commitment-1',
      realUserRefCiphertext: canonicalStudentHash('student-1')
    }
  ];
  const packages: PackageRecord[] = [];
  const requests: RequestRecord[] = [];
  const auditEvents: Array<{ examId: string; eventHash: string; id: string; seq: number }> =
    [];

  const tx = {
    auditEvent: {
      count: async ({ where }: { where: { examId: string } }) =>
        auditEvents.filter((event) => event.examId === where.examId).length,
      create: async ({
        data
      }: {
        data: {
          eventHash: string;
          examId: string;
          seq: number;
        };
      }) => {
        const event = {
          eventHash: data.eventHash,
          examId: data.examId,
          id: `audit-${auditEvents.length + 1}`,
          seq: data.seq
        };
        auditEvents.push(event);
        return event;
      },
      findFirst: async ({ where }: { where: { examId: string } }) =>
        auditEvents
          .filter((event) => event.examId === where.examId)
          .sort((left, right) => right.seq - left.seq)[0] ?? null
    },
    walletRecoveryPackage: {
      findFirst: async ({
        where
      }: {
        where: {
          examId?: string;
          status?: WalletRecoveryPackageStatus;
          userReferenceCiphertext?: string;
        };
      }) =>
        packages.find(
          (item) =>
            (where.examId === undefined || item.examId === where.examId) &&
            (where.status === undefined || item.status === where.status) &&
            (where.userReferenceCiphertext === undefined ||
              item.userReferenceCiphertext === where.userReferenceCiphertext)
        ) ?? null,
      update: async ({
        where,
        data
      }: {
        where: { id: string };
        data: Partial<PackageRecord>;
      }) => {
        const record = packages.find((item) => item.id === where.id)!;
        Object.assign(record, data, {
          updatedAt: new Date()
        });
        return record;
      },
      upsert: async ({
        where,
        create,
        update
      }: {
        where: {
          examId_identityCommitment: { examId: string; identityCommitment: string };
        };
        create: Omit<PackageRecord, 'expiresAt' | 'id' | 'updatedAt'>;
        update: Partial<PackageRecord>;
      }) => {
        const existing = packages.find(
          (item) =>
            item.examId === where.examId_identityCommitment.examId &&
            item.identityCommitment ===
              where.examId_identityCommitment.identityCommitment
        );

        if (existing) {
          Object.assign(existing, update, {
            updatedAt: new Date()
          });
          return existing;
        }

        const created: PackageRecord = {
          ...create,
          expiresAt: null,
          id: `package-${packages.length + 1}`,
          updatedAt: new Date()
        };
        packages.push(created);
        return created;
      }
    },
    walletRecoveryRequest: {
      create: async ({
        data,
        include
      }: {
        data: Omit<RequestRecord, 'completedAt' | 'exam' | 'id' | 'requestedAt' | 'reviewedAt'>;
        include?: { walletRecoveryPackage?: { select: object } };
      }) => {
        const created: RequestRecord = {
          ...data,
          completedAt: null,
          exam,
          id: `request-${requests.length + 1}`,
          requestedAt: new Date(),
          reviewedAt: null
        };
        requests.push(created);

        if (!include?.walletRecoveryPackage) {
          return created;
        }

        return {
          ...created,
          walletRecoveryPackage: packages.find(
            (item) => item.id === created.walletRecoveryPackageId
          )!
        };
      },
      findFirst: async ({
        where
      }: {
        where: {
          examId?: string;
          requestedByCiphertext?: string;
          status?: { in: WalletRecoveryRequestStatus[] };
          walletRecoveryPackageId?: string;
        };
      }) =>
        requests.find(
          (item) =>
            (where.examId === undefined || item.examId === where.examId) &&
            (where.requestedByCiphertext === undefined ||
              item.requestedByCiphertext === where.requestedByCiphertext) &&
            (where.walletRecoveryPackageId === undefined ||
              item.walletRecoveryPackageId === where.walletRecoveryPackageId) &&
            (!where.status || where.status.in.includes(item.status))
        ) ?? null,
      findMany: async ({
        where
      }: {
        where: { examId?: string; requestedByCiphertext?: string };
      }) =>
        requests
          .filter(
            (item) =>
              (where.examId === undefined || item.examId === where.examId) &&
              (where.requestedByCiphertext === undefined ||
                item.requestedByCiphertext === where.requestedByCiphertext)
          )
          .map((item) => ({
            ...item,
            walletRecoveryPackage: packages.find(
              (candidate) => candidate.id === item.walletRecoveryPackageId
            )!
          })),
      findUnique: async ({
        where
      }: {
        where: {
          id: string;
        };
      }) => {
        const request = requests.find((item) => item.id === where.id);

        if (!request) {
          return null;
        }

        return {
          ...request,
          exam,
          walletRecoveryPackage: packages.find(
            (item) => item.id === request.walletRecoveryPackageId
          )!
        };
      },
      update: async ({
        where,
        data,
        include
      }: {
        where: { id: string };
        data: Partial<RequestRecord>;
        include?: { walletRecoveryPackage?: { select: object } };
      }) => {
        const request = requests.find((item) => item.id === where.id)!;
        Object.assign(request, data);

        if (!include?.walletRecoveryPackage) {
          return request;
        }

        return {
          ...request,
          walletRecoveryPackage: packages.find(
            (item) => item.id === request.walletRecoveryPackageId
          )!
        };
      }
    }
  };

  return {
    exam,
    packages,
    prisma: {
      $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) =>
        callback(tx),
      exam: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === exam.id ? exam : null
      },
      registrarIdentityLink: {
        findUnique: async ({
          where
        }: {
          where: {
            examId_identityCommitment: { examId: string; identityCommitment: string };
          };
        }) =>
          registrarLinks.find(
            (item) =>
              item.examId === where.examId_identityCommitment.examId &&
              item.identityCommitment ===
                where.examId_identityCommitment.identityCommitment
          ) ?? null
      },
      walletRecoveryPackage: {
        findFirst: tx.walletRecoveryPackage.findFirst
      },
      walletRecoveryRequest: {
        findFirst: tx.walletRecoveryRequest.findFirst,
        findMany: tx.walletRecoveryRequest.findMany,
        findUnique: tx.walletRecoveryRequest.findUnique
      }
    },
    requests
  };
}

describe('WalletRecoveryService', () => {
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let service: WalletRecoveryService;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    service = new WalletRecoveryService(prismaMock.prisma as never);
  });

  it('escrows, requests, approves, and restores a wallet recovery package', async () => {
    const escrowed = await service.escrowRecoveryPackage({
      encryptedRecord: {
        ciphertext: 'ciphertext-1',
        commitment: 'commitment-1',
        iv: 'iv-1',
        salt: 'salt-1',
        version: 1
      },
      examId: 'exam-1',
      studentId: 'student-1'
    });

    expect(escrowed.recoveryPackage?.status).toBe('ACTIVE');

    const request = await service.createRecoveryRequest({
      examId: 'exam-1',
      reason: 'Browser storage was cleared',
      studentId: 'student-1'
    });

    expect(request.recoveryRequest.status).toBe('REQUESTED');

    const approved = await service.reviewRecoveryRequest({
      adminId: 'admin-1',
      approve: true,
      examId: 'exam-1',
      requestId: request.recoveryRequest.requestId
    });

    expect(approved.recoveryRequest.status).toBe('APPROVED');

    const restored = await service.restoreRecoveryPackage({
      examId: 'exam-1',
      requestId: request.recoveryRequest.requestId,
      studentId: 'student-1'
    });

    expect(restored.encryptedRecord.commitment).toBe('commitment-1');
    expect(restored.recoveryRequest.status).toBe('COMPLETED');
    expect(prismaMock.packages[0]?.status).toBe(WalletRecoveryPackageStatus.RESTORED);
  });

  it('rejects recovery requests when no escrowed package exists', async () => {
    await expect(
      service.createRecoveryRequest({
        examId: 'exam-1',
        studentId: 'student-1'
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks restore before operator approval and outside the recovery window', async () => {
    await service.escrowRecoveryPackage({
      encryptedRecord: {
        ciphertext: 'ciphertext-1',
        commitment: 'commitment-1',
        iv: 'iv-1',
        salt: 'salt-1',
        version: 1
      },
      examId: 'exam-1',
      studentId: 'student-1'
    });
    const request = await service.createRecoveryRequest({
      examId: 'exam-1',
      studentId: 'student-1'
    });

    await expect(
      service.restoreRecoveryPackage({
        examId: 'exam-1',
        requestId: request.recoveryRequest.requestId,
        studentId: 'student-1'
      })
    ).rejects.toBeInstanceOf(ConflictException);

    prismaMock.exam.status = ExamStatus.MARKING;

    await expect(
      service.createRecoveryRequest({
        examId: 'exam-1',
        studentId: 'student-1'
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
