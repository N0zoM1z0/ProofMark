import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto';
import { canonicalJson, computeSubmitScope, sha256Hex } from './submission-utils.js';

export interface PublicExamManifestPayload {
  version: 'proofmark-public-manifest-v1';
  examId: string;
  examVersion: number;
  title: string;
  courseId: string | null;
  questionSetHash: string;
  answerKeyCommitment: string;
  gradingPolicyHash: string;
  currentGroupRoot: string;
  startsAt: string | null;
  endsAt: string | null;
  submitScope: string;
}

export function hashQuestionSet(questionSet: unknown) {
  return `sha256:${sha256Hex(canonicalJson(questionSet))}`;
}

export function hashGradingPolicy(gradingPolicy: unknown) {
  return `sha256:${sha256Hex(canonicalJson(gradingPolicy))}`;
}

export function commitAnswerKey(params: {
  answerKey: unknown;
  salt: string;
}) {
  return `sha256:${sha256Hex(
    canonicalJson({
      answerKey: params.answerKey,
      purpose: 'proofmark-answer-key-commitment-v1',
      salt: params.salt
    })
  )}`;
}

export function buildPublicExamManifest(params: {
  examId: string;
  examVersion: number;
  title: string;
  courseId: string | null;
  questionSetHash: string;
  answerKeyCommitment: string;
  gradingPolicyHash: string;
  currentGroupRoot: string;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  const manifest: PublicExamManifestPayload = {
    answerKeyCommitment: params.answerKeyCommitment,
    courseId: params.courseId,
    currentGroupRoot: params.currentGroupRoot,
    endsAt: params.endsAt?.toISOString() ?? null,
    examId: params.examId,
    examVersion: params.examVersion,
    gradingPolicyHash: params.gradingPolicyHash,
    questionSetHash: params.questionSetHash,
    startsAt: params.startsAt?.toISOString() ?? null,
    submitScope: computeSubmitScope(params.examId, params.examVersion),
    title: params.title,
    version: 'proofmark-public-manifest-v1'
  };

  return {
    manifest,
    manifestHash: `sha256:${sha256Hex(canonicalJson(manifest))}`
  };
}

let generatedManifestSigningKey:
  | {
      privateKeyPem: string;
      publicKeyPem: string;
    }
  | undefined;

function getManifestPrivateKeyPem() {
  const configuredValue = process.env.MANIFEST_SIGNING_KEY ?? 'dev-generate-on-boot';

  if (configuredValue === 'dev-generate-on-boot') {
    if (!generatedManifestSigningKey) {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');

      generatedManifestSigningKey = {
        privateKeyPem: privateKey
          .export({
            type: 'pkcs8',
            format: 'pem'
          })
          .toString(),
        publicKeyPem: publicKey
          .export({
            type: 'spki',
            format: 'pem'
          })
          .toString()
      };
    }

    return generatedManifestSigningKey.privateKeyPem;
  }

  if (configuredValue.includes('BEGIN')) {
    return configuredValue.replace(/\\n/g, '\n');
  }

  return Buffer.from(configuredValue, 'base64').toString('utf8');
}

export function signManifestPayload(payload: PublicExamManifestPayload) {
  const privateKeyPem = getManifestPrivateKeyPem();

  return sign(
    null,
    Buffer.from(canonicalJson(payload)),
    createPrivateKey(privateKeyPem)
  ).toString('base64url');
}

export function getManifestPublicKeyPem() {
  if (generatedManifestSigningKey) {
    return generatedManifestSigningKey.publicKeyPem;
  }

  const privateKeyPem = getManifestPrivateKeyPem();

  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({
      type: 'spki',
      format: 'pem'
    })
    .toString();
}

export function verifyManifestSignature(params: {
  manifest: PublicExamManifestPayload;
  serverPublicKey: string;
  serverSignature: string;
}) {
  return verify(
    null,
    Buffer.from(canonicalJson(params.manifest)),
    createPublicKey(params.serverPublicKey),
    Buffer.from(params.serverSignature, 'base64url')
  );
}
