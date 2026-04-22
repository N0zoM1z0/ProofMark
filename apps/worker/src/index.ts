import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  GradeStatus,
  PrismaClient,
  ProofVerificationStatus,
  SubmissionStatus
} from '@prisma/client';
import { canonicalJson, sha256Hex } from '@proofmark/crypto';
import {
  generateObjectiveGradeProof,
  verifyObjectiveGradeProof,
  type FixedMcqAnswerKey,
  type FixedMcqGradingPolicy
} from '@proofmark/zk-grading-noir';
import { decryptSubmissionBlobPayload } from './blob-encryption.js';

function parseBlobUri(blobUri: string) {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(blobUri);

  if (!match) {
    throw new Error('INVALID_BLOB_URI');
  }

  return {
    bucket: match[1],
    objectKey: match[2]
  };
}

async function readBodyAsString(body: unknown) {
  if (!body) {
    throw new Error('EMPTY_BLOB_BODY');
  }

  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  if (typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  throw new Error('UNSUPPORTED_BLOB_BODY');
}

function actorPseudonym(examId: string, submissionId: string) {
  return sha256Hex(`worker:${examId}:${submissionId}`).slice(0, 16);
}

export function createWorkerStatus() {
  return {
    service: 'worker',
    status: 'ready'
  };
}

export class ObjectiveGradingWorker {
  private readonly prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://proofmark:proofmark@127.0.0.1:55432/proofmark'
    })
  });
  private readonly s3 = new S3Client({
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin'
    },
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    region: process.env.S3_REGION ?? 'us-east-1'
  });

  async processSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: {
        id: submissionId
      },
      include: {
        exam: {
          include: {
            versions: {
              orderBy: {
                version: 'desc'
              },
              take: 1
            }
          }
        },
        proofArtifacts: {
          where: {
            type: 'objective-grade-proof'
          }
        }
      }
    });

    if (!submission) {
      throw new Error('SUBMISSION_NOT_FOUND');
    }

    if (submission.status !== SubmissionStatus.ACCEPTED) {
      throw new Error('SUBMISSION_NOT_ACCEPTED');
    }

    if (!['CLOSED', 'GRADING', 'FINALIZED'].includes(submission.exam.status)) {
      throw new Error('EXAM_NOT_READY_FOR_GRADING');
    }

    if (submission.proofArtifacts.some((artifact) => artifact.verificationStatus === 'VERIFIED')) {
      throw new Error('SUBMISSION_ALREADY_GRADED');
    }

    const latestVersion = submission.exam.versions[0];

    if (
      !latestVersion?.answerKeyData ||
      !latestVersion.answerKeySalt ||
      !latestVersion.gradingPolicyData
    ) {
      throw new Error('EXAM_VERSION_SNAPSHOTS_INCOMPLETE');
    }

    const objectLocation = parseBlobUri(submission.encryptedBlobUri);
    const object = await this.s3.send(
      new GetObjectCommand({
        Bucket: objectLocation.bucket,
        Key: objectLocation.objectKey
      })
    );
    const serializedBlob = await readBodyAsString(object.Body);
    const decryptedBlob = decryptSubmissionBlobPayload(serializedBlob);
    const proof = generateObjectiveGradeProof({
      answerCommitment: submission.answerCommitment,
      answerKeyCommitment: submission.exam.answerKeyCommitment!,
      gradingPolicyHash: submission.exam.gradingPolicyHash!,
      privateInputs: {
        answerKey: latestVersion.answerKeyData as FixedMcqAnswerKey,
        answerKeySalt: latestVersion.answerKeySalt,
        answerSheet: decryptedBlob.answerSheet,
        answerSheetSalt: decryptedBlob.answerSalt,
        gradingPolicy: latestVersion.gradingPolicyData as FixedMcqGradingPolicy
      }
    });
    const verification = verifyObjectiveGradeProof({
      privateInputs: {
        answerKey: latestVersion.answerKeyData as FixedMcqAnswerKey,
        answerKeySalt: latestVersion.answerKeySalt,
        answerSheet: decryptedBlob.answerSheet,
        answerSheetSalt: decryptedBlob.answerSalt,
        gradingPolicy: latestVersion.gradingPolicyData as FixedMcqGradingPolicy
      },
      proof
    });

    if (!verification.verified) {
      throw new Error('OBJECTIVE_GRADE_PROOF_INVALID');
    }

    return this.prisma.$transaction(async (tx) => {
      const previousAuditEvent = await tx.auditEvent.findFirst({
        where: {
          examId: submission.examId
        },
        orderBy: {
          seq: 'desc'
        }
      });
      const seq =
        (await tx.auditEvent.count({
          where: {
            examId: submission.examId
          }
        })) + 1;
      const payload = {
        gradeProofHash: proof.proofHash,
        score: proof.publicInputs.score,
        submissionId: submission.id
      };
      const payloadHash = sha256Hex(canonicalJson(payload));
      const createdAt = new Date();
      const eventHash = sha256Hex(
        canonicalJson({
          actorPseudonym: actorPseudonym(submission.examId, submission.id),
          actorRole: 'GRADING_WORKER',
          createdAt: createdAt.toISOString(),
          eventType: 'ObjectiveGradeVerified',
          examId: submission.examId,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        })
      );
      const auditEvent = await tx.auditEvent.create({
        data: {
          actorPseudonym: actorPseudonym(submission.examId, submission.id),
          actorRole: 'GRADING_WORKER',
          createdAt,
          eventHash,
          eventType: 'ObjectiveGradeVerified',
          examId: submission.examId,
          payloadHash,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        }
      });
      const proofArtifact = await tx.proofArtifact.create({
        data: {
          circuitName: proof.circuitName,
          circuitVersion: proof.circuitVersion,
          examId: submission.examId,
          proofHash: proof.proofHash,
          publicInputsHash: proof.publicInputsHash,
          submissionId: submission.id,
          type: 'objective-grade-proof',
          verificationStatus: ProofVerificationStatus.VERIFIED,
          vkHash: proof.verificationKeyHash
        }
      });
      const grade = await tx.grade.create({
        data: {
          auditEventId: auditEvent.id,
          examId: submission.examId,
          finalScore: proof.publicInputs.score,
          gradeCommitment: `sha256:${sha256Hex(
            canonicalJson({
              maxScore: proof.publicInputs.maxScore,
              score: proof.publicInputs.score,
              submissionId: submission.id
            })
          )}`,
          maxScore: proof.publicInputs.maxScore,
          objectiveScore: proof.publicInputs.score,
          proofArtifactsRoot: proof.proofHash,
          status: GradeStatus.VERIFIED,
          submissionId: submission.id
        }
      });

      return {
        auditEventId: auditEvent.id,
        gradeId: grade.id,
        maxScore: proof.publicInputs.maxScore,
        proofArtifactId: proofArtifact.id,
        score: proof.publicInputs.score,
        submissionId: submission.id
      };
    });
  }

  async processExam(examId: string) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        examId,
        proofArtifacts: {
          none: {
            type: 'objective-grade-proof',
            verificationStatus: ProofVerificationStatus.VERIFIED
          }
        },
        status: SubmissionStatus.ACCEPTED
      },
      orderBy: {
        submissionIndex: 'asc'
      },
      select: {
        id: true
      }
    });
    const results = [];

    for (const submission of submissions) {
      results.push(await this.processSubmission(submission.id));
    }

    return {
      examId,
      gradedCount: results.length,
      results
    };
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

async function main() {
  const worker = new ObjectiveGradingWorker();
  const examId = process.argv.find((arg) => arg.startsWith('--exam-id='))?.split('=').at(1);
  const submissionId = process.argv
    .find((arg) => arg.startsWith('--submission-id='))
    ?.split('=')
    .at(1);

  try {
    if (submissionId) {
      console.log(JSON.stringify(await worker.processSubmission(submissionId), null, 2));
      return;
    }

    if (examId) {
      console.log(JSON.stringify(await worker.processExam(examId), null, 2));
      return;
    }

    console.log(JSON.stringify(createWorkerStatus()));
  } finally {
    await worker.close();
  }
}

if (process.env.NODE_ENV !== 'test') {
  void main();
}
