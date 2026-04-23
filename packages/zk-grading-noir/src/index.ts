import { canonicalJson, sha256Canonical, sha256Hex } from '@proofmark/crypto';
import {
  type BlindMarkingPolicy,
  type FixedMcqAnswerSheet
} from '@proofmark/shared';
import { Noir } from '@noir-lang/noir_js';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

export const zkGradingNoirPackageName = '@proofmark/zk-grading-noir';
export const objectiveGradingCircuitName = 'fixed_mcq_grading';
export const objectiveGradingCircuitVersion = 'noir-1.0.0-beta.20-bb-cli-v1';
export const objectiveGradingMaxQuestions = 32;
export const subjectiveAggregationCircuitName = 'subjective_aggregation';
export const subjectiveAggregationCircuitVersion = 'noir-1.0.0-beta.20-bb-cli-v1';
export const subjectiveAggregationMaxParts = 16;
export const subjectiveAggregationMaxMarksPerPart = 5;
export const finalGradeCompositionCircuitName = 'final_grade_composition';
export const finalGradeCompositionCircuitVersion = 'noir-1.0.0-beta.20-bb-cli-v1';
export const gradingScoreScale = 100;

const require = createRequire(import.meta.url);
type NoirCircuitArtifact = {
  bytecode: string;
  hash: number;
  noir_version: string;
};
const fixedMcqGradingCircuit = require('./artifacts/fixed_mcq_grading.json') as NoirCircuitArtifact;
const subjectiveAggregationCircuit = require('./artifacts/subjective_aggregation.json') as NoirCircuitArtifact;
const finalGradeCompositionCircuit = require('./artifacts/final_grade_composition.json') as NoirCircuitArtifact;
const execFileAsync = promisify(execFile);
const bn254ScalarField =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type GradingProofType =
  | 'final-grade-composition-proof'
  | 'objective-grade-proof'
  | 'subjective-aggregation-proof';

export const gradingProofRegistry = {
  finalGradeComposition: {
    circuitHash: String(finalGradeCompositionCircuit.hash),
    circuitName: finalGradeCompositionCircuitName,
    circuitVersion: finalGradeCompositionCircuitVersion,
    maxInputs: null,
    noirVersion: finalGradeCompositionCircuit.noir_version,
    proofType: 'final-grade-composition-proof' as const
  },
  objectiveMcq: {
    circuitHash: String(fixedMcqGradingCircuit.hash),
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    maxQuestions: objectiveGradingMaxQuestions,
    noirVersion: fixedMcqGradingCircuit.noir_version,
    proofType: 'objective-grade-proof' as const
  },
  subjectiveAggregation: {
    circuitHash: String(subjectiveAggregationCircuit.hash),
    circuitName: subjectiveAggregationCircuitName,
    circuitVersion: subjectiveAggregationCircuitVersion,
    maxMarksPerPart: subjectiveAggregationMaxMarksPerPart,
    maxParts: subjectiveAggregationMaxParts,
    noirVersion: subjectiveAggregationCircuit.noir_version,
    proofType: 'subjective-aggregation-proof' as const
  }
};

