import { canonicalJson, sha256Canonical, sha256Hex } from '@proofmark/crypto';
import { type FixedMcqAnswerSheet } from '@proofmark/shared';
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

const require = createRequire(import.meta.url);
const fixedMcqGradingCircuit = require('./artifacts/fixed_mcq_grading.json') as {
  bytecode: string;
  hash: number;
  noir_version: string;
};
const execFileAsync = promisify(execFile);
const bn254ScalarField =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
  publicInputs: ObjectiveGradePublicInputs;
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
  circuitInputs: Record<string, unknown>;
}) {
  const workdir = await mkdtemp(
    join(tmpdir(), `proofmark-noir-${randomUUID()}-`)
  );

  try {
    const circuitPath = join(workdir, 'fixed_mcq_grading.json');
    const witnessPath = join(workdir, 'witness.gz');
    const outputDir = join(workdir, 'proof');
    const noir = new Noir(fixedMcqGradingCircuit as never);
    const { witness } = await noir.execute(params.circuitInputs as never);

    await writeFile(circuitPath, JSON.stringify(fixedMcqGradingCircuit));
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
    circuitInputs: createCircuitInputs({
      answerKey: params.privateInputs.answerKey,
      answerSheet: params.privateInputs.answerSheet,
      gradingPolicy: params.privateInputs.gradingPolicy,
      score: computedScore.score
    })
  });
  const proofEnvelope = {
    barretenberg: barretenbergProof,
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    publicInputs
  };
  const proof = Buffer.from(canonicalJson(proofEnvelope), 'utf8').toString(
    'base64'
  );
  const proofHash = `sha256:${sha256Hex(Buffer.from(proof, 'base64'))}`;

  return {
    backend: 'barretenberg-cli',
    circuitName: objectiveGradingCircuitName,
    circuitVersion: objectiveGradingCircuitVersion,
    proof,
    proofHash,
    publicInputs,
    publicInputsHash: `sha256:${sha256Canonical({
      circuitPublicInputs: barretenbergProof.publicInputs,
      proofmarkPublicInputs: publicInputs
    })}`,
    verificationKeyHash: `sha256:${sha256Canonical(
      barretenbergProof.verificationKey
    )}`
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
  const decodedEnvelope = JSON.parse(
    Buffer.from(params.proof.proof, 'base64').toString('utf8')
  ) as StoredProofEnvelope;
  const decodedPublicInputsHash = `sha256:${sha256Canonical({
    circuitPublicInputs: decodedEnvelope.barretenberg.publicInputs,
    proofmarkPublicInputs: decodedEnvelope.publicInputs
  })}`;
  const decodedVerificationKeyHash = `sha256:${sha256Canonical(
    decodedEnvelope.barretenberg.verificationKey
  )}`;
  const proofHash = `sha256:${sha256Hex(
    Buffer.from(params.proof.proof, 'base64')
  )}`;
  const barretenbergVerified = await verifyBarretenbergProof(
    decodedEnvelope.barretenberg
  );

  return {
    maxScore: computedScore.maxScore,
    publicInputsHash: params.proof.publicInputsHash,
    score: computedScore.score,
    verified:
      barretenbergVerified &&
      decodedEnvelope.circuitName === params.proof.circuitName &&
      decodedEnvelope.circuitVersion === params.proof.circuitVersion &&
      decodedEnvelope.circuitName === objectiveGradingCircuitName &&
      decodedEnvelope.circuitVersion === objectiveGradingCircuitVersion &&
      decodedEnvelope.publicInputs.circuitHash === params.proof.publicInputs.circuitHash &&
      canonicalJson(decodedEnvelope.publicInputs) ===
        canonicalJson(params.proof.publicInputs) &&
      proofHash === params.proof.proofHash &&
      decodedPublicInputsHash === params.proof.publicInputsHash &&
      decodedVerificationKeyHash === params.proof.verificationKeyHash
  } satisfies ObjectiveGradeVerificationResult;
}

export async function ensureBarretenbergAvailable() {
  const binary = await resolveBarretenbergBinary();
  const directory = dirname(binary);
  const { stdout } = await runBarretenberg(['--version'], directory);

  return stdout.trim();
}
