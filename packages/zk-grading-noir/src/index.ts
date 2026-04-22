import { canonicalJson, sha256Canonical, sha256Hex } from '@proofmark/crypto';
import { type FixedMcqAnswerSheet } from '@proofmark/shared';

export const zkGradingNoirPackageName = '@proofmark/zk-grading-noir';
export const objectiveGradingCircuitName = 'fixed_mcq_grading';
export const objectiveGradingCircuitVersion = 'phase7-dev-hashproof-v1';
export const objectiveGradingVerifierHash = `sha256:${sha256Canonical({
  backend: 'development-hashproof-placeholder',
  circuitName: objectiveGradingCircuitName,
  circuitVersion: objectiveGradingCircuitVersion
})}`;

export type FixedMcqAnswerKey = {
  answers: Array<{
    correctChoiceId: string;
    questionId: string;
  }>;
  version: 'proofmark-fixed-mcq-answer-key-v1';
};

export type FixedMcqGradingPolicy = {
  allowPartialCredit: boolean;
  maxScore: number;
  pointsPerQuestion: number;
  questionCount: number;
  version: 'proofmark-fixed-mcq-policy-v1';
};

export type ObjectiveGradePublicInputs = {
  answerCommitment: string;
  answerKeyCommitment: string;
  gradingPolicyHash: string;
  maxScore: number;
  score: number;
};

export type ObjectiveGradePrivateInputs = {
  answerKey: FixedMcqAnswerKey;
  answerKeySalt: string;
  answerSheet: FixedMcqAnswerSheet;
  answerSheetSalt: string;
  gradingPolicy: FixedMcqGradingPolicy;
};

export type ObjectiveGradeProof = {
  circuitName: string;
  circuitVersion: string;
  proof: string;
  proofHash: string;
  publicInputs: ObjectiveGradePublicInputs;
  publicInputsHash: string;
  verificationKeyHash: string;
};

export type ObjectiveGradeVerificationResult = {
  maxScore: number;
  publicInputsHash: string;
  score: number;
  verified: boolean;
};

function normalizeHash(value: string) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function computeAnswerCommitment(params: {
  answerSheet: FixedMcqAnswerSheet;
  salt: string;
}) {
  return `sha256:${sha256Canonical({
    answerSheet: params.answerSheet,
    salt: params.salt,
    version: 'proofmark-answer-commitment-v1'
  })}`;
}

function computeAnswerKeyCommitment(params: {
  answerKey: FixedMcqAnswerKey;
  salt: string;
}) {
  return `sha256:${sha256Canonical({
    answerKey: params.answerKey,
    purpose: 'proofmark-answer-key-commitment-v1',
    salt: params.salt
  })}`;
}

function computeGradingPolicyHash(gradingPolicy: FixedMcqGradingPolicy) {
  return `sha256:${sha256Canonical(gradingPolicy)}`;
}

function indexAnswerKey(answerKey: FixedMcqAnswerKey) {
  return new Map(
    answerKey.answers.map((answer) => [answer.questionId, answer.correctChoiceId])
  );
}

export function scoreFixedMcqSubmission(params: {
  answerKey: FixedMcqAnswerKey;
  answerSheet: FixedMcqAnswerSheet;
  gradingPolicy: FixedMcqGradingPolicy;
}) {
  const keyByQuestion = indexAnswerKey(params.answerKey);
  let score = 0;

  for (const response of params.answerSheet.responses) {
    const correctChoiceId = keyByQuestion.get(response.questionId);

    if (correctChoiceId && response.selectedChoiceId === correctChoiceId) {
      score += params.gradingPolicy.pointsPerQuestion;
    }
  }

  return {
    maxScore: params.gradingPolicy.maxScore,
    score
  };
}

function createProofPayload(params: {
  privateInputs: ObjectiveGradePrivateInputs;
  publicInputs: ObjectiveGradePublicInputs;
}) {
  return {
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    publicInputsHash: `sha256:${sha256Canonical(params.publicInputs)}`,
    // Development placeholder: this pins the witness deterministically until
    // compiled Noir artifacts are wired in behind the same interface.
    witnessHash: `sha256:${sha256Canonical(params.privateInputs)}`
  };
}

