import { describe, expect, it } from 'vitest';
import {
  computeSubmissionMessage,
  computeSubmitScope,
  formatSubmittedAtBucket
} from '../src/submission-utils.js';

describe('submission helpers', () => {
  it('computes deterministic submission messages', () => {
    const left = computeSubmissionMessage({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      examId: 'exam-1',
      questionSetHash: 'sha256:questions'
    });
    const right = computeSubmissionMessage({
      answerCommitment: '0xaaa',
      encryptedBlobHash: 'sha256:blob',
      examId: 'exam-1',
      questionSetHash: 'sha256:questions'
    });

    expect(left).toBe(right);
    expect(
      computeSubmissionMessage({
        answerCommitment: '0xbbb',
        encryptedBlobHash: 'sha256:blob',
        examId: 'exam-1',
        questionSetHash: 'sha256:questions'
      })
    ).not.toBe(left);
  });

  it('computes stable submission scopes and time buckets', () => {
    expect(computeSubmitScope('exam-1')).toBe(computeSubmitScope('exam-1'));
    expect(computeSubmitScope('exam-2')).not.toBe(computeSubmitScope('exam-1'));
    expect(formatSubmittedAtBucket(new Date('2026-04-22T10:07:41.000Z'))).toBe(
      '2026-04-22T10:05Z/5m'
    );
  });
});
