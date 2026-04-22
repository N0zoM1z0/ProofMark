export type BlindMarkingPolicy = {
  version: 'proofmark-blind-marking-policy-v1';
  markersPerPart: number;
  adjudicationDelta: number;
};

export type AssignmentCandidate = {
  markerId: string;
  submissionPartId: string;
  assignmentOrdinal: number;
  assignmentCommitment: string;
};

export type SubjectiveMarkInput = {
  markerId: string;
  score: number;
};

export type SignedMarkPayload = {
  version: 'proofmark-signed-mark-v1';
  gradingTaskId: string;
  submissionPartId: string;
  markerId: string;
  score: number;
  maxScore: number;
  rubricHash: string;
  commentsHash: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

async function sha256Hex(value: string) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    );

    return bytesToHex(new Uint8Array(digest));
  }

  const { createHash } = await import('node:crypto');

  return createHash('sha256').update(value).digest('hex');
}

function compareHashes(left: string, right: string) {
  return left.localeCompare(right);
}

export function normalizeBlindMarkingPolicy(
  policy: Partial<BlindMarkingPolicy> | undefined
): BlindMarkingPolicy {
  const markersPerPart =
    typeof policy?.markersPerPart === 'number' && Number.isInteger(policy.markersPerPart)
      ? policy.markersPerPart
      : 2;
  const adjudicationDelta =
    typeof policy?.adjudicationDelta === 'number' &&
    Number.isFinite(policy.adjudicationDelta)
      ? policy.adjudicationDelta
      : 2;

  if (markersPerPart < 1) {
    throw new TypeError('markersPerPart must be a positive integer');
  }

  if (adjudicationDelta < 0) {
    throw new TypeError('adjudicationDelta must be zero or greater');
  }

  return {
    adjudicationDelta,
    markersPerPart,
    version: 'proofmark-blind-marking-policy-v1'
  };
}

export async function hashBlindMarkingRoot(items: unknown[]) {
  return `sha256:${await sha256Hex(canonicalJson(items))}`;
}

export async function generateBlindMarkingAssignments(params: {
  markerIds: string[];
  seed: string;
  submissionPartIds: string[];
  policy: BlindMarkingPolicy;
}) {
  const uniqueMarkerIds = [...new Set(params.markerIds)];
  const uniquePartIds = [...new Set(params.submissionPartIds)];

  if (uniqueMarkerIds.length < params.policy.markersPerPart) {
    throw new TypeError('Not enough markers for the configured markersPerPart');
  }

  const markerRoot = await hashBlindMarkingRoot(uniqueMarkerIds);
  const submissionRoot = await hashBlindMarkingRoot(uniquePartIds);
  const assignments: AssignmentCandidate[] = [];

  for (const submissionPartId of uniquePartIds.sort()) {
    const rankedMarkers = await Promise.all(
      uniqueMarkerIds.map(async (markerId) => ({
        markerId,
        sortKey: await sha256Hex(
          canonicalJson({
            markerId,
            markerRoot,
            seed: params.seed,
            submissionPartId,
            submissionRoot
          })
        )
      }))
    );
    rankedMarkers.sort((left, right) => compareHashes(left.sortKey, right.sortKey));

    for (
      let assignmentOrdinal = 0;
      assignmentOrdinal < params.policy.markersPerPart;
      assignmentOrdinal += 1
    ) {
      const markerId = rankedMarkers[assignmentOrdinal]!.markerId;

      assignments.push({
        assignmentCommitment: `sha256:${await sha256Hex(
          canonicalJson({
            assignmentOrdinal: assignmentOrdinal + 1,
            markerId,
            markerRoot,
            seed: params.seed,
            submissionPartId,
            submissionRoot
          })
        )}`,
        assignmentOrdinal: assignmentOrdinal + 1,
        markerId,
        submissionPartId
      });
    }
  }

  return {
    assignmentRoot: await hashBlindMarkingRoot(assignments),
    assignments,
    markerRoot,
    submissionRoot
  };
}

export function evaluateBlindMarkingScores(params: {
  marks: SubjectiveMarkInput[];
  maxScore: number;
  policy: BlindMarkingPolicy;
}) {
  const orderedMarks = [...params.marks];
  const baselineMarks = orderedMarks.slice(0, params.policy.markersPerPart);

  if (baselineMarks.some((mark) => mark.score < 0 || mark.score > params.maxScore)) {
    throw new TypeError('score must be within the allowed range');
  }

  if (baselineMarks.length < params.policy.markersPerPart) {
    return {
      adjudicationRequired: false,
      averageScore: null,
      delta: 0,
      finalized: false,
      shouldCreateAdjudication: false
    };
  }

  const baselineScores = baselineMarks.map((mark) => mark.score);
  const delta = Math.max(...baselineScores) - Math.min(...baselineScores);

  if (delta > params.policy.adjudicationDelta) {
    if (orderedMarks.length <= params.policy.markersPerPart) {
      return {
        adjudicationRequired: true,
        averageScore: null,
        delta,
        finalized: false,
        shouldCreateAdjudication: true
      };
    }

    const adjudicatedAverage =
      orderedMarks.reduce((total, mark) => total + mark.score, 0) / orderedMarks.length;

    return {
      adjudicationRequired: true,
      averageScore: adjudicatedAverage,
      delta,
      finalized: true,
      shouldCreateAdjudication: false
    };
  }

  return {
    adjudicationRequired: false,
    averageScore:
      baselineScores.reduce((total, score) => total + score, 0) /
      baselineScores.length,
    delta,
    finalized: true,
    shouldCreateAdjudication: false
  };
}

export function buildSignedMarkPayload(params: Omit<SignedMarkPayload, 'version'>) {
  return {
    ...params,
    version: 'proofmark-signed-mark-v1' as const
  };
}
