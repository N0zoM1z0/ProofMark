import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createAnswerCommitment,
  verifyReceipt
} from '../app/student/_lib/proofmark-crypto';

describe('proofmark browser crypto helpers', () => {
  it('creates a stable answer commitment', async () => {
    const commitment = await createAnswerCommitment({
      answerSheet: {
        examId: 'exam-1',
        responses: [
          {
            questionId: 'q1',
            selectedChoiceId: 'a'
          }
        ]
      },
      salt: 'salt-1'
    });

    expect(commitment.commitment).toMatch(/^sha256:/);
    expect(commitment.payload.version).toBe('proofmark-answer-commitment-v1');
  });

  it('verifies a receipt signature and trivial merkle proof locally', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = {
      answerCommitment: 'sha256:answer',
      auditEventHash: 'leaf-hash',
      auditEventId: 'audit-1',
      auditInclusionProof: [],
      auditRoot: 'leaf-hash',
      encryptedBlobHash: 'sha256:blob',
      examId: 'exam-1',
      messageHash: '123',
      nullifierHash: '456',
      submissionId: 'submission-1',
      submittedAtBucket: '2026-04-22T12:00Z/5m',
      version: 'proofmark-receipt-v1'
    };
    const serverSignature = sign(
      null,
      Buffer.from(canonicalJson(payload)),
      privateKey
    ).toString('base64url');
    const verified = await verifyReceipt({
      ...payload,
      serverPublicKey: publicKey
        .export({
          format: 'pem',
          type: 'spki'
        })
        .toString(),
      serverSignature
    });

    expect(verified).toEqual({
      merkleProofValid: true,
      signatureValid: true,
      verified: true
    });
  });
});
