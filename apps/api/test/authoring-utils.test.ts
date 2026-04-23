import { describe, expect, it } from 'vitest';
import {
  normalizeQuestionBankEntry,
  parseCsvAuthoringBundle,
  parseMarkdownAuthoringBundle
} from '../src/authoring-utils.js';

describe('authoring utils', () => {
  it('parses the markdown import format into a normalized bundle', () => {
    const bundle = parseMarkdownAuthoringBundle(`# ZK Midterm
> courseId: zk-101
> startsAt: 2026-05-01T09:00:00Z
> endsAt: 2026-05-01T10:00:00Z

## Instructions
Answer every question.

## MCQ q1
What does a nullifier prevent?
- [a] Replay
- [b] Encryption
- [c] Compression
Answer: a

## SUBJECTIVE s1
Explain why private receipts improve auditability.
Rubric: sha256:rubric-private-receipts-v1
MaxScore: 10

## Policy
PointsPerQuestion: 2
MarkersPerPart: 3
AdjudicationDelta: 1`);

    expect(bundle.exam.title).toBe('ZK Midterm');
    expect(bundle.exam.courseId).toBe('zk-101');
    expect(bundle.questionSet.questions).toHaveLength(1);
    expect(bundle.answerKey.q1).toBe('a');
    expect(bundle.questionSet.subjectiveQuestions?.[0]?.maxScore).toBe(10);
    expect(bundle.gradingPolicy.pointsPerQuestion).toBe(2);
    expect(bundle.gradingPolicy.subjectiveMarking?.markersPerPart).toBe(3);
  });

  it('parses the csv import format into a normalized bundle', () => {
    const bundle = parseCsvAuthoringBundle(`# title: CSV Quiz
# course_id: csv-101
# instructions: Answer all rows.
# points_per_question: 1
# markers_per_part: 2
# adjudication_delta: 2
type,id,prompt,choice_a,choice_b,choice_c,choice_d,correct_choice_id,rubric_hash,max_score
mcq,q1,What does a Merkle root commit to?,Leaves,Signatures,Wallets,Gas,a,,
subjective,s1,Explain why blinded marking matters.,,,,,,sha256:rubric-blind-marking-v1,8`);

    expect(bundle.exam.title).toBe('CSV Quiz');
    expect(bundle.questionSet.questions[0]?.choices[0]?.label).toBe('Leaves');
    expect(bundle.answerKey.q1).toBe('a');
    expect(bundle.questionSet.subjectiveQuestions?.[0]?.rubricHash).toBe(
      'sha256:rubric-blind-marking-v1'
    );
  });

  it('normalizes a question-bank entry', () => {
    const entry = normalizeQuestionBankEntry({
      tags: ['zk', 'privacy'],
      title: 'Nullifier basics',
      value: {
        choices: [
          { id: 'a', label: 'Replay' },
          { id: 'b', label: 'Encryption' }
        ],
        correctChoiceId: 'a',
        id: 'q1',
        prompt: 'What does a nullifier prevent?',
        type: 'mcq'
      }
    });

    expect(entry.tags).toEqual(['zk', 'privacy']);
    expect(entry.value.type).toBe('mcq');
    expect(entry.value.correctChoiceId).toBe('a');
  });
});
