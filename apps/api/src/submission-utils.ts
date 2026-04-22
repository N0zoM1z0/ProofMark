import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign
} from 'node:crypto';

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface SubmissionReceiptPayload {
  version: string;
  examId: string;
  submissionId: string;
  nullifierHash: string;
  messageHash: string;
  answerCommitment: string;
  encryptedBlobHash: string;
  submittedAtBucket: string;
  auditEventId: string;
  auditEventHash: string;
  auditRoot: string;
  auditInclusionProof: Array<{
    position: 'left' | 'right';
    hash: string;
  }>;
}

export interface MerkleProofNode {
  position: 'left' | 'right';
  hash: string;
}

function canonicalizeValue(value: unknown): CanonicalValue {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Non-finite numbers are not supported in canonical JSON');
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalizeValue(item)
    );
  }

  if (Object.prototype.toString.call(value) === '[object Object]') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, currentValue]) => currentValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, currentValue]) => [key, canonicalizeValue(currentValue)])
    );
  }

  throw new TypeError(`Unsupported value for canonical JSON: ${typeof value}`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function decimalHash(value: unknown) {
  return BigInt(`0x${sha256Hex(canonicalJson(value))}`).toString();
}

export function computeSubmissionMessage(params: {
  examId: string;
  questionSetHash: string;
  answerCommitment: string;
  encryptedBlobHash: string;
}) {
  return decimalHash({
    answerCommitment: params.answerCommitment,
    encryptedBlobHash: params.encryptedBlobHash,
    examId: params.examId,
    questionSetHash: params.questionSetHash
  });
}

export function computeSubmitScope(examId: string, examVersion = 1) {
  return decimalHash({
    examId,
    examVersion,
    purpose: 'submit'
  });
}

export function formatSubmittedAtBucket(date: Date) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5, 0, 0);

  return `${bucket.toISOString().slice(0, 16)}Z/5m`;
}

function hashPair(left: string, right: string) {
  return sha256Hex(`${left}:${right}`);
}

export function calculateMerkleRoot(leaves: string[]) {
  if (leaves.length === 0) {
    return null;
  }

  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let index = 0; index < currentLevel.length; index += 2) {
      const left = currentLevel[index]!;
      const right = currentLevel[index + 1] ?? left;
      nextLevel.push(hashPair(left, right));
    }

    currentLevel = nextLevel;
  }

  return currentLevel[0] ?? null;
}

export function createMerkleProof(leaves: string[], targetIndex: number) {
  if (targetIndex < 0 || targetIndex >= leaves.length) {
    throw new RangeError('Target index is out of bounds');
  }

  let currentLevel = [...leaves];
  let currentIndex = targetIndex;
  const proof: MerkleProofNode[] = [];

  while (currentLevel.length > 1) {
    const isRightNode = currentIndex % 2 === 1;
    const currentHash = currentLevel[currentIndex]!;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    const siblingHash = currentLevel[siblingIndex] ?? currentHash;

    proof.push({
      position: isRightNode ? 'left' : 'right',
      hash: siblingHash
    });

    const nextLevel: string[] = [];

    for (let index = 0; index < currentLevel.length; index += 2) {
      const left = currentLevel[index]!;
      const right = currentLevel[index + 1] ?? left;
      nextLevel.push(hashPair(left, right));
    }

    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}

let generatedReceiptSigningKey:
  | {
      privateKeyPem: string;
      publicKeyPem: string;
    }
  | undefined;

function getReceiptPrivateKeyPem() {
  const configuredValue = process.env.RECEIPT_SIGNING_KEY ?? 'dev-generate-on-boot';

  if (configuredValue === 'dev-generate-on-boot') {
    if (!generatedReceiptSigningKey) {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');

      generatedReceiptSigningKey = {
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

    return generatedReceiptSigningKey.privateKeyPem;
  }

  if (configuredValue.includes('BEGIN')) {
    return configuredValue.replace(/\\n/g, '\n');
  }

  return Buffer.from(configuredValue, 'base64').toString('utf8');
}

export function signReceiptPayload(payload: SubmissionReceiptPayload) {
  const privateKeyPem = getReceiptPrivateKeyPem();

  return sign(
    null,
    Buffer.from(canonicalJson(payload)),
    createPrivateKey(privateKeyPem)
  ).toString('base64url');
}

export function getReceiptPublicKeyPem() {
  if (generatedReceiptSigningKey) {
    return generatedReceiptSigningKey.publicKeyPem;
  }

  const privateKeyPem = getReceiptPrivateKeyPem();

  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({
      type: 'spki',
      format: 'pem'
    })
    .toString();
}
