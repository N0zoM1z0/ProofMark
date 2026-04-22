import { describe, expect, it } from 'vitest';
import { createWorkerStatus } from '../src/index.js';

describe('createWorkerStatus', () => {
  it('returns the worker readiness status', () => {
    expect(createWorkerStatus()).toEqual({
      status: 'ready',
      service: 'worker'
    });
  });
});
