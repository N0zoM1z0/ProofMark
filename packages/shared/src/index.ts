export const packageName = '@proofmark/shared';

export function createVersionBanner(version: string) {
  return `ProofMark ${version}`;
}

export * from './blind-marking.js';
export * from './exam-status.js';
export * from './fixed-mcq.js';