export function generateObjectiveGradeProof(params: {
  answerCommitment: string;
  answerKeyCommitment: string;
  gradingPolicyHash: string;
  privateInputs: ObjectiveGradePrivateInputs;
  score?: number;
}) {
  const expectedAnswerCommitment = computeAnswerCommitment({
    answerSheet: params.privateInputs.answerSheet,
    salt: params.privateInputs.answerSheetSalt
  });

  if (normalizeHash(params.answerCommitment) !== expectedAnswerCommitment) {
    throw new Error('ANSWER_COMMITMENT_MISMATCH');
  }

  const expectedAnswerKeyCommitment = computeAnswerKeyCommitment({
    answerKey: params.privateInputs.answerKey,
    salt: params.privateInputs.answerKeySalt
  });

  if (normalizeHash(params.answerKeyCommitment) !== expectedAnswerKeyCommitment) {
    throw new Error('ANSWER_KEY_COMMITMENT_MISMATCH');
  }

  const expectedPolicyHash = computeGradingPolicyHash(params.privateInputs.gradingPolicy);

  if (normalizeHash(params.gradingPolicyHash) !== expectedPolicyHash) {
    throw new Error('GRADING_POLICY_HASH_MISMATCH');
  }

  const computedScore = scoreFixedMcqSubmission({
    answerKey: params.privateInputs.answerKey,
    answerSheet: params.privateInputs.answerSheet,
    gradingPolicy: params.privateInputs.gradingPolicy
  });

  if (params.score !== undefined && params.score !== computedScore.score) {
    throw new Error('SCORE_MISMATCH');
  }

  const publicInputs: ObjectiveGradePublicInputs = {
    answerCommitment: normalizeHash(params.answerCommitment),
    answerKeyCommitment: normalizeHash(params.answerKeyCommitment),
    gradingPolicyHash: normalizeHash(params.gradingPolicyHash),
    maxScore: computedScore.maxScore,
    score: computedScore.score
  };
  const proofPayload = createProofPayload({
    privateInputs: params.privateInputs,
    publicInputs
  });
  const proof = Buffer.from(canonicalJson(proofPayload), 'utf8').toString('base64');
  const proofHash = `sha256:${sha256Hex(Buffer.from(proof, 'base64'))}`;

  return {
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    proof,
    proofHash,
    publicInputs,
    publicInputsHash: proofPayload.publicInputsHash,
    verificationKeyHash: objectiveGradingVerifierHash
  } satisfies ObjectiveGradeProof;
}

export function verifyObjectiveGradeProof(params: {
  proof: ObjectiveGradeProof;
  privateInputs: ObjectiveGradePrivateInputs;
}) {
  const regeneratedProof = generateObjectiveGradeProof({
    answerCommitment: params.proof.publicInputs.answerCommitment,
    answerKeyCommitment: params.proof.publicInputs.answerKeyCommitment,
    gradingPolicyHash: params.proof.publicInputs.gradingPolicyHash,
    privateInputs: params.privateInputs,
    score: params.proof.publicInputs.score
  });

  return {
    maxScore: regeneratedProof.publicInputs.maxScore,
    publicInputsHash: regeneratedProof.publicInputsHash,
    score: regeneratedProof.publicInputs.score,
    verified:
      regeneratedProof.circuitName === params.proof.circuitName &&
      regeneratedProof.circuitVersion === params.proof.circuitVersion &&
      regeneratedProof.proof === params.proof.proof &&
      regeneratedProof.proofHash === params.proof.proofHash &&
      regeneratedProof.publicInputsHash === params.proof.publicInputsHash &&
      regeneratedProof.verificationKeyHash === params.proof.verificationKeyHash
  } satisfies ObjectiveGradeVerificationResult;
}
