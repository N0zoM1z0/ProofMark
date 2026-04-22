import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EligibleCommitmentStatus,
  ExamStatus,
  GradeStatus,
  ProofVerificationStatus
} from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import { AuditRootService } from './audit-root.service.js';
import { getBlobEncryptionPublicKeyPem } from './blob-encryption.js';
import {
  buildPublicExamManifest,
  getManifestPublicKeyPem,
  signManifestPayload
} from './manifest-utils.js';
import { computeSubmitScope } from './submission-utils.js';

@Injectable()
export class PublicExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditRootService: AuditRootService
  ) {}

  async getPublicExam(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        currentGroupRoot: true,
        endsAt: true,
        id: true,
        questionSetHash: true,
        versions: {
          select: {
            manifestHash: true,
            questionSetData: true,
            version: true
          },
          orderBy: {
            version: 'desc'
          },
          take: 1
        },
        startsAt: true,
        status: true,
        title: true,
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const latestVersion = exam.versions[0];

    return {
      currentGroupRoot: exam.currentGroupRoot,
      endsAt: exam.endsAt,
      encryptionPublicKey: getBlobEncryptionPublicKeyPem(),
      examVersion: latestVersion?.version ?? 1,
      id: exam.id,
      manifestHash: latestVersion?.manifestHash ?? null,
      questionSet: latestVersion?.questionSetData ?? null,
      questionSetHash: exam.questionSetHash,
      startsAt: exam.startsAt,
      status: exam.status,
      submitScope: computeSubmitScope(exam.id, latestVersion?.version ?? 1),
      title: exam.title
    };
  }

  async getPublicManifest(examId: string) {
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
        title: true,
        versions: {
          select: {
            manifestHash: true,
            version: true
          },
          orderBy: {
            version: 'desc'
          },
          take: 1
        }
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const latestVersion = exam.versions[0];

    if (!latestVersion?.manifestHash) {
      throw new ConflictException('Manifest is not published for this exam');
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

    if (manifestHash !== latestVersion.manifestHash) {
      throw new ConflictException('Manifest state is inconsistent with published hash');
    }

    return {
      manifest,
      manifestHash,
      serverPublicKey: getManifestPublicKeyPem(),
      serverSignature: signManifestPayload(manifest),
      status: exam.status
    };
  }

  async getPublicGroupSnapshot(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        currentGroupRoot: true,
        id: true,
        status: true,
        eligibleCommitments: {
          where: {
            status: EligibleCommitmentStatus.ACTIVE
          },
          orderBy: [
            {
              addedAt: 'asc'
            },
            {
              id: 'asc'
            }
          ],
          select: {
            identityCommitment: true
          }
        },
        versions: {
          orderBy: {
            version: 'desc'
          },
          select: {
            version: true
          },
          take: 1
        }
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    return {
      examId: exam.id,
      examVersion: exam.versions[0]?.version ?? 1,
      groupRoot: exam.currentGroupRoot,
      memberCommitments: exam.eligibleCommitments.map(
        (commitment) => commitment.identityCommitment
      ),
      size: exam.eligibleCommitments.length,
      status: exam.status
    };
  }

  async getFinalizedGrade(examId: string, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: {
        id: submissionId
      },
      include: {
        exam: {
          select: {
            id: true,
            status: true
          }
        },
        grades: {
          where: {
            status: GradeStatus.FINALIZED
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        },
        proofArtifacts: {
          where: {
            type: 'objective-grade-proof',
            verificationStatus: ProofVerificationStatus.VERIFIED
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 1
        }
      }
    });

    if (!submission || submission.examId !== examId) {
      throw new NotFoundException('Submission not found');
    }

    if (
      submission.exam.status !== ExamStatus.FINALIZED &&
      submission.exam.status !== ExamStatus.CLAIMING
    ) {
      throw new ConflictException('Finalized grades are not published yet');
    }

    const grade = submission.grades[0];

    if (!grade) {
      throw new NotFoundException('Finalized grade not found');
    }

    return {
      examStatus: submission.exam.status,
      grade: {
        finalScore: grade.finalScore,
        finalizedAt: grade.finalizedAt,
        gradeCommitment: grade.gradeCommitment,
        gradeId: grade.id,
        maxScore: grade.maxScore,
        objectiveScore: grade.objectiveScore
      },
      proofArtifact: submission.proofArtifacts[0]
        ? {
            circuitName: submission.proofArtifacts[0].circuitName,
            circuitVersion: submission.proofArtifacts[0].circuitVersion,
            proofHash: submission.proofArtifacts[0].proofHash,
            publicInputsHash: submission.proofArtifacts[0].publicInputsHash,
            verificationStatus: submission.proofArtifacts[0].verificationStatus,
            vkHash: submission.proofArtifacts[0].vkHash
          }
        : null,
      submissionId: submission.id
    };
  }

  async getAuditEvidence(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const [auditRoots, groupRoots] = await Promise.all([
      this.auditRootService.listAuditRoots(examId),
      this.auditRootService.listGroupRoots(examId)
    ]);

    return {
      auditRoots: auditRoots.snapshots,
      currentAuditRoot: auditRoots.currentAuditRoot,
      currentEventCount: auditRoots.currentEventCount,
      examId: exam.id,
      examStatus: exam.status,
      groupRootHistory: groupRoots.history,
      currentGroupRoot: groupRoots.currentGroupRoot
    };
  }

  async getProofArtifacts(examId: string) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: examId
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!exam) {
      throw new NotFoundException('Exam not found');
    }

    const proofArtifacts = await this.prisma.proofArtifact.findMany({
      where: {
        examId,
        verificationStatus: ProofVerificationStatus.VERIFIED
      },
      orderBy: [
        {
          createdAt: 'asc'
        },
        {
          id: 'asc'
        }
      ],
      include: {
        submission: {
          select: {
            id: true,
            submissionIndex: true,
            grades: {
              orderBy: {
                createdAt: 'desc'
              },
              take: 1,
              select: {
                finalScore: true,
                finalizedAt: true,
                gradeCommitment: true,
                maxScore: true,
                status: true
              }
            }
          }
        }
      }
    });

    return {
      examId: exam.id,
      examStatus: exam.status,
      proofArtifacts: proofArtifacts.map((artifact) => ({
        circuitName: artifact.circuitName,
        circuitVersion: artifact.circuitVersion,
        createdAt: artifact.createdAt,
        proofArtifactId: artifact.id,
        proofHash: artifact.proofHash,
        publicInputsHash: artifact.publicInputsHash,
        submissionId: artifact.submissionId,
        submissionIndex: artifact.submission?.submissionIndex ?? null,
        type: artifact.type,
        verificationStatus: artifact.verificationStatus,
        vkHash: artifact.vkHash,
        grade: artifact.submission?.grades[0]
          ? {
              finalScore: artifact.submission.grades[0].finalScore,
              finalizedAt: artifact.submission.grades[0].finalizedAt,
              gradeCommitment: artifact.submission.grades[0].gradeCommitment,
              maxScore: artifact.submission.grades[0].maxScore,
              status: artifact.submission.grades[0].status
            }
          : null
      }))
    };
  }
}
