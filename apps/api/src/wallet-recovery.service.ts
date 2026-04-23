import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  ExamStatus,
  WalletRecoveryPackageStatus,
  WalletRecoveryRequestStatus
} from '@prisma/client';
import {
  createAuditEventWithRetry,
  isRetryableAuditConflictError
} from './audit-event-write.js';
import { PrismaService } from './prisma.service.js';
import { canonicalJson, sha256Hex } from './submission-utils.js';
import {
  canonicalOperatorHash,
  canonicalStudentHash
} from './student-identity-utils.js';

type EscrowedRecord = {
  ciphertext: string;
  commitment: string;
  iv: string;
  salt: string;
  version: 1;
};

function computePackageHash(record: EscrowedRecord) {
  return `sha256:${sha256Hex(
    canonicalJson({
      commitment: record.commitment,
      ciphertext: record.ciphertext,
      iv: record.iv,
      purpose: 'proofmark-wallet-recovery-package-v1',
      salt: record.salt,
      version: record.version
    })
  )}`;
}

function isRecoveryWindowOpen(status: ExamStatus) {
  return status === ExamStatus.FINALIZED || status === ExamStatus.CLAIMING;
}

type AuditContext = {
  actorPseudonym?: string | null;
  actorRole: string;
  eventType: string;
  examId: string;
  payload: Record<string, unknown>;
};

function buildAuditEvent(context: AuditContext) {
  const payloadHash = sha256Hex(canonicalJson(context.payload));

  return {
    payloadHash,
    create: ({
      createdAt,
      prevEventHash,
      seq
    }: {
      createdAt: Date;
      prevEventHash: string | null;
      seq: number;
    }) => ({
      actorPseudonym: context.actorPseudonym ?? null,
      actorRole: context.actorRole,
      createdAt,
      eventHash: sha256Hex(
        canonicalJson({
          actorPseudonym: context.actorPseudonym ?? null,
          actorRole: context.actorRole,
          createdAt: createdAt.toISOString(),
          eventType: context.eventType,
          examId: context.examId,
          payloadHash,
          prevEventHash,
          seq
        })
      ),
      eventType: context.eventType,
      examId: context.examId,
      payloadHash,
      prevEventHash,
      seq
    })
  };
}

function toPackageSummary(
  recoveryPackage: {
    id: string;
    packageHash: string;
    escrowedAt: Date;
    restoredAt: Date | null;
    expiresAt: Date | null;
    status: WalletRecoveryPackageStatus;
    identityCommitment: string;
  } | null
) {
  if (!recoveryPackage) {
    return null;
  }

  return {
    escrowedAt: recoveryPackage.escrowedAt,
    expiresAt: recoveryPackage.expiresAt,
    identityCommitment: recoveryPackage.identityCommitment,
    packageHash: recoveryPackage.packageHash,
    packageId: recoveryPackage.id,
    restoredAt: recoveryPackage.restoredAt,
    status: recoveryPackage.status
  };
}

function toRequestSummary(
  request: {
    id: string;
    status: WalletRecoveryRequestStatus;
    reason: string | null;
    requestedAt: Date;
    reviewedAt: Date | null;
    completedAt: Date | null;
    walletRecoveryPackage: {
      id: string;
      identityCommitment: string;
      status: WalletRecoveryPackageStatus;
    };
  }
) {
  return {
    completedAt: request.completedAt,
    identityCommitment: request.walletRecoveryPackage.identityCommitment,
    packageId: request.walletRecoveryPackage.id,
    packageStatus: request.walletRecoveryPackage.status,
    reason: request.reason,
    requestId: request.id,
    requestedAt: request.requestedAt,
    reviewedAt: request.reviewedAt,
    status: request.status
  };
}

