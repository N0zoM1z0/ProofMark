import { createFixedMcqAnswerSheet } from '@proofmark/shared';
import { sha256Canonical } from '@proofmark/crypto';
import { describe, expect, it } from 'vitest';
import {
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

describe('zk-grading-noir development backend', () => {
  it('generates and verifies a deterministic grading proof', () => {
    const inputs = createInputs();
    const proof = generateObjectiveGradeProof({
      ...inputs
    });
    const verification = verifyObjectiveGradeProof({
      privateInputs: inputs.privateInputs,
      proof
    });

    expect(proof.circuitVersion).toBe(objectiveGradingCircuitVersion);
    expect(proof.verificationKeyHash).toBe(objectiveGradingVerifierHash);
    expect(proof.publicInputs.score).toBe(4);
    expect(verification.verified).toBe(true);
  });

  it('rejects wrong score, wrong salt, and wrong answer key commitment', () => {
    const inputs = createInputs();

    expect(() =>
      generateObjectiveGradeProof({
        ...inputs,
        score: 2
      })
    ).toThrow('SCORE_MISMATCH');

    expect(() =>
      generateObjectiveGradeProof({
        ...inputs,
        privateInputs: {
          ...inputs.privateInputs,
          answerSheetSalt: 'wrong-salt'
        }
      })
    ).toThrow('ANSWER_COMMITMENT_MISMATCH');

    expect(() =>
      generateObjectiveGradeProof({
        ...inputs,
        answerKeyCommitment: 'sha256:deadbeef'
      })
    ).toThrow('ANSWER_KEY_COMMITMENT_MISMATCH');
  });
});
