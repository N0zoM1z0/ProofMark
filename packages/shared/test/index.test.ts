import { describe, expect, it } from 'vitest';
import { createVersionBanner, packageName } from '../src/index.js';

describe('shared package scaffold', () => {
  it('exports stable foundation helpers', () => {
    expect(packageName).toBe('@proofmark/shared');
    expect(createVersionBanner('0.1.0')).toBe('ProofMark 0.1.0');
  });
});
