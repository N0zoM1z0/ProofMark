import { createFixedMcqAnswerSheet } from '@proofmark/shared';
import { sha256Canonical } from '@proofmark/crypto';
import { describe, expect, it } from 'vitest';
import {
  ensureBarretenbergAvailable,
  generateObjectiveGradeProof,
  objectiveGradingCircuitVersion,
  objectiveGradingVerifierHash,
  verifyObjectiveGradeProof
} from '../src/index.js';

const questionSet = {
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
  title: 'Sample',
  version: 'proofmark-fixed-mcq-v1'
} as const;

function createInputs() {
  const answerSheet = createFixedMcqAnswerSheet({
    answers: {
      q1: 'a',
      q2: 'false'
    },
    examId: 'exam-1',
    examVersion: 1,
    questionSet,
    questionSetHash: 'sha256:questions'
  });
  const privateInputs = {
    answerKey: {
      answers: [
        {
          correctChoiceId: 'a',
          questionId: 'q1'
        },
        {
          correctChoiceId: 'false',
          questionId: 'q2'
        }
      ],
      version: 'proofmark-fixed-mcq-answer-key-v1'
    },
    answerKeySalt: 'answer-key-salt',
    answerSheet,
    answerSheetSalt: 'answer-sheet-salt',
    gradingPolicy: {
      allowPartialCredit: false,
      maxScore: 4,
      pointsPerQuestion: 2,
      questionCount: 2,
      version: 'proofmark-fixed-mcq-policy-v1'
    }
  } as const;

  return {
    answerCommitment: `sha256:${sha256Canonical({
      answerSheet,
      salt: privateInputs.answerSheetSalt,
      version: 'proofmark-answer-commitment-v1'
    })}`,
    answerKeyCommitment: `sha256:${sha256Canonical({
      answerKey: privateInputs.answerKey,
      purpose: 'proofmark-answer-key-commitment-v1',
      salt: privateInputs.answerKeySalt
    })}`,
    gradingPolicyHash: `sha256:${sha256Canonical(privateInputs.gradingPolicy)}`,
    privateInputs
  };
}

describe('zk-grading-noir Barretenberg backend', () => {
  it(
    'generates and verifies a real Noir/Barretenberg grading proof',
    async () => {
      await expect(ensureBarretenbergAvailable()).resolves.toContain('.');
      const inputs = createInputs();
      const proof = await generateObjectiveGradeProof({
        ...inputs
      });
      const verification = await verifyObjectiveGradeProof({
        privateInputs: inputs.privateInputs,
        proof
      });

      expect(proof.circuitVersion).toBe(objectiveGradingCircuitVersion);
      expect(proof.verificationKeyHash).toMatch(/^sha256:[0-9a-f]+$/);
      expect(objectiveGradingVerifierHash).toMatch(/^sha256:[0-9a-f]+$/);
      expect(proof.backend).toBe('barretenberg-cli');
      expect(proof.publicInputs.score).toBe(4);
      expect(verification.verified).toBe(true);
    },
    120_000
  );

  it('rejects wrong score, wrong salt, and wrong answer key commitment', async () => {
    const inputs = createInputs();

    await expect(
      generateObjectiveGradeProof({
        ...inputs,
        score: 2
      })
    ).rejects.toThrow('SCORE_MISMATCH');

    await expect(
      generateObjectiveGradeProof({
        ...inputs,
        privateInputs: {
          ...inputs.privateInputs,
          answerSheetSalt: 'wrong-salt'
        }
      })
    ).rejects.toThrow('ANSWER_COMMITMENT_MISMATCH');

    await expect(
      generateObjectiveGradeProof({
        ...inputs,
        answerKeyCommitment: 'sha256:deadbeef'
      })
    ).rejects.toThrow('ANSWER_KEY_COMMITMENT_MISMATCH');
  });
});
