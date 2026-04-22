import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ExamStatus, SubmissionStatus } from '@prisma/client';
import { verifyProof } from '@semaphore-protocol/proof';
import { BlobStorageService } from './blob-storage.service.js';
import { PrismaService } from './prisma.service.js';
import {
  calculateMerkleRoot,
  canonicalJson,
  computeSubmissionMessage,
  computeSubmitScope,
  createMerkleProof,
  formatSubmittedAtBucket,
  getReceiptPublicKeyPem,
  type SubmissionReceiptPayload,
  sha256Hex,
  signReceiptPayload
} from './submission-utils.js';

export interface SemaphoreProof {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  message: string;
  nullifier: string;
  points: string[];
  scope: string;
}

export interface SubmissionInput {
  answerCommitment: string;
  encryptedBlobHash: string;
  encryptedBlobUri: string;
  examId: string;
  examVersion: number;
  groupRoot: string;
  message: string;
  nullifierHash: string;
  proof: SemaphoreProof;
  questionSetHash: string;
  scope: string;
}

const semaphoreVerifyProof = verifyProof as (
  proof: SemaphoreProof
) => Promise<boolean>;

@Injectable()
export class SubmissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlobStorageService)
    private readonly blobStorage: BlobStorageService
  ) {}

  async createSubmission(input: SubmissionInput) {
    const exam = await this.prisma.exam.findUnique({
      where: {
        id: input.examId
      },
      include: {
        versions: {
          select: {
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

    if (exam.status !== ExamStatus.OPEN) {
      throw new ConflictException('EXAM_NOT_OPEN');
    }

    if (!exam.currentGroupRoot || input.groupRoot !== exam.currentGroupRoot) {
      throw new BadRequestException('GROUP_ROOT_UNKNOWN');
    }

    if (!exam.questionSetHash || input.questionSetHash !== exam.questionSetHash) {
      throw new BadRequestException('QUESTION_SET_MISMATCH');
    }

    const currentExamVersion = exam.versions[0]?.version ?? 1;

    if (input.examVersion !== currentExamVersion) {
      throw new BadRequestException('EXAM_VERSION_MISMATCH');
    }

    const expectedScope = computeSubmitScope(exam.id, currentExamVersion);

    if (input.scope !== expectedScope || input.proof.scope !== expectedScope) {
      throw new BadRequestException('SCOPE_MISMATCH');
    }

    const expectedMessage = computeSubmissionMessage({
      answerCommitment: input.answerCommitment,
      encryptedBlobHash: input.encryptedBlobHash,
      examId: exam.id,
      examVersion: currentExamVersion,
      questionSetHash: exam.questionSetHash
    });

    if (input.message !== expectedMessage || input.proof.message !== expectedMessage) {
      throw new BadRequestException('MESSAGE_BINDING_MISMATCH');
    }

    if (
      input.proof.merkleTreeRoot !== input.groupRoot ||
      input.proof.nullifier !== input.nullifierHash
    ) {
      throw new BadRequestException('PROOF_PAYLOAD_MISMATCH');
    }

    const proofIsValid = await semaphoreVerifyProof(input.proof);

    if (!proofIsValid) {
      throw new BadRequestException('PROOF_INVALID');
    }

    await this.blobStorage.assertBlobExists({
      blobUri: input.encryptedBlobUri,
      encryptedBlobHash: input.encryptedBlobHash
    });

    return this.prisma.$transaction(async (tx) => {
      const duplicateSubmission = await tx.submission.findUnique({
        where: {
          examId_nullifierHash: {
            examId: exam.id,
            nullifierHash: input.nullifierHash
          }
        }
      });

      if (duplicateSubmission) {
        throw new ConflictException('NULLIFIER_ALREADY_USED');
      }

      const submissionIndex =
        (await tx.submission.count({
          where: {
            examId: exam.id
          }
        })) + 1;
      const submittedAt = new Date();
      const submittedAtBucket = formatSubmittedAtBucket(submittedAt);
      const previousAuditEvent = await tx.auditEvent.findFirst({
        where: {
          examId: exam.id
        },
        orderBy: {
          seq: 'desc'
        }
      });
      const seq =
        (await tx.auditEvent.count({
          where: {
            examId: exam.id
          }
        })) + 1;
      const payload = {
        answerCommitment: input.answerCommitment,
        encryptedBlobHash: input.encryptedBlobHash,
        nullifierHash: input.nullifierHash,
        submissionIndex
      };
      const payloadHash = sha256Hex(canonicalJson(payload));
      const eventHash = sha256Hex(
        canonicalJson({
          actorPseudonym: null,
          actorRole: 'SUBMISSION_GATEWAY',
          createdAt: submittedAt.toISOString(),
          eventType: 'SubmissionAccepted',
          examId: exam.id,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        })
      );
      const submission = await tx.submission.create({
        data: {
          answerCommitment: input.answerCommitment,
          encryptedBlobHash: input.encryptedBlobHash,
          encryptedBlobUri: input.encryptedBlobUri,
          examId: exam.id,
          groupRoot: input.groupRoot,
          messageHash: input.message,
          nullifierHash: input.nullifierHash,
          status: SubmissionStatus.ACCEPTED,
          submissionIndex,
          submittedAtBucket
        }
      });
      const auditEvent = await tx.auditEvent.create({
        data: {
          actorRole: 'SUBMISSION_GATEWAY',
          createdAt: submittedAt,
          eventHash,
          eventType: 'SubmissionAccepted',
          examId: exam.id,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        }
      });

      await tx.submission.update({
        where: {
          id: submission.id
        },
        data: {
          auditEventId: auditEvent.id
        }
      });

      const eventHashes = (
        await tx.auditEvent.findMany({
          where: {
            examId: exam.id
          },
          orderBy: {
            seq: 'asc'
          },
          select: {
            eventHash: true,
            id: true
          }
        })
      ).map((event) => event.eventHash);
      const auditRoot = calculateMerkleRoot(eventHashes) ?? auditEvent.eventHash;
      const auditInclusionProof = createMerkleProof(
        eventHashes,
        eventHashes.length - 1
      );
      const receiptPayload: SubmissionReceiptPayload = {
        answerCommitment: submission.answerCommitment,
        auditEventHash: auditEvent.eventHash,
        auditEventId: auditEvent.id,
        auditInclusionProof,
        auditRoot,
        encryptedBlobHash: submission.encryptedBlobHash,
        examId: exam.id,
        messageHash: submission.messageHash,
        nullifierHash: submission.nullifierHash,
        submissionId: submission.id,
        submittedAtBucket,
        version: 'proofmark-receipt-v1'
      };
      const serverSignature = signReceiptPayload(receiptPayload);
      const receiptHash = sha256Hex(
        canonicalJson({
          payload: receiptPayload,
          serverSignature
        })
      );

      await tx.submission.update({
        where: {
          id: submission.id
        },
        data: {
          receiptHash
        }
      });

      return {
        receipt: {
          ...receiptPayload,
          serverPublicKey: getReceiptPublicKeyPem(),
          serverSignature
        },
        submissionId: submission.id
      };
    });
  }
}
