'use client';

export type EncryptedSubmissionBlob = {
  algorithm: 'aes-256-gcm+rsa-oaep-sha256';
  ciphertext: string;
  encryptedKey: string;
  iv: string;
  version: 'proofmark-encrypted-answer-v1';
};

export type SubmissionReceipt = {
  answerCommitment: string;
  auditEventHash: string;
  auditEventId: string;
  auditInclusionProof: Array<{
    position: 'left' | 'right';
    hash: string;
  }>;
  auditRoot: string;
  encryptedBlobHash: string;
  examId: string;
  messageHash: string;
  nullifierHash: string;
  serverPublicKey: string;
  serverSignature: string;
  submissionId: string;
  submittedAtBucket: string;
  version: string;
};

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

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
      throw new TypeError('Canonical JSON does not support non-finite numbers');
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

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '='
  );

  return base64ToBytes(padded);
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function pemToDer(pem: string) {
  const normalized = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

  return base64ToBytes(normalized);
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

export async function sha256Hex(value: string | Uint8Array) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', toBufferSource(bytes));

  return bytesToHex(new Uint8Array(digest));
}

export async function createAnswerCommitment(params: {
  answerSheet: unknown;
  salt: string;
}) {
  const payload = {
    answerSheet: params.answerSheet,
    salt: params.salt,
    version: 'proofmark-answer-commitment-v1'
  };

  return {
    commitment: `sha256:${await sha256Hex(canonicalJson(payload))}`,
    payload
  };
}

export async function computeDecimalHash(value: unknown) {
  return BigInt(`0x${await sha256Hex(canonicalJson(value))}`).toString();
}

export function computeSubmitScope(params: {
  examId: string;
  examVersion: number;
}) {
  return computeDecimalHash({
    examId: params.examId,
    examVersion: params.examVersion,
    purpose: 'submit'
  });
}

export function computeSubmissionMessage(params: {
  answerCommitment: string;
  encryptedBlobHash: string;
  examId: string;
  examVersion: number;
  questionSetHash: string;
}) {
  return computeDecimalHash({
    answerCommitment: params.answerCommitment,
    encryptedBlobHash: params.encryptedBlobHash,
    examId: params.examId,
    examVersion: params.examVersion,
    questionSetHash: params.questionSetHash
  });
}

export function randomBase64(byteLength = 16) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function encryptSubmissionBlob(params: {
  answerSheet: unknown;
  answerSalt: string;
  publicKeyPem: string;
}) {
  const plaintext = canonicalJson({
    answerSalt: params.answerSalt,
    answerSheet: params.answerSheet,
    version: 'proofmark-answer-blob-v1'
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.generateKey(
    {
      length: 256,
      name: 'AES-GCM'
    },
    true,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      iv,
      name: 'AES-GCM'
    },
    aesKey,
    toBufferSource(new TextEncoder().encode(plaintext))
  );
  const exportedKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', aesKey)
  );
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toBufferSource(pemToDer(params.publicKeyPem)),
    {
      hash: 'SHA-256',
      name: 'RSA-OAEP'
    },
    false,
    ['encrypt']
  );
  const encryptedKey = await crypto.subtle.encrypt(
    {
      name: 'RSA-OAEP'
    },
    publicKey,
    toBufferSource(exportedKey)
  );
  const payload: EncryptedSubmissionBlob = {
    algorithm: 'aes-256-gcm+rsa-oaep-sha256',
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKey)),
    iv: bytesToBase64(iv),
    version: 'proofmark-encrypted-answer-v1'
  };
  const serialized = canonicalJson(payload);

  return {
    encryptedBlobHash: `sha256:${await sha256Hex(serialized)}`,
    payload,
    serialized
  };
}

async function verifyReceiptSignature(receipt: SubmissionReceipt) {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toBufferSource(pemToDer(receipt.serverPublicKey)),
    {
      name: 'Ed25519'
    },
    false,
    ['verify']
  );
  const payload = {
    answerCommitment: receipt.answerCommitment,
    auditEventHash: receipt.auditEventHash,
    auditEventId: receipt.auditEventId,
    auditInclusionProof: receipt.auditInclusionProof,
    auditRoot: receipt.auditRoot,
    encryptedBlobHash: receipt.encryptedBlobHash,
    examId: receipt.examId,
    messageHash: receipt.messageHash,
    nullifierHash: receipt.nullifierHash,
    submissionId: receipt.submissionId,
    submittedAtBucket: receipt.submittedAtBucket,
    version: receipt.version
  };

  return crypto.subtle.verify(
    {
      name: 'Ed25519'
    },
    publicKey,
    toBufferSource(base64UrlToBytes(receipt.serverSignature)),
    toBufferSource(new TextEncoder().encode(canonicalJson(payload)))
  );
}

async function hashPair(left: string, right: string) {
  return sha256Hex(`${left}:${right}`);
}

export async function verifyReceipt(receipt: SubmissionReceipt) {
  const signatureValid = await verifyReceiptSignature(receipt);
  let computedRoot = receipt.auditEventHash;

  for (const node of receipt.auditInclusionProof) {
    computedRoot =
      node.position === 'left'
        ? await hashPair(node.hash, computedRoot)
        : await hashPair(computedRoot, node.hash);
  }

  return {
    merkleProofValid: computedRoot === receipt.auditRoot,
    signatureValid,
    verified: signatureValid && computedRoot === receipt.auditRoot
  };
}

export function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
