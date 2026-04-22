import { describe, expect, it } from 'vitest';
import {
  buildPublicExamManifest,
  commitAnswerKey,
  getManifestPublicKeyPem,
  hashGradingPolicy,
  hashQuestionSet,
  signManifestPayload,
  verifyManifestSignature
} from '../src/manifest-utils.js';

describe('manifest helpers', () => {
  it('hashes equivalent question sets and grading policies deterministically', () => {
    const questionSetLeft = {
      durationMinutes: 45,
      questions: [
        {
          choices: ['A', 'B', 'C'],
          id: 'q1',
          prompt: 'Pick A'
        }
      ],
      title: 'Quiz'
    };
    const questionSetRight = {
      questions: [
        {
          prompt: 'Pick A',
          id: 'q1',
          choices: ['A', 'B', 'C']
        }
      ],
      title: 'Quiz',
      durationMinutes: 45
    };

    expect(hashQuestionSet(questionSetLeft)).toBe(hashQuestionSet(questionSetRight));
    expect(
      hashGradingPolicy({
        allowPartialCredit: false,
        maxAttempts: 1
      })
    ).toBe(
      hashGradingPolicy({
        maxAttempts: 1,
        allowPartialCredit: false
      })
    );
  });

  it('commits answer keys without exposing plaintext and verifies signed manifests', () => {
    const answerKeyCommitment = commitAnswerKey({
      answerKey: {
        q1: 'A',
        q2: 'C'
      },
      salt: 'phase-5-salt'
    });
    const { manifest, manifestHash } = buildPublicExamManifest({
      answerKeyCommitment,
      courseId: 'cs101',
      currentGroupRoot: '123456789',
      endsAt: new Date('2026-04-22T11:00:00.000Z'),
      examId: 'exam-phase-5',
      examVersion: 1,
      gradingPolicyHash: hashGradingPolicy({
        rubric: 'mcq-v1'
      }),
      questionSetHash: hashQuestionSet({
        questions: [
          {
            choices: ['A', 'B'],
            id: 'q1'
          }
        ]
      }),
      startsAt: new Date('2026-04-22T10:00:00.000Z'),
      title: 'Phase 5 Demo'
    });
    const serverSignature = signManifestPayload(manifest);

    expect(answerKeyCommitment).toMatch(/^sha256:/);
    expect(manifestHash).toMatch(/^sha256:/);
    expect(JSON.stringify(manifest)).not.toContain('"A","C"');
    expect(
      verifyManifestSignature({
        manifest,
        serverPublicKey: getManifestPublicKeyPem(),
        serverSignature
      })
    ).toBe(true);
    expect(serverSignature).toBeTruthy();
  });
});
