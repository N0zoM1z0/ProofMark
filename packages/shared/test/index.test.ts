import { describe, expect, it } from 'vitest';
import {
  assertExamStatusTransition,
  canTransitionExamStatus,
  createVersionBanner,
  packageName
} from '../src/index.js';

describe('shared package scaffold', () => {
  it('exports stable foundation helpers', () => {
    expect(packageName).toBe('@proofmark/shared');
    expect(createVersionBanner('0.1.0')).toBe('ProofMark 0.1.0');
  });
});

describe('exam lifecycle transitions', () => {
  it('allows the expected happy-path progression', () => {
    expect(
      canTransitionExamStatus('DRAFT', 'COMMITTED', {
        hasQuestionSetHash: true,
        hasAnswerKeyCommitment: true,
        hasGradingPolicyHash: true
      })
    ).toEqual({ ok: true });

    expect(
      canTransitionExamStatus('REGISTRATION', 'PUBLISHED', {
        hasQuestionSetHash: true,
        hasAnswerKeyCommitment: true,
        hasGradingPolicyHash: true,
        hasCurrentGroupRoot: true
      })
    ).toEqual({ ok: true });

    expect(
      canTransitionExamStatus('GRADING', 'FINALIZED', {
        hasGradingArtifacts: true
      })
    ).toEqual({ ok: true });
  });

  it('rejects illegal transitions and missing prerequisites', () => {
    expect(canTransitionExamStatus('DRAFT', 'OPEN')).toEqual({
      ok: false,
      reason: 'Transition from DRAFT to OPEN is not allowed'
    });

    expect(
      canTransitionExamStatus('COMMITTED', 'REGISTRATION', {
        hasQuestionSetHash: true,
        hasAnswerKeyCommitment: true
      })
    ).toEqual({
      ok: false,
      reason: 'REGISTRATION requires committed exam configuration'
    });

    expect(() =>
      assertExamStatusTransition('FINALIZED', 'CLAIMING', {
        hasGradingArtifacts: false
      })
    ).toThrow('CLAIMING requires finalized grading artifacts');
  });
});
