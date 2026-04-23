import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Group } from '@semaphore-protocol/group';
import { EligibleCommitmentStatus, ExamStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  createAuditEventWithRetry,
  isRetryableAuditConflictError
} from './audit-event-write.js';
import { PrismaService } from './prisma.service.js';

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey)
      )
    )
  );
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class StudentRegistrationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async registerCommitment(params: {
    examId: string;
    identityCommitment: string;
    studentId: string;
  }) {
    let commitmentAsBigInt: bigint;

    try {
      commitmentAsBigInt = BigInt(params.identityCommitment);
    } catch {
      throw new BadRequestException('identityCommitment must be a bigint string');
    }

    const exam = await this.prisma.exam.findUnique({
      where: {
        id: params.examId
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    if (exam.status !== ExamStatus.REGISTRATION) {
      throw new ConflictException('Exam is not accepting commitment registration');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.registrarIdentityLink.upsert({
            where: {
              examId_identityCommitment: {
                examId: params.examId,
                identityCommitment: params.identityCommitment
              }
            },
            create: {
              examId: params.examId,
              identityCommitment: params.identityCommitment,
              realUserRefCiphertext: sha256Hex(params.studentId)
            },
            update: {
              realUserRefCiphertext: sha256Hex(params.studentId)
            }
          });

          const eligibleCommitment = await tx.eligibleCommitment.upsert({
            where: {
              examId_identityCommitment: {
                examId: params.examId,
                identityCommitment: params.identityCommitment
              }
            },
            create: {
              examId: params.examId,
              identityCommitment: params.identityCommitment,
              addedByRef: params.studentId,
              status: EligibleCommitmentStatus.ACTIVE
            },
            update: {
              status: EligibleCommitmentStatus.ACTIVE,
              addedByRef: params.studentId
            }
          });

          const activeCommitments = await tx.eligibleCommitment.findMany({
            where: {
              examId: params.examId,
              status: EligibleCommitmentStatus.ACTIVE
            },
            orderBy: [
              {
                addedAt: 'asc'
              },
              {
                id: 'asc'
              }
            ]
          });

          const group = new Group(
            activeCommitments.map((item) => BigInt(item.identityCommitment))
          );
          const groupRoot = group.root.toString();
          const memberIndex = group.indexOf(commitmentAsBigInt);
          const payload = {
            groupRoot,
            identityCommitment: params.identityCommitment,
            memberIndex
          };
          const payloadHash = sha256Hex(canonicalJson(payload));
          const auditEvent = await createAuditEventWithRetry(tx, {
            examId: params.examId,
            buildEvent: ({ createdAt, prevEventHash, seq }) => ({
              actorRole: 'STUDENT',
              createdAt,
              eventHash: sha256Hex(
                canonicalJson({
                  actorPseudonym: null,
                  actorRole: 'STUDENT',
                  createdAt: createdAt.toISOString(),
                  eventType: 'IdentityCommitmentAdded',
                  examId: params.examId,
                  payloadHash,
                  prevEventHash,
                  seq
                })
              ),
              eventType: 'IdentityCommitmentAdded',
              examId: params.examId,
              payloadHash,
              prevEventHash,
              seq
            })
          });

          await tx.eligibleCommitment.update({
            where: {
              id: eligibleCommitment.id
            },
            data: {
              auditEventId: auditEvent.id
            }
          });

          await tx.exam.update({
            where: {
              id: params.examId
            },
            data: {
              currentGroupRoot: groupRoot
            }
          });

          return {
            auditEventId: auditEvent.id,
            groupRoot,
            groupSnapshotVersion: activeCommitments.length,
            memberIndex
          }
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
