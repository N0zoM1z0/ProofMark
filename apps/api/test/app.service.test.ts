import { describe, expect, it } from 'vitest';
import { AppService } from '../src/app.service.js';

describe('AppService', () => {
  it('returns a healthy status payload', () => {
    const service = new AppService();

    expect(service.getHealth()).toEqual({
      status: 'ok',
      service: 'api'
    });
  });
});
