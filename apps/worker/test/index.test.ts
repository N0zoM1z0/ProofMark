import { describe, expect, it } from 'vitest';
import { createWorkerStatus } from '../src/index.js';

describe('createWorkerStatus', () => {
  it('returns the worker scaffold status', () => {
    expect(createWorkerStatus()).toEqual({
      status: 'idle',
      service: 'worker'
    });
  });
});