@Injectable()
export class WalletRecoveryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async escrowRecoveryPackage(params: {
    encryptedRecord: EscrowedRecord;
    examId: string;
    operatorWrapCiphertext?: string | null;
    studentId: string;
  }) {
    const studentHash = canonicalStudentHash(params.studentId);
    const registrarLink = await this.prisma.registrarIdentityLink.findUnique({
      where: {
        examId_identityCommitment: {
          examId: params.examId,
          identityCommitment: params.encryptedRecord.commitment
        }
      },
      include: {
        exam: true
      }
    });

    if (!registrarLink) {
      throw new NotFoundException('RECOVERY_REGISTRAR_LINK_NOT_FOUND');
    }

    if (registrarLink.realUserRefCiphertext !== studentHash) {
      throw new ConflictException('RECOVERY_IDENTITY_MISMATCH');
    }

    if (registrarLink.exam.status === ExamStatus.ARCHIVED) {
      throw new ConflictException('RECOVERY_PACKAGE_WINDOW_CLOSED');
    }

    const packageHash = computePackageHash(params.encryptedRecord);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const auditContext = buildAuditEvent({
            actorRole: 'STUDENT',
            eventType: 'WalletRecoveryPackageEscrowed',
            examId: params.examId,
            payload: {
              identityCommitment: params.encryptedRecord.commitment,
              packageHash,
              studentHash
            }
          });
          const auditEvent = await createAuditEventWithRetry(tx, {
            buildEvent: auditContext.create,
            examId: params.examId
          });
          const recoveryPackage = await tx.walletRecoveryPackage.upsert({
            where: {
              examId_identityCommitment: {
                examId: params.examId,
                identityCommitment: params.encryptedRecord.commitment
              }
            },
            create: {
              auditEventId: auditEvent.id,
              encryptedIdentityCiphertext: params.encryptedRecord.ciphertext,
              encryptedIdentityIv: params.encryptedRecord.iv,
              encryptedIdentitySalt: params.encryptedRecord.salt,
              examId: params.examId,
              identityCommitment: params.encryptedRecord.commitment,
              operatorWrapCiphertext: params.operatorWrapCiphertext ?? null,
              packageHash,
              restoredAt: null,
              revokedAt: null,
              status: WalletRecoveryPackageStatus.ACTIVE,
              userReferenceCiphertext: studentHash
            },
            update: {
              auditEventId: auditEvent.id,
              encryptedIdentityCiphertext: params.encryptedRecord.ciphertext,
              encryptedIdentityIv: params.encryptedRecord.iv,
              encryptedIdentitySalt: params.encryptedRecord.salt,
              operatorWrapCiphertext: params.operatorWrapCiphertext ?? null,
              packageHash,
              restoredAt: null,
              revokedAt: null,
              status: WalletRecoveryPackageStatus.ACTIVE,
              userReferenceCiphertext: studentHash
            }
          });

          return {
            auditEventId: auditEvent.id,
            recoveryPackage: toPackageSummary(recoveryPackage)
          };
        });
      } catch (error) {
        if (isRetryableAuditConflictError(error) && attempt < 4) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('AUDIT_APPEND_RETRY_EXHAUSTED');
  }

  async getStudentRecoveryPackage(params: { examId: string; studentId: string }) {
    const recoveryPackage = await this.prisma.walletRecoveryPackage.findFirst({
      where: {
        examId: params.examId,
        userReferenceCiphertext: canonicalStudentHash(params.studentId)
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    return {
      recoveryPackage: toPackageSummary(recoveryPackage)
    };
  }

  async createRecoveryRequest(params: {
    examId: string;
    reason?: string | null;
    studentId: string;
  }) {
    const studentHash = canonicalStudentHash(params.studentId);
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: params.examId
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    if (!isRecoveryWindowOpen(exam.status)) {
      throw new ConflictException('RECOVERY_NOT_OPEN');
    }

    const recoveryPackage = await this.prisma.walletRecoveryPackage.findFirst({
      where: {
        examId: params.examId,
        status: WalletRecoveryPackageStatus.ACTIVE,
        userReferenceCiphertext: studentHash
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    if (!recoveryPackage) {
      throw new NotFoundException('RECOVERY_PACKAGE_NOT_FOUND');
    }

    const existingRequest = await this.prisma.walletRecoveryRequest.findFirst({
      where: {
        examId: params.examId,
        requestedByCiphertext: studentHash,
        status: {
          in: [
            WalletRecoveryRequestStatus.REQUESTED,
            WalletRecoveryRequestStatus.APPROVED
          ]
        },
        walletRecoveryPackageId: recoveryPackage.id
      },
      orderBy: {
        requestedAt: 'desc'
      }
    });

    if (existingRequest) {
      throw new ConflictException('RECOVERY_REQUEST_ALREADY_OPEN');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const auditContext = buildAuditEvent({
            actorRole: 'STUDENT',
            eventType: 'WalletRecoveryRequested',
            examId: params.examId,
            payload: {
              packageId: recoveryPackage.id,
              reason: params.reason?.trim() || null,
              studentHash
            }
          });
          const auditEvent = await createAuditEventWithRetry(tx, {
            buildEvent: auditContext.create,
            examId: params.examId
          });
          const request = await tx.walletRecoveryRequest.create({
            data: {
              auditEventId: auditEvent.id,
              examId: params.examId,
              reason: params.reason?.trim() || null,
              requestedByCiphertext: studentHash,
              status: WalletRecoveryRequestStatus.REQUESTED,
              walletRecoveryPackageId: recoveryPackage.id
            },
            include: {
              walletRecoveryPackage: {
                select: {
                  id: true,
                  identityCommitment: true,
                  status: true
                }
              }
            }
          });

          return {
            auditEventId: auditEvent.id,
            recoveryRequest: toRequestSummary(request)
          };
        });
      } catch (error) {
        if (isRetryableAuditConflictError(error) && attempt < 4) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('AUDIT_APPEND_RETRY_EXHAUSTED');
  }

  async listStudentRecoveryRequests(params: { examId: string; studentId: string }) {
    const requests = await this.prisma.walletRecoveryRequest.findMany({
      where: {
        examId: params.examId,
        requestedByCiphertext: canonicalStudentHash(params.studentId)
      },
      orderBy: {
        requestedAt: 'desc'
      },
      include: {
        walletRecoveryPackage: {
          select: {
            id: true,
            identityCommitment: true,
            status: true
          }
        }
      }
    });

    return {
      recoveryRequests: requests.map((request) => toRequestSummary(request))
    };
  }

  async restoreRecoveryPackage(params: {
    examId: string;
    requestId: string;
    studentId: string;
  }) {
    const studentHash = canonicalStudentHash(params.studentId);
    const request = await this.prisma.walletRecoveryRequest.findUnique({
      where: {
        id: params.requestId
      },
      include: {
        exam: true,
        walletRecoveryPackage: true
      }
    });

    if (!request || request.examId !== params.examId) {
      throw new NotFoundException('RECOVERY_REQUEST_NOT_FOUND');
    }

    if (request.requestedByCiphertext !== studentHash) {
      throw new ConflictException('RECOVERY_REQUEST_OWNERSHIP_MISMATCH');
    }

    if (!isRecoveryWindowOpen(request.exam.status)) {
      throw new ConflictException('RECOVERY_NOT_OPEN');
    }

    if (request.status !== WalletRecoveryRequestStatus.APPROVED) {
      throw new ConflictException('RECOVERY_REQUEST_NOT_APPROVED');
    }

    if (request.walletRecoveryPackage.status !== WalletRecoveryPackageStatus.ACTIVE) {
      throw new ConflictException('RECOVERY_PACKAGE_NOT_ACTIVE');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const now = new Date();
          const auditContext = buildAuditEvent({
            actorRole: 'STUDENT',
            eventType: 'WalletRecoveryCompleted',
            examId: params.examId,
            payload: {
              packageId: request.walletRecoveryPackage.id,
              requestId: request.id,
              studentHash
            }
          });
          const auditEvent = await createAuditEventWithRetry(tx, {
            buildEvent: auditContext.create,
            examId: params.examId
          });

          await tx.walletRecoveryPackage.update({
            where: {
              id: request.walletRecoveryPackage.id
            },
            data: {
              auditEventId: auditEvent.id,
              restoredAt: now,
              status: WalletRecoveryPackageStatus.RESTORED
            }
          });

          const completedRequest = await tx.walletRecoveryRequest.update({
            where: {
              id: request.id
            },
            data: {
              auditEventId: auditEvent.id,
              completedAt: now,
              status: WalletRecoveryRequestStatus.COMPLETED
            },
            include: {
              walletRecoveryPackage: {
                select: {
                  id: true,
                  identityCommitment: true,
                  status: true
                }
              }
            }
          });

          return {
            auditEventId: auditEvent.id,
            encryptedRecord: {
              ciphertext: request.walletRecoveryPackage.encryptedIdentityCiphertext,
              commitment: request.walletRecoveryPackage.identityCommitment,
              iv: request.walletRecoveryPackage.encryptedIdentityIv,
              salt: request.walletRecoveryPackage.encryptedIdentitySalt,
              version: 1 as const
            },
            recoveryRequest: toRequestSummary(completedRequest)
          };
        });
      } catch (error) {
        if (isRetryableAuditConflictError(error) && attempt < 4) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('AUDIT_APPEND_RETRY_EXHAUSTED');
  }

  async listAdminRecoveryRequests(params: { examId: string }) {
    const requests = await this.prisma.walletRecoveryRequest.findMany({
      where: {
        examId: params.examId
      },
      orderBy: {
        requestedAt: 'desc'
      },
      include: {
        walletRecoveryPackage: {
          select: {
            id: true,
            identityCommitment: true,
            status: true
          }
        }
      }
    });

    return {
      recoveryRequests: requests.map((request) => ({
        ...toRequestSummary(request),
        requestedByCiphertext: request.requestedByCiphertext
      }))
    };
  }

  async reviewRecoveryRequest(params: {
    adminId: string;
    approve: boolean;
    examId: string;
    requestId: string;
  }) {
    const request = await this.prisma.walletRecoveryRequest.findUnique({
      where: {
        id: params.requestId
      },
      include: {
        walletRecoveryPackage: true
      }
    });

    if (!request || request.examId !== params.examId) {
      throw new NotFoundException('RECOVERY_REQUEST_NOT_FOUND');
    }

    if (request.status !== WalletRecoveryRequestStatus.REQUESTED) {
      throw new ConflictException('RECOVERY_REQUEST_ALREADY_REVIEWED');
    }

    if (
      params.approve &&
      request.walletRecoveryPackage.status !== WalletRecoveryPackageStatus.ACTIVE
    ) {
      throw new ConflictException('RECOVERY_PACKAGE_NOT_ACTIVE');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const nextStatus = params.approve
            ? WalletRecoveryRequestStatus.APPROVED
            : WalletRecoveryRequestStatus.REJECTED;
          const auditContext = buildAuditEvent({
            actorPseudonym: canonicalOperatorHash(params.adminId).slice(0, 16),
            actorRole: 'ADMIN',
            eventType: params.approve
              ? 'WalletRecoveryApproved'
              : 'WalletRecoveryRejected',
            examId: params.examId,
            payload: {
              packageId: request.walletRecoveryPackageId,
              requestId: request.id,
              reviewerHash: canonicalOperatorHash(params.adminId),
              status: nextStatus
            }
          });
          const auditEvent = await createAuditEventWithRetry(tx, {
            buildEvent: auditContext.create,
            examId: params.examId
          });
          const reviewedRequest = await tx.walletRecoveryRequest.update({
            where: {
              id: request.id
            },
            data: {
              auditEventId: auditEvent.id,
              operatorReferenceCiphertext: canonicalOperatorHash(params.adminId),
              reviewedAt: new Date(),
              status: nextStatus
            },
            include: {
              walletRecoveryPackage: {
                select: {
                  id: true,
                  identityCommitment: true,
                  status: true
                }
              }
            }
          });

          return {
            auditEventId: auditEvent.id,
            recoveryRequest: toRequestSummary(reviewedRequest)
          };
        });
      } catch (error) {
        if (isRetryableAuditConflictError(error) && attempt < 4) {
          continue;
        }

        throw error;
      }
    }

    throw new ConflictException('AUDIT_APPEND_RETRY_EXHAUSTED');
  }
}