export const objectiveGradingVerifierHash = `sha256:${sha256Canonical({
  backend: 'barretenberg-cli-ultra-honk',
  circuitHash: fixedMcqGradingCircuit.hash,
  circuitName: objectiveGradingCircuitName,
  circuitVersion: objectiveGradingCircuitVersion,
  noirVersion: fixedMcqGradingCircuit.noir_version
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
  circuitHash: string;
  gradingPolicyHash: string;
  maxScore: number;
  questionCount: number;
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
  backend: 'barretenberg-cli';
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

type BarretenbergProofEnvelope = {
  proof: unknown;
  publicInputs: unknown;
  verificationKey: unknown;
};

type StoredProofEnvelope = {
  barretenberg: BarretenbergProofEnvelope;
  circuitName: string;
  circuitVersion: string;
  publicInputs: Record<string, unknown>;
};

type BaseGradeProof<TPublicInputs extends Record<string, unknown>> = {
  backend: 'barretenberg-cli';
  circuitName: string;
  circuitVersion: string;
  proof: string;
  proofHash: string;
  publicInputs: TPublicInputs;
  publicInputsHash: string;
  verificationKeyHash: string;
};

export type SubjectiveAggregationPartInput = {
  marks: Array<{
    markerId: string;
    score: number;
  }>;
  maxScore: number;
  partCommitment: string;
  partId: string;
};

export type SubjectiveAggregationPrivateInputs = {
  parts: SubjectiveAggregationPartInput[];
  policy: Pick<BlindMarkingPolicy, 'adjudicationDelta' | 'markersPerPart'>;
};

export type SubjectiveAggregationPublicInputs = {
  aggregationInputHash: string;
  adjudicationDelta: number;
  circuitHash: string;
  markersPerPart: number;
  partCount: number;
  scoreScale: number;
  subjectiveMaxScore: number;
  subjectiveScore: number;
};

export type SubjectiveAggregationProof =
  BaseGradeProof<SubjectiveAggregationPublicInputs> & {
    proofType: 'subjective-aggregation-proof';
  };

export type FinalGradeCompositionPublicInputs = {
  circuitHash: string;
  finalScore: number;
  gradeCommitment: string | null;
  maxScore: number;
  objectiveMaxScore: number;
  objectiveScore: number;
  proofArtifactsRoot: string | null;
  scoreScale: number;
  subjectiveMaxScore: number;
  subjectiveScore: number;
};

export type FinalGradeCompositionProof =
  BaseGradeProof<FinalGradeCompositionPublicInputs> & {
    proofType: 'final-grade-composition-proof';
  };

function normalizeHash(value: string) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

function toScaledScore(value: number, fieldName: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName.toUpperCase()}_INVALID`);
  }

  return Math.round(value * gradingScoreScale);
}

function fromScaledScore(value: number) {
  return value / gradingScoreScale;
}

function roundedAverageScaled(scores: number[]) {
  if (scores.length === 0) {
    throw new Error('AVERAGE_REQUIRES_SCORES');
  }

  const sum = scores.reduce((total, score) => total + score, 0);

  return Math.floor((sum + Math.floor(scores.length / 2)) / scores.length);
}

function decodeStoredProofEnvelope(proof: string) {
  return JSON.parse(Buffer.from(proof, 'base64').toString('utf8')) as
    StoredProofEnvelope;
}

function computeProofEnvelopeHashes(params: {
  barretenberg: BarretenbergProofEnvelope;
  proof: string;
  publicInputs: Record<string, unknown>;
}) {
  return {
    proofHash: `sha256:${sha256Hex(Buffer.from(params.proof, 'base64'))}`,
    publicInputsHash: `sha256:${sha256Canonical({
      circuitPublicInputs: params.barretenberg.publicInputs,
      proofmarkPublicInputs: params.publicInputs
    })}`,
    verificationKeyHash: `sha256:${sha256Canonical(
      params.barretenberg.verificationKey
    )}`
  };
}

function buildStoredProof(params: {
  barretenberg: BarretenbergProofEnvelope;
  circuitName: string;
  circuitVersion: string;
  publicInputs: Record<string, unknown>;
}) {
  const proofEnvelope = {
    barretenberg: params.barretenberg,
    circuitName: params.circuitName,
    circuitVersion: params.circuitVersion,
    publicInputs: params.publicInputs
  };
  const proof = Buffer.from(canonicalJson(proofEnvelope), 'utf8').toString(
    'base64'
  );

  return {
    ...computeProofEnvelopeHashes({
      barretenberg: params.barretenberg,
      proof,
      publicInputs: params.publicInputs
    }),
    proof
  };
}

