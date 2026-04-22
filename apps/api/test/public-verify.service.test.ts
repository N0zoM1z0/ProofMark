import { describe, expect, it } from 'vitest';
import { PublicVerifyService } from '../src/public-verify.service.js';
import {
  calculateMerkleRoot,
  canonicalJson,
  createMerkleProof,
  getReceiptPublicKeyPem,
  sha256Hex,
  signReceiptPayload,
  type SubmissionReceiptEnvelope
} from '../src/submission-utils.js';

function createReceiptFixture() {
  const auditEventHash = sha256Hex('audit-event-1');
  const auditRoot = calculateMerkleRoot([auditEventHash]) ?? auditEventHash;
  const receiptPayload = {
    answerCommitment: 'sha256:answer',
    auditEventHash,
    auditEventId: 'audit-1',
    auditInclusionProof: createMerkleProof([auditEventHash], 0),
    auditRoot,
    encryptedBlobHash: 'sha256:blob',
    examId: 'exam-1',
    messageHash: '123',
    nullifierHash: '456',
    submissionId: 'submission-1',
    submittedAtBucket: '2026-04-22T15:00Z/5m',
    version: 'proofmark-receipt-v1'
  };
  const serverPublicKey = getReceiptPublicKeyPem();
  const serverSignature = signReceiptPayload(receiptPayload);
  const receipt: SubmissionReceiptEnvelope = {
    ...receiptPayload,
    serverPublicKey,
    serverSignature
  };
  const receiptHash = sha256Hex(
    canonicalJson({
      payload: receiptPayload,
      serverPublicKey,
      serverSignature
    })
  );

  return {
    receipt,
    receiptHash
  };
}

describe('PublicVerifyService', () => {
  it('verifies an untampered stored receipt', async () => {
    const { receipt, receiptHash } = createReceiptFixture();
    const service = new PublicVerifyService({
      auditEvent: {
        findUnique: async () => ({
          eventHash: receipt.auditEventHash,
          examId: receipt.examId,
          seq: 1
        })
      },
      submission: {
        findUnique: async () => ({
          answerCommitment: receipt.answerCommitment,
          auditEventId: receipt.auditEventId,
          encryptedBlobHash: receipt.encryptedBlobHash,
          examId: receipt.examId,
          messageHash: receipt.messageHash,
          nullifierHash: receipt.nullifierHash,
          receiptHash,
          status: 'ACCEPTED'
        })
      }
    } as never);

    await expect(service.verifyReceipt(receipt)).resolves.toMatchObject({
      checks: {
        matchesAuditEvent: true,
        matchesStoredReceiptHash: true,
        matchesSubmission: true,
        merkleProofValid: true,
        publicKeyMatchesConfigured: true,
        signatureValid: true
      },
      verified: true
    });
  });

  it('reports failure when a receipt is tampered after signing', async () => {
    const { receipt, receiptHash } = createReceiptFixture();
    const service = new PublicVerifyService({
      auditEvent: {
        findUnique: async () => ({
          eventHash: receipt.auditEventHash,
          examId: receipt.examId,
          seq: 1
        })
      },
      submission: {
        findUnique: async () => ({
          answerCommitment: receipt.answerCommitment,
          auditEventId: receipt.auditEventId,
          encryptedBlobHash: receipt.encryptedBlobHash,
          examId: receipt.examId,
          messageHash: receipt.messageHash,
          nullifierHash: receipt.nullifierHash,
          receiptHash,
          status: 'ACCEPTED'
        })
      }
    } as never);

    const tamperedReceipt = {
      ...receipt,
      messageHash: '999'
    };

    await expect(service.verifyReceipt(tamperedReceipt)).resolves.toMatchObject({
      checks: {
        matchesStoredReceiptHash: false,
        matchesSubmission: false,
        signatureValid: false
      },
      verified: false
    });
  });
});
