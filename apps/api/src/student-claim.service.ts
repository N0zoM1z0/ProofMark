import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ClaimStatus, ExamStatus, GradeStatus } from '@prisma/client';
import { verifyProof } from '@semaphore-protocol/proof';
import { PrismaService } from './prisma.service.js';
import type { SemaphoreProof } from './submission.service.js';
import { canonicalJson, computeSubmitScope, sha256Hex } from './submission-utils.js';

const semaphoreVerifyProof = verifyProof as (
  proof: SemaphoreProof
) => Promise<boolean>;

function canonicalStudentHash(studentId: string) {
  return sha256Hex(studentId);
}

@Injectable()
export class StudentClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claimGrade(params: {
    examId: string;
    identityCommitment: string;
    message: string;
    proof: SemaphoreProof;
    scope: string;
    studentId: string;
    submissionId: string;
  }) {
    const submission = await this.prisma.submission.findUnique({
      where: {
        id: params.submissionId
      },
      include: {
        exam: {
          include: {
            grades: {
              where: {
                status: GradeStatus.FINALIZED
              }
            },
            versions: {
              orderBy: {
                version: 'desc'
              },
              take: 1
            }
          }
        }
      }
    });

    if (!submission || submission.examId !== params.examId) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.exam.status !== ExamStatus.CLAIMING) {
      throw new ConflictException('CLAIMING_NOT_OPEN');
    }

    const latestVersion = submission.exam.versions[0];
    const expectedScope = computeSubmitScope(
      submission.examId,
      latestVersion?.version ?? 1
    );

    if (params.scope !== expectedScope || params.proof.scope !== expectedScope) {
      throw new BadRequestException('CLAIM_SCOPE_MISMATCH');
    }

    if (
      params.proof.nullifier !== submission.nullifierHash ||
      params.proof.merkleTreeRoot !== submission.groupRoot ||
      params.proof.message !== params.message
    ) {
      throw new BadRequestException('CLAIM_PROOF_MISMATCH');
    }

    const proofIsValid = await semaphoreVerifyProof(params.proof);

    if (!proofIsValid) {
      throw new BadRequestException('CLAIM_PROOF_INVALID');
    }

    const registrarLink = await this.prisma.registrarIdentityLink.findUnique({
      where: {
        examId_identityCommitment: {
          examId: params.examId,
          identityCommitment: params.identityCommitment
        }
      }
    });

    if (!registrarLink) {
      throw new NotFoundException('Registrar link not found');
    }

    if (registrarLink.realUserRefCiphertext !== canonicalStudentHash(params.studentId)) {
      throw new ConflictException('CLAIM_IDENTITY_MISMATCH');
    }

    const finalizedGrade = submission.exam.grades.find(
      (grade) =>
        grade.submissionId === submission.id && grade.status === GradeStatus.FINALIZED
    );

    if (!finalizedGrade) {
      throw new ConflictException('FINALIZED_GRADE_NOT_FOUND');
    }

    const existingClaim = await this.prisma.gradeClaim.findUnique({
      where: {
        examId_submissionId: {
          examId: params.examId,
          submissionId: submission.id
        }
      }
    });

    if (existingClaim) {
      throw new ConflictException('GRADE_ALREADY_CLAIMED');
    }

    return this.prisma.$transaction(async (tx) => {
      const previousAuditEvent = await tx.auditEvent.findFirst({
        where: {
          examId: params.examId
        },
        orderBy: {
          seq: 'desc'
        }
      });
      const seq =
        (await tx.auditEvent.count({
          where: {
            examId: params.examId
          }
        })) + 1;
      const payload = {
        gradeId: finalizedGrade.id,
        submissionId: submission.id
      };
      const payloadHash = sha256Hex(canonicalJson(payload));
      const createdAt = new Date();
      const eventHash = sha256Hex(
        canonicalJson({
          actorPseudonym: null,
          actorRole: 'CLAIMANT',
          createdAt: createdAt.toISOString(),
          eventType: 'GradeClaimed',
          examId: params.examId,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        })
      );
      const auditEvent = await tx.auditEvent.create({
        data: {
          actorRole: 'CLAIMANT',
          createdAt,
          eventHash,
          eventType: 'GradeClaimed',
          examId: params.examId,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        }
      });
      const claimProofHash = sha256Hex(
        canonicalJson({
          identityCommitment: params.identityCommitment,
          message: params.message,
          nullifierHash: submission.nullifierHash,
          studentIdHash: canonicalStudentHash(params.studentId),
          submissionId: submission.id,
          version: 'proofmark-grade-claim-v1'
        })
      );
      const claim = await tx.gradeClaim.create({
        data: {
          auditEventId: auditEvent.id,
          claimProofHash,
          examId: params.examId,
          gradeId: finalizedGrade.id,
          status: ClaimStatus.CLAIMED,
          submissionId: submission.id,
          userReferenceCiphertext: canonicalStudentHash(params.studentId)
        }
      });

      return {
        claimId: claim.id,
        grade: {
          finalScore: finalizedGrade.finalScore,
          gradeCommitment: finalizedGrade.gradeCommitment,
          gradeId: finalizedGrade.id,
          maxScore: finalizedGrade.maxScore
        }
      };
    });
  }
}
