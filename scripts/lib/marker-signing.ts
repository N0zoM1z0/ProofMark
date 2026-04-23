import { sha256Canonical, signCanonicalPayload } from '../../packages/crypto/src/index.js';
import { buildSignedMarkPayload } from '../../packages/shared/src/blind-marking.js';

export function buildMarkerCommentsHash(comments: string) {
  return `sha256:${sha256Canonical({
    comments: comments.trim(),
    version: 'proofmark-marker-comments-v1'
  })}`;
}

export function signMarkerMarkForApi(params: {
  comments: string;
  gradingTaskId: string;
  markerId: string;
  maxScore: number;
  privateKeyPem: string;
  rubricHash: string;
  score: number;
  submissionPartId: string;
}) {
  const commentsHash = buildMarkerCommentsHash(params.comments);
  const payload = buildSignedMarkPayload({
    commentsHash,
    gradingTaskId: params.gradingTaskId,
    markerId: params.markerId,
    maxScore: params.maxScore,
    rubricHash: params.rubricHash,
    score: params.score,
    submissionPartId: params.submissionPartId
  });

  return {
    commentsHash,
    payload,
    signature: signCanonicalPayload(payload, params.privateKeyPem)
  };
}
