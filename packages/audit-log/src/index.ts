import { createHash } from 'node:crypto';

export const auditLogPackageName = '@proofmark/audit-log';

export type MerkleProofNode = {
  position: 'left' | 'right';
  hash: string;
};

export interface AuditEventInput<TPayload> {
  examId: string;
  eventType: string;
  actorRole: string;
  actorPseudonym?: string | null;
  payload: TPayload;
  createdAt?: string;
}

export interface AuditEventRecord<TPayload> {
  examId: string;
  seq: number;
  eventType: string;
  actorRole: string;
  actorPseudonym: string | null;
  payload: TPayload;
  payloadHash: string;
  prevEventHash: string | null;
  eventHash: string;
  createdAt: string;
}

export interface ReceiptPayload {
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
  auditInclusionProof: MerkleProofNode[];
}

export interface SignedReceipt {
  payload: ReceiptPayload;
  signature: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function canonicalizeValue(value: unknown): unknown {
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
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers');
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeValue(item)));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, currentValue]) => currentValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, currentValue]) => [key, canonicalizeValue(currentValue)])
    );
  }

  throw new TypeError(`Unsupported value for canonical JSON: ${typeof value}`);
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function hashPair(left: string, right: string) {
  return sha256Hex(`${left}:${right}`);
}

export function createAuditEvent<TPayload>(
  input: AuditEventInput<TPayload>,
  options: {
    seq: number;
    prevEventHash?: string | null;
  }
): AuditEventRecord<TPayload> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const payloadHash = sha256Hex(canonicalJson(input.payload));
  const prevEventHash = options.prevEventHash ?? null;
  const eventHash = sha256Hex(
    canonicalJson({
      examId: input.examId,
      seq: options.seq,
      eventType: input.eventType,
      actorRole: input.actorRole,
      actorPseudonym: input.actorPseudonym ?? null,
      payloadHash,
      prevEventHash,
      createdAt
    })
  );

  return {
    examId: input.examId,
    seq: options.seq,
    eventType: input.eventType,
    actorRole: input.actorRole,
    actorPseudonym: input.actorPseudonym ?? null,
    payload: input.payload,
    payloadHash,
    prevEventHash,
    eventHash,
    createdAt
  };
}

export function appendAuditEvent<TPayload>(
  existingEvents: AuditEventRecord<unknown>[],
  input: AuditEventInput<TPayload>
) {
  const previousEvent = existingEvents.at(-1);

  return createAuditEvent(input, {
    seq: existingEvents.length + 1,
    prevEventHash: previousEvent?.eventHash ?? null
  });
}

function normalizeLeaves(leaves: string[]) {
  if (leaves.length === 0) {
    return [];
  }

  return [...leaves];
}

export function calculateMerkleRoot(leaves: string[]) {
  const nodes = normalizeLeaves(leaves);

  if (nodes.length === 0) {
    return null;
  }

  let currentLevel = nodes;

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
    throw new RangeError('Target index is out of bounds for the provided leaves');
  }

  let currentLevel = normalizeLeaves(leaves);
  let currentIndex = targetIndex;
  const proof: MerkleProofNode[] = [];

  while (currentLevel.length > 1) {
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
    const currentHash = currentLevel[currentIndex]!;
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

export function verifyMerkleProof(params: {
  leafHash: string;
  root: string | null;
  proof: MerkleProofNode[];
}) {
  if (!params.root) {
    return false;
  }

  const computedRoot = params.proof.reduce((currentHash, node) => {
    return node.position === 'left'
      ? hashPair(node.hash, currentHash)
      : hashPair(currentHash, node.hash);
  }, params.leafHash);

  return computedRoot === params.root;
}

export function calculateAuditRoot(events: AuditEventRecord<unknown>[]) {
  return calculateMerkleRoot(events.map((event) => event.eventHash));
}

export function createReceiptPayload(params: Omit<ReceiptPayload, 'version'>) {
  return {
    version: 'proofmark-receipt-v1',
    ...params
  };
}

export function verifyReceiptPayload(receipt: SignedReceipt) {
  return verifyMerkleProof({
    leafHash: receipt.payload.auditEventHash,
    root: receipt.payload.auditRoot,
    proof: receipt.payload.auditInclusionProof
  });
}