async function verifyStoredProof(params: {
  circuitName: string;
  circuitVersion: string;
  proof: string;
  proofHash: string;
  publicInputs: Record<string, unknown>;
  publicInputsHash: string;
  verificationKeyHash: string;
}) {
  const decodedEnvelope = decodeStoredProofEnvelope(params.proof);
  const hashes = computeProofEnvelopeHashes({
    barretenberg: decodedEnvelope.barretenberg,
    proof: params.proof,
    publicInputs: decodedEnvelope.publicInputs
  });
  const barretenbergVerified = await verifyBarretenbergProof(
    decodedEnvelope.barretenberg
  );

  return (
    barretenbergVerified &&
    decodedEnvelope.circuitName === params.circuitName &&
    decodedEnvelope.circuitVersion === params.circuitVersion &&
    canonicalJson(decodedEnvelope.publicInputs) ===
      canonicalJson(params.publicInputs) &&
    hashes.proofHash === params.proofHash &&
    hashes.publicInputsHash === params.publicInputsHash &&
    hashes.verificationKeyHash === params.verificationKeyHash
  );
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

function hashChoiceId(questionId: string, choiceId: string | null) {
  if (!choiceId) {
    return '0';
  }

  const digest = BigInt(
    `0x${sha256Hex(
      canonicalJson({
        choiceId,
        questionId,
        version: 'proofmark-noir-choice-hash-v1'
      })
    )}`
  );

  return (digest % bn254ScalarField).toString();
}

function createCircuitInputs(params: {
  answerKey: FixedMcqAnswerKey;
  answerSheet: FixedMcqAnswerSheet;
  gradingPolicy: FixedMcqGradingPolicy;
  score: number;
}) {
  if (params.answerSheet.responses.length > objectiveGradingMaxQuestions) {
    throw new Error('OBJECTIVE_GRADING_TOO_MANY_QUESTIONS');
  }

  const selectedChoiceHashes = Array.from(
    { length: objectiveGradingMaxQuestions },
    () => '0'
  );
  const correctChoiceHashes = Array.from(
    { length: objectiveGradingMaxQuestions },
    () => '0'
  );
  const keyByQuestion = indexAnswerKey(params.answerKey);

  params.answerSheet.responses.forEach((response, index) => {
    selectedChoiceHashes[index] = hashChoiceId(
      response.questionId,
      response.selectedChoiceId
    );
    correctChoiceHashes[index] = hashChoiceId(
      response.questionId,
      keyByQuestion.get(response.questionId) ?? null
    );
  });

  return {
    correct_choice_hashes: correctChoiceHashes,
    max_score: String(params.gradingPolicy.maxScore),
    points_per_question: String(params.gradingPolicy.pointsPerQuestion),
    question_count: String(params.answerSheet.responses.length),
    score: String(params.score),
    selected_choice_hashes: selectedChoiceHashes
  };
}

async function fileExists(path: string) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBarretenbergBinary() {
  const configured =
    process.env.BARRETENBERG_BINARY?.trim() || process.env.BB_BINARY?.trim();

  if (configured) {
    return configured;
  }

  const homeBinary = join(process.env.HOME ?? '', '.bb', 'bb');

  if (process.env.HOME && (await fileExists(homeBinary))) {
    return homeBinary;
  }

  return 'bb';
}

async function runBarretenberg(
  args: string[],
  cwd: string
): Promise<{ stderr: string; stdout: string }> {
  const binary = await resolveBarretenbergBinary();

  try {
    return await execFileAsync(binary, args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    const stderr =
      error instanceof Error && 'stderr' in error
        ? (error as Error & { stderr?: unknown }).stderr
        : undefined;
    const details =
      typeof stderr === 'string'
        ? stderr
        : error instanceof Error
          ? error.message
          : JSON.stringify(error);

    throw new Error(`BARRETENBERG_CLI_FAILED: ${details}`, {
      cause: error
    });
  }
}

async function generateBarretenbergProof(params: {
  circuit: NoirCircuitArtifact;
  circuitName: string;
  circuitInputs: Record<string, unknown>;
}) {
  const workdir = await mkdtemp(
    join(tmpdir(), `proofmark-noir-${randomUUID()}-`)
  );

  try {
    const circuitPath = join(workdir, `${params.circuitName}.json`);
    const witnessPath = join(workdir, 'witness.gz');
    const outputDir = join(workdir, 'proof');
    const noir = new Noir(params.circuit as never);
    const { witness } = await noir.execute(params.circuitInputs as never);

    await writeFile(circuitPath, JSON.stringify(params.circuit));
    await writeFile(witnessPath, Buffer.from(witness));
    await runBarretenberg(
      [
        'prove',
        '-b',
        circuitPath,
        '-w',
        witnessPath,
        '-o',
        outputDir,
        '--write_vk',
        '--output_format',
        'json'
      ],
      workdir
    );
    await runBarretenberg(
      [
        'verify',
        '-k',
        join(outputDir, 'vk.json'),
        '-p',
        join(outputDir, 'proof.json'),
        '-i',
        join(outputDir, 'public_inputs.json')
      ],
      workdir
    );

    return {
      proof: JSON.parse(await readFile(join(outputDir, 'proof.json'), 'utf8')) as unknown,
      publicInputs: JSON.parse(
        await readFile(join(outputDir, 'public_inputs.json'), 'utf8')
      ) as unknown,
      verificationKey: JSON.parse(
        await readFile(join(outputDir, 'vk.json'), 'utf8')
      ) as unknown
    } satisfies BarretenbergProofEnvelope;
  } finally {
    await rm(workdir, {
      force: true,
      recursive: true
    });
  }
}

async function verifyBarretenbergProof(envelope: BarretenbergProofEnvelope) {
  const workdir = await mkdtemp(
    join(tmpdir(), `proofmark-noir-verify-${randomUUID()}-`)
  );

  try {
    await writeFile(join(workdir, 'proof.json'), JSON.stringify(envelope.proof));
    await writeFile(
      join(workdir, 'public_inputs.json'),
      JSON.stringify(envelope.publicInputs)
    );
    await writeFile(join(workdir, 'vk.json'), JSON.stringify(envelope.verificationKey));
    await runBarretenberg(
      [
        'verify',
        '-k',
        join(workdir, 'vk.json'),
        '-p',
        join(workdir, 'proof.json'),
        '-i',
        join(workdir, 'public_inputs.json')
      ],
      workdir
    );

    return true;
  } catch {
    return false;
  } finally {
    await rm(workdir, {
      force: true,
      recursive: true
    });
  }
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

function validateCommitments(params: {
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

  return computedScore;
}

export async function generateObjectiveGradeProof(params: {
  answerCommitment: string;
  answerKeyCommitment: string;
  gradingPolicyHash: string;
  privateInputs: ObjectiveGradePrivateInputs;
  score?: number;
}) {
  const computedScore = validateCommitments(params);
  const publicInputs: ObjectiveGradePublicInputs = {
    answerCommitment: normalizeHash(params.answerCommitment),
    answerKeyCommitment: normalizeHash(params.answerKeyCommitment),
    circuitHash: String(fixedMcqGradingCircuit.hash),
    gradingPolicyHash: normalizeHash(params.gradingPolicyHash),
    maxScore: computedScore.maxScore,
    questionCount: params.privateInputs.answerSheet.responses.length,
    score: computedScore.score
  };
  const barretenbergProof = await generateBarretenbergProof({
    circuit: fixedMcqGradingCircuit,
    circuitName: objectiveGradingCircuitName,
    circuitInputs: createCircuitInputs({
      answerKey: params.privateInputs.answerKey,
      answerSheet: params.privateInputs.answerSheet,
      gradingPolicy: params.privateInputs.gradingPolicy,
      score: computedScore.score
    })
  });
  const storedProof = buildStoredProof({
    barretenberg: barretenbergProof,
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    publicInputs
  });

  return {
    backend: 'barretenberg-cli',
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    proof: storedProof.proof,
    proofHash: storedProof.proofHash,
    publicInputs,
    publicInputsHash: storedProof.publicInputsHash,
    verificationKeyHash: storedProof.verificationKeyHash
  } satisfies ObjectiveGradeProof;
}

export async function verifyObjectiveGradeProof(params: {
  proof: ObjectiveGradeProof;
  privateInputs: ObjectiveGradePrivateInputs;
}) {
  if (params.proof.backend !== 'barretenberg-cli') {
    return {
      maxScore: params.proof.publicInputs.maxScore,
      publicInputsHash: params.proof.publicInputsHash,
      score: params.proof.publicInputs.score,
      verified: false
    } satisfies ObjectiveGradeVerificationResult;
  }

  const computedScore = validateCommitments({
    answerCommitment: params.proof.publicInputs.answerCommitment,
    answerKeyCommitment: params.proof.publicInputs.answerKeyCommitment,
    gradingPolicyHash: params.proof.publicInputs.gradingPolicyHash,
    privateInputs: params.privateInputs,
    score: params.proof.publicInputs.score
  });
  const storedProofVerified = await verifyStoredProof({
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    proof: params.proof.proof,
    proofHash: params.proof.proofHash,
    publicInputs: params.proof.publicInputs,
    publicInputsHash: params.proof.publicInputsHash,
    verificationKeyHash: params.proof.verificationKeyHash
  });

  return {
    maxScore: computedScore.maxScore,
    publicInputsHash: params.proof.publicInputsHash,
    score: computedScore.score,
    verified:
      storedProofVerified &&
      params.proof.circuitName === objectiveGradingCircuitName &&
      params.proof.circuitVersion === objectiveGradingCircuitVersion &&
      params.proof.publicInputs.circuitHash ===
        String(fixedMcqGradingCircuit.hash)
  } satisfies ObjectiveGradeVerificationResult;
}

function computeSubjectiveAggregationInputHash(
  privateInputs: SubjectiveAggregationPrivateInputs
) {
  return `sha256:${sha256Canonical({
    parts: privateInputs.parts.map((part) => ({
      marks: part.marks.map((mark) => ({
        markerId: mark.markerId,
        score: mark.score
      })),
      maxScore: part.maxScore,
      partCommitment: normalizeHash(part.partCommitment),
      partId: part.partId
    })),
    policy: privateInputs.policy,
    scoreScale: gradingScoreScale,
    version: 'proofmark-subjective-aggregation-input-v1'
  })}`;
}

export function evaluateSubjectiveAggregationForProof(
  privateInputs: SubjectiveAggregationPrivateInputs
) {
  if (privateInputs.parts.length > subjectiveAggregationMaxParts) {
    throw new Error('SUBJECTIVE_AGGREGATION_TOO_MANY_PARTS');
  }

  if (
    privateInputs.policy.markersPerPart < 1 ||
    privateInputs.policy.markersPerPart > subjectiveAggregationMaxMarksPerPart
  ) {
    throw new Error('SUBJECTIVE_AGGREGATION_MARKERS_PER_PART_INVALID');
  }

  const adjudicationDeltaScaled = toScaledScore(
    privateInputs.policy.adjudicationDelta,
    'adjudicationDelta'
  );
  const parts = privateInputs.parts.map((part) => {
    if (part.marks.length < privateInputs.policy.markersPerPart) {
      throw new Error('SUBJECTIVE_AGGREGATION_INSUFFICIENT_MARKS');
    }

    if (part.marks.length > subjectiveAggregationMaxMarksPerPart) {
      throw new Error('SUBJECTIVE_AGGREGATION_TOO_MANY_MARKS');
    }

    const maxScoreScaled = toScaledScore(part.maxScore, 'maxScore');
    const markScoresScaled = part.marks.map((mark) => {
      const scaledScore = toScaledScore(mark.score, 'score');

      if (scaledScore > maxScoreScaled) {
        throw new Error('SUBJECTIVE_AGGREGATION_SCORE_OUT_OF_RANGE');
      }

      return scaledScore;
    });
    const baselineScores = markScoresScaled.slice(
      0,
      privateInputs.policy.markersPerPart
    );
    const baselineDelta =
      Math.max(...baselineScores) - Math.min(...baselineScores);
    const adjudicated = baselineDelta > adjudicationDeltaScaled;

    if (adjudicated && markScoresScaled.length <= privateInputs.policy.markersPerPart) {
      throw new Error('SUBJECTIVE_AGGREGATION_ADJUDICATION_MARK_REQUIRED');
    }

    const scoringScores = adjudicated ? markScoresScaled : baselineScores;
    const scoreScaled = roundedAverageScaled(scoringScores);

    return {
      adjudicated,
      maxScore: part.maxScore,
      maxScoreScaled,
      markScoresScaled,
      partCommitment: normalizeHash(part.partCommitment),
      partId: part.partId,
      score: fromScaledScore(scoreScaled),
      scoreScaled
    };
  });
  const subjectiveScoreScaled = parts.reduce(
    (total, part) => total + part.scoreScaled,
    0
  );
  const subjectiveMaxScoreScaled = parts.reduce(
    (total, part) => total + part.maxScoreScaled,
    0
  );

  return {
    aggregationInputHash: computeSubjectiveAggregationInputHash(privateInputs),
    adjudicationDelta: privateInputs.policy.adjudicationDelta,
    adjudicationDeltaScaled,
    markersPerPart: privateInputs.policy.markersPerPart,
    partCount: privateInputs.parts.length,
    parts,
    subjectiveMaxScore: fromScaledScore(subjectiveMaxScoreScaled),
    subjectiveMaxScoreScaled,
    subjectiveScore: fromScaledScore(subjectiveScoreScaled),
    subjectiveScoreScaled
  };
}

function createSubjectiveAggregationCircuitInputs(
  privateInputs: SubjectiveAggregationPrivateInputs,
  evaluation: ReturnType<typeof evaluateSubjectiveAggregationForProof>
) {
  const scoresScaled = Array.from(
    {
      length:
        subjectiveAggregationMaxParts * subjectiveAggregationMaxMarksPerPart
    },
    () => '0'
  );
  const markCounts = Array.from(
    { length: subjectiveAggregationMaxParts },
    () => '0'
  );
  const partMaxScoresScaled = Array.from(
    { length: subjectiveAggregationMaxParts },
    () => '0'
  );
  const partScoresScaled = Array.from(
    { length: subjectiveAggregationMaxParts },
    () => '0'
  );

  evaluation.parts.forEach((part, partIndex) => {
    markCounts[partIndex] = String(part.markScoresScaled.length);
    partMaxScoresScaled[partIndex] = String(part.maxScoreScaled);
    partScoresScaled[partIndex] = String(part.scoreScaled);

    part.markScoresScaled.forEach((score, markIndex) => {
      scoresScaled[
        partIndex * subjectiveAggregationMaxMarksPerPart + markIndex
      ] = String(score);
    });
  });

  void privateInputs;

  return {
    adjudication_delta_scaled: String(evaluation.adjudicationDeltaScaled),
    mark_counts: markCounts,
    markers_per_part: String(evaluation.markersPerPart),
    part_count: String(evaluation.partCount),
    part_max_scores_scaled: partMaxScoresScaled,
    part_scores_scaled: partScoresScaled,
    scores_scaled: scoresScaled,
    subjective_max_score_scaled: String(evaluation.subjectiveMaxScoreScaled),
    subjective_score_scaled: String(evaluation.subjectiveScoreScaled)
  };
}

export async function generateSubjectiveAggregationProof(params: {
  privateInputs: SubjectiveAggregationPrivateInputs;
}) {
  const evaluation = evaluateSubjectiveAggregationForProof(params.privateInputs);
  const publicInputs: SubjectiveAggregationPublicInputs = {
    aggregationInputHash: evaluation.aggregationInputHash,
    adjudicationDelta: evaluation.adjudicationDelta,
    circuitHash: String(subjectiveAggregationCircuit.hash),
    markersPerPart: evaluation.markersPerPart,
    partCount: evaluation.partCount,
    scoreScale: gradingScoreScale,
    subjectiveMaxScore: evaluation.subjectiveMaxScore,
    subjectiveScore: evaluation.subjectiveScore
  };
  const barretenbergProof = await generateBarretenbergProof({
    circuit: subjectiveAggregationCircuit,
    circuitName: subjectiveAggregationCircuitName,
    circuitInputs: createSubjectiveAggregationCircuitInputs(
      params.privateInputs,
      evaluation
    )
  });
  const storedProof = buildStoredProof({
    barretenberg: barretenbergProof,
    circuitName: subjectiveAggregationCircuitName,
    circuitVersion: subjectiveAggregationCircuitVersion,
    publicInputs
  });

  return {
    backend: 'barretenberg-cli',
    circuitName: subjectiveAggregationCircuitName,
    circuitVersion: subjectiveAggregationCircuitVersion,
    proof: storedProof.proof,
    proofHash: storedProof.proofHash,
    proofType: 'subjective-aggregation-proof',
    publicInputs,
    publicInputsHash: storedProof.publicInputsHash,
    verificationKeyHash: storedProof.verificationKeyHash
  } satisfies SubjectiveAggregationProof;
}

export async function verifySubjectiveAggregationProof(params: {
  privateInputs: SubjectiveAggregationPrivateInputs;
  proof: SubjectiveAggregationProof;
}) {
  const evaluation = evaluateSubjectiveAggregationForProof(params.privateInputs);
  const expectedPublicInputs: SubjectiveAggregationPublicInputs = {
    aggregationInputHash: evaluation.aggregationInputHash,
    adjudicationDelta: evaluation.adjudicationDelta,
    circuitHash: String(subjectiveAggregationCircuit.hash),
    markersPerPart: evaluation.markersPerPart,
    partCount: evaluation.partCount,
    scoreScale: gradingScoreScale,
    subjectiveMaxScore: evaluation.subjectiveMaxScore,
    subjectiveScore: evaluation.subjectiveScore
  };

  return {
    publicInputsHash: params.proof.publicInputsHash,
    subjectiveMaxScore: expectedPublicInputs.subjectiveMaxScore,
    subjectiveScore: expectedPublicInputs.subjectiveScore,
    verified:
      params.proof.backend === 'barretenberg-cli' &&
      params.proof.proofType === 'subjective-aggregation-proof' &&
      params.proof.circuitName === subjectiveAggregationCircuitName &&
      params.proof.circuitVersion === subjectiveAggregationCircuitVersion &&
      canonicalJson(params.proof.publicInputs) ===
        canonicalJson(expectedPublicInputs) &&
      (await verifyStoredProof({
        circuitName: subjectiveAggregationCircuitName,
        circuitVersion: subjectiveAggregationCircuitVersion,
        proof: params.proof.proof,
        proofHash: params.proof.proofHash,
        publicInputs: params.proof.publicInputs,
        publicInputsHash: params.proof.publicInputsHash,
        verificationKeyHash: params.proof.verificationKeyHash
      }))
  };
}

function computeGradeCommitment(params: {
  finalScore: number;
  maxScore: number;
  objectiveScore: number;
  subjectiveScore: number;
  submissionId: string;
}) {
  return `sha256:${sha256Hex(
    canonicalJson({
      finalScore: params.finalScore,
      maxScore: params.maxScore,
      objectiveScore: params.objectiveScore,
      subjectiveScore: params.subjectiveScore,
      submissionId: params.submissionId,
      version: 'proofmark-grade-commitment-v3'
    })
  )}`;
}

export function createFinalGradeCommitment(params: {
  finalScore: number;
  maxScore: number;
  objectiveScore: number;
  subjectiveScore: number;
  submissionId: string;
}) {
  return computeGradeCommitment(params);
}

export async function generateFinalGradeCompositionProof(params: {
  finalScore?: number;
  gradeCommitment?: string | null;
  maxScore?: number;
  objectiveMaxScore: number;
  objectiveScore: number;
  proofArtifactsRoot?: string | null;
  subjectiveMaxScore: number;
  subjectiveScore: number;
  submissionId?: string;
}) {
  const finalScore = params.finalScore ?? params.objectiveScore + params.subjectiveScore;
  const maxScore = params.maxScore ?? params.objectiveMaxScore + params.subjectiveMaxScore;

  if (toScaledScore(finalScore, 'finalScore') !==
    toScaledScore(params.objectiveScore, 'objectiveScore') +
      toScaledScore(params.subjectiveScore, 'subjectiveScore')) {
    throw new Error('FINAL_SCORE_MISMATCH');
  }

  if (toScaledScore(maxScore, 'maxScore') !==
    toScaledScore(params.objectiveMaxScore, 'objectiveMaxScore') +
      toScaledScore(params.subjectiveMaxScore, 'subjectiveMaxScore')) {
    throw new Error('FINAL_MAX_SCORE_MISMATCH');
  }

  const gradeCommitment =
    params.gradeCommitment ??
    (params.submissionId
      ? computeGradeCommitment({
          finalScore,
          maxScore,
          objectiveScore: params.objectiveScore,
          subjectiveScore: params.subjectiveScore,
          submissionId: params.submissionId
        })
      : null);
  const publicInputs: FinalGradeCompositionPublicInputs = {
    circuitHash: String(finalGradeCompositionCircuit.hash),
    finalScore,
    gradeCommitment,
    maxScore,
    objectiveMaxScore: params.objectiveMaxScore,
    objectiveScore: params.objectiveScore,
    proofArtifactsRoot: params.proofArtifactsRoot ?? null,
    scoreScale: gradingScoreScale,
    subjectiveMaxScore: params.subjectiveMaxScore,
    subjectiveScore: params.subjectiveScore
  };
  const barretenbergProof = await generateBarretenbergProof({
    circuit: finalGradeCompositionCircuit,
    circuitName: finalGradeCompositionCircuitName,
    circuitInputs: {
      final_score_scaled: String(toScaledScore(finalScore, 'finalScore')),
      max_score_scaled: String(toScaledScore(maxScore, 'maxScore')),
      objective_max_score_scaled: String(
        toScaledScore(params.objectiveMaxScore, 'objectiveMaxScore')
      ),
      objective_score_scaled: String(
        toScaledScore(params.objectiveScore, 'objectiveScore')
      ),
      subjective_max_score_scaled: String(
        toScaledScore(params.subjectiveMaxScore, 'subjectiveMaxScore')
      ),
      subjective_score_scaled: String(
        toScaledScore(params.subjectiveScore, 'subjectiveScore')
      )
    }
  });
  const storedProof = buildStoredProof({
    barretenberg: barretenbergProof,
    circuitName: finalGradeCompositionCircuitName,
    circuitVersion: finalGradeCompositionCircuitVersion,
    publicInputs
  });

  return {
    backend: 'barretenberg-cli',
    circuitName: finalGradeCompositionCircuitName,
    circuitVersion: finalGradeCompositionCircuitVersion,
    proof: storedProof.proof,
    proofHash: storedProof.proofHash,
    proofType: 'final-grade-composition-proof',
    publicInputs,
    publicInputsHash: storedProof.publicInputsHash,
    verificationKeyHash: storedProof.verificationKeyHash
  } satisfies FinalGradeCompositionProof;
}

export async function verifyFinalGradeCompositionProof(params: {
  proof: FinalGradeCompositionProof;
}) {
  return {
    finalScore: params.proof.publicInputs.finalScore,
    maxScore: params.proof.publicInputs.maxScore,
    publicInputsHash: params.proof.publicInputsHash,
    verified:
      params.proof.backend === 'barretenberg-cli' &&
      params.proof.proofType === 'final-grade-composition-proof' &&
      params.proof.circuitName === finalGradeCompositionCircuitName &&
      params.proof.circuitVersion === finalGradeCompositionCircuitVersion &&
      params.proof.publicInputs.circuitHash ===
        String(finalGradeCompositionCircuit.hash) &&
      (await verifyStoredProof({
        circuitName: finalGradeCompositionCircuitName,
        circuitVersion: finalGradeCompositionCircuitVersion,
        proof: params.proof.proof,
        proofHash: params.proof.proofHash,
        publicInputs: params.proof.publicInputs,
        publicInputsHash: params.proof.publicInputsHash,
        verificationKeyHash: params.proof.verificationKeyHash
      }))
  };
}

export async function ensureBarretenbergAvailable() {
  const binary = await resolveBarretenbergBinary();
  const directory = dirname(binary);
  const { stdout } = await runBarretenberg(['--version'], directory);

  return stdout.trim();
}
