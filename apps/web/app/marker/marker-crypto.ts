'use client';

import { buildSignedMarkPayload } from '@proofmark/shared';
import { canonicalJson, sha256Hex } from '../student/_lib/proofmark-crypto';

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function pemToDer(pem: string) {
  const normalized = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

  return base64ToBytes(normalized);
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes);
}

export async function buildCommentsHash(comments: string) {
  return `sha256:${await sha256Hex(
    canonicalJson({
      comments: comments.trim(),
      version: 'proofmark-marker-comments-v1'
    })
  )}`;
}

export async function signMarkerMark(params: {
  comments: string;
  gradingTaskId: string;
  markerId: string;
  maxScore: number;
  privateKeyPem: string;
  rubricHash: string;
  score: number;
  submissionPartId: string;
}) {
  const commentsHash = await buildCommentsHash(params.comments);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    toBufferSource(pemToDer(params.privateKeyPem)),
    {
      name: 'Ed25519'
    },
    false,
    ['sign']
  );
  const payload = buildSignedMarkPayload({
    commentsHash,
    gradingTaskId: params.gradingTaskId,
    markerId: params.markerId,
    maxScore: params.maxScore,
    rubricHash: params.rubricHash,
    score: params.score,
    submissionPartId: params.submissionPartId
  });
  const signature = await crypto.subtle.sign(
    {
      name: 'Ed25519'
    },
    privateKey,
    toBufferSource(new TextEncoder().encode(canonicalJson(payload)))
  );

  return {
    commentsHash,
    payload,
    signature: bytesToBase64Url(new Uint8Array(signature))
  };
}
