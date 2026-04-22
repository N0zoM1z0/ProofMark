import { describe, expect, it } from 'vitest';
import {
  assertExamStatusTransition,
  canTransitionExamStatus,
  createFixedMcqAnswerSheet,
  createVersionBanner,
  normalizeFixedMcqQuestionSet,
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

describe('fixed MCQ helpers', () => {
  it('normalizes the question set and encodes ordered answers', () => {
    const questionSet = normalizeFixedMcqQuestionSet({
      questions: [
        {
          choices: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' }
          ],
          id: 'q1',
          prompt: 'First'
        },
        {
          choices: [
            { id: 'true', label: 'True' },
            { id: 'false', label: 'False' }
          ],
          id: 'q2',
          prompt: 'Second'
        }
      ],
      title: 'Sample'
    });

    expect(
      createFixedMcqAnswerSheet({
        answers: {
          q2: 'false'
        },
        examId: 'exam-1',
        examVersion: 2,
        questionSet,
        questionSetHash: 'sha256:test'
      })
    ).toEqual({
      examId: 'exam-1',
      examVersion: 2,
      questionSetHash: 'sha256:test',
      responses: [
        {
          questionId: 'q1',
          selectedChoiceId: null
        },
        {
          questionId: 'q2',
          selectedChoiceId: 'false'
        }
      ],
      version: 'proofmark-answer-sheet-v1'
    });
  });
});
