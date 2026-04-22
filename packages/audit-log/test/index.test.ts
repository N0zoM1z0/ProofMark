import { describe, expect, it } from 'vitest';
import {
  appendAuditEvent,
  calculateAuditRoot,
  createAuditEvent,
  createMerkleProof,
  createReceiptPayload,
  verifyMerkleProof,
  verifyReceiptPayload
} from '../src/index.js';
import {
  generateEd25519KeyPair,
  signCanonicalPayload,
  verifyCanonicalSignature
} from '../../crypto/src/index.js';

describe('audit log append and proof flow', () => {
  it('computes a deterministic audit root and inclusion proof', () => {
    const firstEvent = appendAuditEvent([], {
      examId: 'exam-1',
      eventType: 'ExamCreated',
      actorRole: 'ADMIN',
      payload: { title: 'Midterm' },
      createdAt: '2026-04-22T10:00:00.000Z'
    });
    const secondEvent = appendAuditEvent([firstEvent], {
      examId: 'exam-1',
      eventType: 'IdentityCommitmentAdded',
      actorRole: 'REGISTRAR',
      payload: { commitment: '0xabc' },
      createdAt: '2026-04-22T10:05:00.000Z'
    });
    const events = [firstEvent, secondEvent];
    const thirdEvent = appendAuditEvent(events, {
      examId: 'exam-1',
      eventType: 'SubmissionAccepted',
      actorRole: 'SUBMISSION_GATEWAY',
      payload: { nullifierHash: '0x123', blobHash: 'sha256:deadbeef' },
      createdAt: '2026-04-22T10:10:00.000Z'
    });
    const fullEventList = [...events, thirdEvent];
    const auditRoot = calculateAuditRoot(fullEventList);
    const proof = createMerkleProof(
      fullEventList.map((event) => event.eventHash),
      2
    );

    expect(auditRoot).toBeTruthy();
    expect(
      verifyMerkleProof({
        leafHash: thirdEvent.eventHash,
        root: auditRoot,
        proof
      })
    ).toBe(true);

    const tamperedEvent = createAuditEvent(
      {
        examId: 'exam-1',
        eventType: 'SubmissionAccepted',
        actorRole: 'SUBMISSION_GATEWAY',
        payload: {
          nullifierHash: '0x123',
          blobHash: 'sha256:mutated'
        },
        createdAt: '2026-04-22T10:10:00.000Z'
      },
      {
        seq: 3,
        prevEventHash: secondEvent.eventHash
      }
    );

    expect(
      verifyMerkleProof({
        leafHash: tamperedEvent.eventHash,
        root: auditRoot,
        proof
      })
    ).toBe(false);
  });
});

describe('signed receipts', () => {
  it('detects signature and inclusion tampering', () => {
    const event = appendAuditEvent([], {
      examId: 'exam-1',
      eventType: 'SubmissionAccepted',
      actorRole: 'SUBMISSION_GATEWAY',
      payload: { answerCommitment: '0xaaa' },
      createdAt: '2026-04-22T10:15:00.000Z'
    });
    const root = calculateAuditRoot([event]);
    const receiptPayload = createReceiptPayload({
      examId: 'exam-1',
      submissionId: 'submission-1',
      nullifierHash: '0x01',
      messageHash: '0x02',
      answerCommitment: '0x03',
      encryptedBlobHash: 'sha256:blob',
      submittedAtBucket: '2026-04-22T10:15Z/5m',
      auditEventId: 'event-1',
      auditEventHash: event.eventHash,
      auditRoot: root ?? '',
      auditInclusionProof: createMerkleProof([event.eventHash], 0)
    });
    const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
    const signature = signCanonicalPayload(receiptPayload, privateKeyPem);
    const signedReceipt = {
      payload: receiptPayload,
      signature
    };

    expect(verifyReceiptPayload(signedReceipt)).toBe(true);
    expect(
      verifyCanonicalSignature(receiptPayload, signature, publicKeyPem)
    ).toBe(true);
    expect(
      verifyCanonicalSignature(
        {
          ...receiptPayload,
          messageHash: '0x04'
        },
        signature,
        publicKeyPem
      )
    ).toBe(false);
    expect(
      verifyReceiptPayload({
        payload: {
          ...receiptPayload,
          auditRoot: 'tampered-root'
        },
        signature
      })
    ).toBe(false);
  });
});
