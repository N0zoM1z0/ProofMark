import { describe, expect, it } from 'vitest';
import {
  assertExamStatusTransition,
  canTransitionExamStatus,
  createFixedMcqAnswerSheet,
  createVersionBanner,
  evaluateBlindMarkingScores,
  generateBlindMarkingAssignments,
  getSubjectiveQuestionCount,
  normalizeBlindMarkingPolicy,
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

    expect(
      canTransitionExamStatus('CLOSED', 'GRADING', {
        hasSubmissionRoot: true
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
      subjectiveQuestions: [
        {
          id: 'essay-1',
          maxScore: 10,
          prompt: 'Explain why blind marking reduces bias.',
          rubricHash: 'sha256:rubric'
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
        questionSetHash: 'sha256:test',
        subjectiveAnswers: {
          'essay-1': 'Anonymous marking keeps the candidate hidden from the marker.'
        }
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
      subjectiveResponses: [
        {
          questionId: 'essay-1',
          responseText: 'Anonymous marking keeps the candidate hidden from the marker.'
        }
      ],
      version: 'proofmark-answer-sheet-v1'
    });
    expect(getSubjectiveQuestionCount(questionSet)).toBe(1);
  });
});

describe('blind marking helpers', () => {
  it('reproduces assignments and escalates adjudication when scores diverge', async () => {
    const policy = normalizeBlindMarkingPolicy({
      adjudicationDelta: 2,
      markersPerPart: 2
    });
    const firstRun = await generateBlindMarkingAssignments({
      markerIds: ['marker-a', 'marker-b', 'marker-c'],
      policy,
      seed: 'phase10-seed',
      submissionPartIds: ['part-1', 'part-2']
    });
    const secondRun = await generateBlindMarkingAssignments({
      markerIds: ['marker-a', 'marker-b', 'marker-c'],
      policy,
      seed: 'phase10-seed',
      submissionPartIds: ['part-1', 'part-2']
    });

    expect(firstRun).toEqual(secondRun);
    expect(
      evaluateBlindMarkingScores({
        marks: [
          {
            markerId: 'marker-a',
            score: 8
          },
          {
            markerId: 'marker-b',
            score: 3
          }
        ],
        maxScore: 10,
        policy
      })
    ).toEqual({
      adjudicationRequired: true,
      averageScore: null,
      delta: 5,
      finalized: false,
      shouldCreateAdjudication: true
    });
    expect(
      evaluateBlindMarkingScores({
        marks: [
          {
            markerId: 'marker-a',
            score: 8
          },
          {
            markerId: 'marker-b',
            score: 3
          },
          {
            markerId: 'marker-c',
            score: 7
          }
        ],
        maxScore: 10,
        policy
      })
    ).toEqual({
      adjudicationRequired: true,
      averageScore: 6,
      delta: 5,
      finalized: true,
      shouldCreateAdjudication: false
    });
  });
});
