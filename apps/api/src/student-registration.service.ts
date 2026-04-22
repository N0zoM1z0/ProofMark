import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { Group } from '@semaphore-protocol/group';
import { EligibleCommitmentStatus, ExamStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
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
  constructor(private readonly prisma: PrismaService) {}

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

    if (
      exam.status !== ExamStatus.REGISTRATION &&
      exam.status !== ExamStatus.PUBLISHED &&
      exam.status !== ExamStatus.OPEN
    ) {
      throw new ConflictException('Exam is not accepting commitment registration');
    }

    return this.prisma.$transaction(async (tx) => {
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
      const payload = {
        groupRoot,
        identityCommitment: params.identityCommitment,
        memberIndex
      };
      const payloadHash = sha256Hex(canonicalJson(payload));
      const createdAt = new Date();
      const eventHash = sha256Hex(
        canonicalJson({
          actorPseudonym: null,
          actorRole: 'STUDENT',
          createdAt: createdAt.toISOString(),
          eventType: 'IdentityCommitmentAdded',
          examId: params.examId,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        })
      );

      const auditEvent = await tx.auditEvent.create({
        data: {
          examId: params.examId,
          seq,
          eventType: 'IdentityCommitmentAdded',
          actorRole: 'STUDENT',
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          eventHash,
          createdAt
        }
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
      };
    });
  }
}
