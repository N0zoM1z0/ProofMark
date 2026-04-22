import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  generateEd25519KeyPair,
  sha256Canonical,
  signCanonicalPayload,
  verifyCanonicalSignature
} from '../src/index.js';

describe('canonical JSON', () => {
  it('produces stable hashes regardless of key order', () => {
    const left = {
      examId: 'exam-1',
      payload: {
        score: 85,
        rubric: ['clarity', 'accuracy']
      }
    };

    const right = {
      payload: {
        rubric: ['clarity', 'accuracy'],
        score: 85
      },
      examId: 'exam-1'
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256Canonical(left)).toBe(sha256Canonical(right));
  });
});

describe('canonical signatures', () => {
  it('fails verification after payload mutation', () => {
    const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
    const payload = {
      submissionId: 'submission-1',
      finalScore: 9
    };
    const signature = signCanonicalPayload(payload, privateKeyPem);

    expect(verifyCanonicalSignature(payload, signature, publicKeyPem)).toBe(
      true
    );
    expect(
      verifyCanonicalSignature(
        {
          ...payload,
          finalScore: 10
        },
        signature,
        publicKeyPem
      )
    ).toBe(false);
  });
});
