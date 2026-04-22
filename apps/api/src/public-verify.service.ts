import {
  BadRequestException,
  Injectable
} from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import {
  canonicalJson,
  getReceiptPublicKeyPem,
  sha256Hex,
  type SubmissionReceiptEnvelope,
  verifyReceiptEnvelope
} from './submission-utils.js';

function isMerkleProofNode(
  value: unknown
): value is SubmissionReceiptEnvelope['auditInclusionProof'][number] {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate.position === 'left' || candidate.position === 'right') &&
    typeof candidate.hash === 'string'
  );
}

function coerceReceiptEnvelope(value: unknown): SubmissionReceiptEnvelope {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new BadRequestException('Receipt must be a JSON object');
  }

  const candidate = value as Record<string, unknown>;
  const requiredStringFields = [
    'answerCommitment',
    'auditEventHash',
    'auditEventId',
    'auditRoot',
    'encryptedBlobHash',
    'examId',
    'messageHash',
    'nullifierHash',
    'serverPublicKey',
    'serverSignature',
    'submissionId',
    'submittedAtBucket',
    'version'
  ] as const;

  for (const fieldName of requiredStringFields) {
    if (typeof candidate[fieldName] !== 'string' || !candidate[fieldName]) {
      throw new BadRequestException(`Receipt field ${fieldName} is required`);
    }
  }

  if (
    !Array.isArray(candidate.auditInclusionProof) ||
    !candidate.auditInclusionProof.every(isMerkleProofNode)
  ) {
    throw new BadRequestException('Receipt field auditInclusionProof is invalid');
  }

  return {
    answerCommitment: candidate.answerCommitment as string,
    auditEventHash: candidate.auditEventHash as string,
    auditEventId: candidate.auditEventId as string,
    auditInclusionProof: candidate.auditInclusionProof,
    auditRoot: candidate.auditRoot as string,
    encryptedBlobHash: candidate.encryptedBlobHash as string,
    examId: candidate.examId as string,
    messageHash: candidate.messageHash as string,
    nullifierHash: candidate.nullifierHash as string,
    serverPublicKey: candidate.serverPublicKey as string,
    serverSignature: candidate.serverSignature as string,
    submissionId: candidate.submissionId as string,
    submittedAtBucket: candidate.submittedAtBucket as string,
    version: candidate.version as string
  };
}

@Injectable()
export class PublicVerifyService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyReceipt(input: unknown) {
    const receipt = coerceReceiptEnvelope(input);
    const verification = verifyReceiptEnvelope(receipt);
    const configuredPublicKey = getReceiptPublicKeyPem();
    const publicKeyMatchesConfigured = receipt.serverPublicKey === configuredPublicKey;
    const receiptPayload = {
      answerCommitment: receipt.answerCommitment,
      auditEventHash: receipt.auditEventHash,
      auditEventId: receipt.auditEventId,
      auditInclusionProof: receipt.auditInclusionProof,
      auditRoot: receipt.auditRoot,
      encryptedBlobHash: receipt.encryptedBlobHash,
      examId: receipt.examId,
      messageHash: receipt.messageHash,
      nullifierHash: receipt.nullifierHash,
      submissionId: receipt.submissionId,
      submittedAtBucket: receipt.submittedAtBucket,
      version: receipt.version
    };
    const receiptHash = sha256Hex(
      canonicalJson({
        payload: receiptPayload,
        serverPublicKey: receipt.serverPublicKey,
        serverSignature: receipt.serverSignature
      })
    );
    const legacyReceiptHash = sha256Hex(
      canonicalJson({
        payload: receiptPayload,
        serverSignature: receipt.serverSignature
      })
    );
    const submission = await this.prisma.submission.findUnique({
      where: {
        id: receipt.submissionId
      },
      select: {
        answerCommitment: true,
        auditEventId: true,
        encryptedBlobHash: true,
        examId: true,
        messageHash: true,
        nullifierHash: true,
        receiptHash: true,
        status: true
      }
    });
    const matchesSubmission =
      submission?.examId === receipt.examId &&
      submission?.answerCommitment === receipt.answerCommitment &&
      submission?.encryptedBlobHash === receipt.encryptedBlobHash &&
      submission?.messageHash === receipt.messageHash &&
      submission?.nullifierHash === receipt.nullifierHash &&
      submission?.auditEventId === receipt.auditEventId;
    const matchesStoredReceiptHash =
      submission?.receiptHash === receiptHash ||
      submission?.receiptHash === legacyReceiptHash;
    const auditEvent = await this.prisma.auditEvent.findUnique({
      where: {
        id: receipt.auditEventId
      },
      select: {
        eventHash: true,
        examId: true,
        seq: true
      }
    });
    const matchesAuditEvent =
      auditEvent?.examId === receipt.examId &&
      auditEvent?.eventHash === receipt.auditEventHash;

    return {
      checks: {
        matchesAuditEvent: Boolean(matchesAuditEvent),
        matchesStoredReceiptHash: Boolean(matchesStoredReceiptHash),
        matchesSubmission: Boolean(matchesSubmission),
        merkleProofValid: verification.merkleProofValid,
        publicKeyMatchesConfigured,
        signatureValid: verification.signatureValid
      },
      examId: receipt.examId,
      receiptHash,
      storedSubmissionStatus: submission?.status ?? null,
      submissionId: receipt.submissionId,
      verified:
        verification.verified &&
        publicKeyMatchesConfigured &&
        Boolean(matchesSubmission) &&
        Boolean(matchesAuditEvent) &&
        Boolean(matchesStoredReceiptHash)
    };
  }
}
